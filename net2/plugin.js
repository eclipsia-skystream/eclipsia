(function () {
  "use strict";

  // ─── Constants ──────────────────────────────────────────────────────────────

  var MAIN_URL      = "https://net11.cc";
  var IMG_BASE      = "https://imgcdn.kim";
  var COOKIE_TTL_MS = 54000000; // ~15 hours

  var USER_AGENT =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/148.0.7778.179 " +
    "Safari/537.36 /OS.Gatu v3.0";

  var NEWTV_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 " +
    "Firefox/151.0 /OS.GatuNewTV v1.0";

  var HOME_CACHE_TTL_MS = 600000;  // 10 min
  var LOAD_CACHE_TTL_MS = 300000;  // 5 min
  var EPISODE_PAGE_CONCURRENCY = 24;
  var HOME_TITLE_CONCURRENCY   = 48;

  // Three OTT providers — selected via manifest.providerId
  var PROVIDERS = {
    netflix: {
      id: "netflix", name: "Netflix",
      ott: "nf", playerOtt: "nf", prefix: "",
      poster:              function (id) { return IMG_BASE + "/poster/v/" + id + ".jpg"; },
      background:          function (id) { return IMG_BASE + "/poster/v/" + id + ".jpg"; },
      initialEpisodePoster:function (id) { return IMG_BASE + "/poster/v/150/" + id + ".jpg"; },
      episodePoster:       function (id) { return IMG_BASE + "/epimg/150/" + id + ".jpg"; },
      suggestPoster:       function (id) { return IMG_BASE + "/poster/v/" + id + ".jpg"; }
    },
    prime: {
      id: "prime", name: "Prime Video",
      ott: "pv", playerOtt: "pv", prefix: "/pv",
      poster:              function (id) { return IMG_BASE + "/pv/v/" + id + ".jpg"; },
      background:          function (id) { return IMG_BASE + "/pv/h/" + id + ".jpg"; },
      initialEpisodePoster:function (id) { return IMG_BASE + "/pv/v/" + id + ".jpg"; },
      episodePoster:       function (id) { return IMG_BASE + "/pvepimg/" + id + ".jpg"; },
      suggestPoster:       function (id) { return IMG_BASE + "/pv/v/" + id + ".jpg"; }
    },
    hotstar: {
      id: "hotstar", name: "Hotstar",
      ott: "hs", playerOtt: "hs", prefix: "/hs",
      poster:              function (id) { return IMG_BASE + "/hs/v/" + id + ".jpg"; },
      background:          function (id) { return IMG_BASE + "/hs/h/" + id + ".jpg"; },
      initialEpisodePoster:function (id) { return IMG_BASE + "/hsepimg/150/" + id + ".jpg"; },
      episodePoster:       function (id) { return IMG_BASE + "/hsepimg/" + id + ".jpg"; },
      suggestPoster:       function (id) { return IMG_BASE + "/hs/v/" + id + ".jpg"; }
    }
  };

  // Base64-encoded candidate domains for the NewTV API resolver
  var NEWTV_DOMAINS = [
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
  ];

  var LANGUAGE_NAMES = {
    bn: "Bengali", ben: "Bengali",
    en: "English", eng: "English",
    hi: "Hindi",   hin: "Hindi",
    ja: "Japanese",jpn: "Japanese",
    ur: "Urdu",    urd: "Urdu"
  };

  // ─── Runtime caches ─────────────────────────────────────────────────────────

  var cookieCache    = { value: "", time: 0 };
  var resolvedApiUrl = "";
  var homeCache      = {};
  var loadCache      = {};

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function trim(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function parseJsonSafe(v, fallback) {
    if (v && typeof v === "object") return v;
    try { return JSON.parse(String(v || "")); } catch (_) { return fallback; }
  }

  function decodeBase64(str) {
    try { if (typeof atob === "function") return atob(str); } catch (_) {}
    try { if (typeof Buffer !== "undefined") return Buffer.from(str, "base64").toString("utf8"); } catch (_) {}
    return "";
  }

  function randomUuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function unixTime() { return Math.floor(Date.now() / 1000); }

  function numberFrom(v) {
    var n = parseInt(String(v || "").replace(/[^0-9]/g, ""), 10);
    return isNaN(n) ? undefined : n;
  }

  function runtimeToMinutes(runtime) {
    var total = 0;
    String(runtime || "").split(/\s+/).forEach(function (part) {
      var h = part.match(/^(\d+)h$/i), m = part.match(/^(\d+)m$/i);
      if (h) total += parseInt(h[1], 10) * 60;
      if (m) total += parseInt(m[1], 10);
    });
    return total || undefined;
  }

  function decodeHtml(v) {
    return String(v || "")
      .replace(/&#(\d+);/g,    function (_, n) { return String.fromCodePoint(parseInt(n, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim();
  }

  function stripTags(v) {
    return decodeHtml(String(v || "").replace(/<[^>]*>/g, " "));
  }

  function payload(data) { return JSON.stringify(data || {}); }

  function parsePayload(url) {
    var p = parseJsonSafe(url, null);
    return p || { id: String(url || "") };
  }

  // ─── Header builders ────────────────────────────────────────────────────────

  function cookieStr(obj) {
    return Object.keys(obj || {})
      .filter(function (k) { return obj[k] != null && obj[k] !== ""; })
      .map(function (k) { return k + "=" + obj[k]; })
      .join("; ");
  }

  function pageHeaders(config, token, referer) {
    return {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "max-age=0",
      "Connection": "keep-alive",
      "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="148", "Android WebView";v="148"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Android"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer || (MAIN_URL + "/home"),
      "Cookie": cookieStr({ ott: config.ott, hd: "on", t_hash_t: token })
    };
  }

  function newTvHeaders(ottCode) {
    return {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Requested-With": "NetmirrorNewTV v1.0",
      "User-Agent": NEWTV_USER_AGENT,
      "Accept": "application/json, text/plain, */*",
      "Ott": ottCode,
      "Usertoken": ""
    };
  }

  // ─── HTTP helpers ────────────────────────────────────────────────────────────
  // Skystream's JS runtime exposes a global `fetch`; no Nuvio-specific http_get
  // / http_parallel / http_post needed.

  function normalizeHeaders(headers) {
    var out = {};
    if (!headers) return out;
    if (typeof headers.forEach === "function") {
      headers.forEach(function (v, k) { out[k.toLowerCase()] = v; });
    } else {
      Object.keys(headers).forEach(function (k) { out[k.toLowerCase()] = headers[k]; });
    }
    return out;
  }

  async function httpGet(url, headers) {
    var res = await fetch(url, { headers: headers || {} });
    return { status: res.status, body: await res.text(), headers: normalizeHeaders(res.headers), url: res.url || url };
  }

  async function httpParallelGet(requests) {
    return Promise.all(requests.map(function (req) {
      return httpGet(req.url, req.headers).catch(function () {
        return { status: 599, body: "", headers: {}, url: req.url };
      });
    }));
  }

  function extractCookie(headers, name) {
    var raw = headers && (headers["set-cookie"] || "");
    if (Array.isArray(raw)) raw = raw.join("\n");
    var m = String(raw).match(new RegExp(name + "=([^;\\n]+)", "i"));
    return m ? m[1] : "";
  }

  async function mapConcurrent(items, limit, fn) {
    var out = new Array(items.length);
    var index = 0;
    async function worker() {
      while (index < items.length) {
        var i = index++;
        out[i] = await fn(items[i], i).catch(function () { return null; });
      }
    }
    var workers = [], count = Math.min(limit || 4, items.length);
    for (var i = 0; i < count; i++) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  // ─── Provider selection ──────────────────────────────────────────────────────
  // manifest.providerId is set in each plugin's manifest.json

  function selectedProvider() {
    var id = trim(manifest && manifest.providerId).toLowerCase() || "netflix";
    return PROVIDERS[id] || PROVIDERS.netflix;
  }

  // ─── Bypass (cookie acquisition) ────────────────────────────────────────────

  async function bypass() {
    if (cookieCache.value && Date.now() - cookieCache.time < COOKIE_TTL_MS) {
      return cookieCache.value;
    }
    var url  = MAIN_URL + "/verify.php";
    var body = "g-recaptcha-response=" + encodeURIComponent(randomUuid());
    var headers = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "max-age=0",
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://net22.cc",
      "Referer": "https://net22.cc/verify2",
      "sec-ch-ua": '"Google Chrome";v="148", "Not.A/Brand";v="8", "Chromium";v="148"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
    };
    var res = await fetch(url, { method: "POST", headers: headers, body: body, redirect: "manual" });
    var cookie = extractCookie(normalizeHeaders(res.headers), "t_hash_t");
    if (!cookie) throw new Error("bypass failed: t_hash_t cookie missing");
    cookieCache = { value: cookie, time: Date.now() };
    return cookie;
  }

  // ─── NewTV API URL resolver ──────────────────────────────────────────────────

  async function resolveApiUrl() {
    if (resolvedApiUrl) return resolvedApiUrl;
    var baseHeaders = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache", "Expires": "0",
      "X-Requested-With": "NetmirrorNewTV v1.0",
      "User-Agent": NEWTV_USER_AGENT,
      "Accept": "application/json, text/plain, */*"
    };
    for (var i = 0; i < NEWTV_DOMAINS.length; i++) {
      var base = decodeBase64(NEWTV_DOMAINS[i]).replace(/\/+$/, "");
      if (!base) continue;
      try {
        var res  = await httpGet(base + "/checknewtv.php", baseHeaders);
        var json = parseJsonSafe(res.body, {});
        if (json && json.token_hash) {
          var url = decodeBase64(json.token_hash).replace(/\/+$/, "");
          if (url) { resolvedApiUrl = url; return url; }
        }
      } catch (_) {}
    }
    throw new Error("Failed to resolve NewTV API base URL");
  }

  // ─── Home page parsing ───────────────────────────────────────────────────────

  function buildItem(config, id, title, type, posterUrl) {
    var cleanTitle = trim(title);
    if (/<img\b/i.test(cleanTitle)) {
      var alt = cleanTitle.match(/alt=["']([^"']+)["']/i);
      cleanTitle = alt ? decodeHtml(alt[1]) : "";
    }
    return new MultimediaItem({
      title: cleanTitle || "",
      url: payload({ providerId: config.id, id: String(id || ""), title: cleanTitle || "" }),
      posterUrl: posterUrl || config.poster(id),
      type: type || "series"
    });
  }

  function parseHomeSectionsFast(config, html) {
    var text = String(html || "");
    var sections = {};
    var chunks = text.split(/<div[^>]+class=["']tray-container["'][^>]*>/i);
    for (var ci = 1; ci < chunks.length; ci++) {
      var block = chunks[ci] || "";
      var titleMatch = block.match(/<h2[^>]*class=["'][^"']*\btray-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
      var sectionTitle = stripTags(titleMatch && titleMatch[1]) || "Home";
      var seen = {}, items = [];
      var idRe = /data-post=["']([^"']+)["']/gi, m;
      while ((m = idRe.exec(block)) !== null) {
        var id = String(m[1] || "").trim();
        if (!id || seen[id]) continue;
        seen[id] = true;
        items.push(buildItem(config, id, "", "series", config.poster(id)));
      }
      if (items.length) sections[sectionTitle] = items;
    }
    return sections;
  }

  // ─── Title hydration (fills in blank titles via parallel post.php calls) ─────

  async function hydrateTitles(config, token, items) {
    var toFetch = items.filter(function (item) { return !parsePayload(item.url).title; });
    if (!toFetch.length) return;
    var requests = toFetch.map(function (item) {
      var id = parsePayload(item.url).id;
      return {
        url: MAIN_URL + "/mobile" + config.prefix + "/post.php?id=" + encodeURIComponent(id) + "&t=" + unixTime(),
        headers: pageHeaders(config, token)
      };
    });
    var responses = await httpParallelGet(requests);
    toFetch.forEach(function (item, i) {
      var data = parseJsonSafe(responses[i] && responses[i].body, {});
      if (data.title) {
        var p = parsePayload(item.url);
        p.title = trim(data.title);
        item.url = payload(p);
        item.title = p.title;
      }
    });
  }

  // ─── Episode fetching ────────────────────────────────────────────────────────

  function buildEpisode(config, title, ep) {
    return new Episode({
      name: trim(ep && ep.t) || title,
      url: payload({ providerId: config.id, id: ep && ep.id, title: title }),
      season: numberFrom(ep && ep.s) || 1,
      episode: numberFrom(ep && ep.ep) || 1,
      runtime: numberFrom(ep && ep.time),
      posterUrl: config.episodePoster(ep && ep.id)
    });
  }

  function episodePageRequest(config, token, seriesId, seasonId, page) {
    return {
      seasonId: seasonId,
      page: page || 1,
      url: MAIN_URL + "/mobile" + config.prefix + "/episodes.php?s=" +
           encodeURIComponent(seasonId) + "&series=" + encodeURIComponent(seriesId) +
           "&t=" + unixTime() + "&page=" + (page || 1),
      headers: pageHeaders(config, token)
    };
  }

  async function fetchEpisodePagesFast(config, token, title, seriesId, tasks) {
    var episodes = [], pending = (tasks || []).filter(Boolean), seen = {};
    while (pending.length) {
      var batch = pending.splice(0, EPISODE_PAGE_CONCURRENCY);
      var requests = batch.map(function (task) {
        var key = String(task.seasonId) + ":" + String(task.page || 1);
        seen[key] = true;
        return episodePageRequest(config, token, seriesId, task.seasonId, task.page || 1);
      });
      var responses = await httpParallelGet(requests);
      requests.forEach(function (req, idx) {
        var json = parseJsonSafe(responses[idx] && responses[idx].body, {});
        (json.episodes || []).forEach(function (row) {
          if (row && row.id) episodes.push(buildEpisode(config, title, row));
        });
        if (Number(json.nextPageShow || 0) !== 0) {
          var next = { seasonId: req.seasonId, page: (req.page || 1) + 1 };
          var nk   = String(next.seasonId) + ":" + String(next.page);
          if (!seen[nk]) pending.push(next);
        }
      });
    }
    return episodes;
  }

  // ─── HLS stream expansion ────────────────────────────────────────────────────

  function normalizeLanguageCode(v) {
    var code = String(v || "").toLowerCase().replace(/_/g, "-").replace(/\.\[cc\]|\[cc\]/g, "").replace(/[^a-z0-9-]/g, "");
    if (code === "eng") return "en";
    if (code === "ben") return "bn";
    if (code === "jpn") return "ja";
    return code;
  }

  function languageNameFromAttrs(attrs) {
    attrs = attrs || {};
    var code = normalizeLanguageCode(attrs.LANGUAGE);
    var cleanName = trim(String(attrs.NAME || "").replace(/^\d+\.\s*/, "").replace(/\s*\[cc\]\s*/ig, ""));
    var fromCode = LANGUAGE_NAMES[code] || LANGUAGE_NAMES[code.split("-")[0]];
    if (fromCode) return fromCode;
    if (cleanName && !/^\d+$/i.test(cleanName)) return cleanName;
    return code ? code.toUpperCase() : "Audio";
  }

  function parseHlsAttributes(line) {
    var attrs = {}, re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/ig, m;
    while ((m = re.exec(String(line || ""))) !== null) {
      attrs[String(m[1]).toUpperCase()] = String(m[2]).replace(/^"|"$/g, "");
    }
    return attrs;
  }

  function absoluteUrl(base, value) {
    value = String(value || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf("//") === 0) return "https:" + value;
    try { return new URL(value, base).toString(); } catch (_) { return value; }
  }

  function parseHlsMaster(masterUrl, body) {
    var text = String(body || "");
    if (!/^#EXTM3U/i.test(text) || text.indexOf("#EXT-X-STREAM-INF") === -1) return null;
    var lines = text.split(/\r?\n/), variants = [], media = [], pending = null, seen = {};
    for (var i = 0; i < lines.length; i++) {
      var raw = String(lines[i] || "").trim();
      if (!raw) continue;
      if (raw.indexOf("#EXT-X-MEDIA:") === 0) {
        var ma = parseHlsAttributes(raw.slice("#EXT-X-MEDIA:".length));
        if (ma.URI) { ma.URI = absoluteUrl(masterUrl, ma.URI); media.push({ attrs: ma }); }
        continue;
      }
      if (raw.indexOf("#EXT-X-I-FRAME-STREAM-INF:") === 0) { pending = null; continue; }
      if (raw.indexOf("#EXT-X-STREAM-INF:") === 0) {
        pending = { attrs: parseHlsAttributes(raw.slice("#EXT-X-STREAM-INF:".length)), raw: raw };
        continue;
      }
      if (raw.charAt(0) === "#" || !pending) continue;
      var variantUrl = absoluteUrl(masterUrl, raw);
      if (variantUrl && !seen[variantUrl]) {
        seen[variantUrl] = true;
        var resolution = String(pending.attrs.RESOLUTION || ""), qm = resolution.match(/x(\d+)/i);
        var quality = qm ? (parseInt(qm[1], 10) || 0) : 0;
        if (!quality) {
          var bw = parseInt(String(pending.attrs.BANDWIDTH || "0").replace(/\D/g, ""), 10) || 0;
          quality = bw >= 12000000 ? 2160 : bw >= 5000000 ? 1080 : bw ? 360 : 0;
        }
        variants.push({ url: variantUrl, attrs: pending.attrs, raw: pending.raw, quality: quality });
      }
      pending = null;
    }
    return variants.length ? { variants: variants, media: media } : null;
  }

  function mediaByGroup(media, type, groupId) {
    return (media || []).filter(function (m) {
      return String(m.attrs.TYPE || "").toUpperCase() === type &&
             String(m.attrs["GROUP-ID"] || "") === String(groupId || "");
    }).map(function (m) { return m.attrs; });
  }

  function buildStreamResult(url, source, quality, headers, subtitles, lang) {
    // Uses the Skystream SDK StreamResult class
    var stream = new StreamResult({
      url: url,
      quality: quality ? String(quality) + "p" : "Auto",
      headers: headers || {}
    });
    if (subtitles && subtitles.length) stream.subtitles = subtitles;
    if (lang) stream.language = lang;
    // source is surfaced via the stream label — attach as a custom field
    // (Skystream uses the source name from plugin manifest; but we tag it anyway)
    stream._source = source;
    return stream;
  }

  async function expandHlsStreams(masterUrl, source, streamHeaders, referer) {
    try {
      var res    = await httpGet(masterUrl, streamHeaders);
      var parsed = parseHlsMaster(masterUrl, res.body);
      if (!parsed) return [];
      var streams = [];
      parsed.variants.forEach(function (variant) {
        var audios = variant.attrs.AUDIO
          ? mediaByGroup(parsed.media, "AUDIO", variant.attrs.AUDIO).filter(function (a) { return a.URI; })
          : [];
        if (!audios.length) {
          streams.push(buildStreamResult(variant.url, source, variant.quality, streamHeaders, []));
        } else {
          audios.forEach(function (audio) {
            var lang = normalizeLanguageCode(audio.LANGUAGE);
            var name = languageNameFromAttrs(audio);
            // Build a mini master m3u8 so the player picks one audio track
            var miniLines = [
              "#EXTM3U", "#EXT-X-VERSION:3",
              "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",LANGUAGE=\"" + (audio.LANGUAGE || lang) + "\",NAME=\"" + name + "\",DEFAULT=YES,AUTOSELECT=YES,URI=\"" + audio.URI + "\"",
              String(variant.raw || "").replace(/,?AUDIO="[^"]*"/i, "") + ',AUDIO="audio"',
              variant.url
            ];
            var miniUrl = "magic_m3u8:" + btoa(miniLines.join("\n"));
            streams.push(buildStreamResult(miniUrl, source + " " + name, variant.quality, streamHeaders, [], lang));
          });
        }
      });
      return streams.sort(function (a, b) {
        return (Number(b.quality) || 0) - (Number(a.quality) || 0);
      });
    } catch (_) {
      return [];
    }
  }

  // ─── getHome ─────────────────────────────────────────────────────────────────

  async function getHome(cb) {
    try {
      var config = selectedProvider();
      var cached = homeCache[config.id];
      if (cached && Date.now() - cached.time < HOME_CACHE_TTL_MS) {
        return cb({ success: true, data: cached.data });
      }
      var token = await bypass();
      var url   = MAIN_URL + "/mobile/home?app=1";
      var res   = await httpGet(url, pageHeaders(config, token, url));
      var sections = parseHomeSectionsFast(config, res.body);

      // Hydrate any items that came back without a title
      await Promise.all(
        Object.values(sections).map(function (items) {
          return hydrateTitles(config, token, items);
        })
      );

      homeCache[config.id] = { time: Date.now(), data: sections };
      cb({ success: true, data: sections });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_FAILED", message: String(e && e.message || e) });
    }
  }

  // ─── search ──────────────────────────────────────────────────────────────────

  async function search(query, cb) {
    try {
      var config = selectedProvider();
      var token  = await bypass();
      var url    = MAIN_URL + "/mobile" + config.prefix +
                   "/search.php?s=" + encodeURIComponent(query || "") + "&t=" + unixTime();
      var res    = await httpGet(url, pageHeaders(config, token));
      var json   = parseJsonSafe(res.body, {});
      var items  = (json.searchResult || []).map(function (row) {
        if (!row || !row.id) return null;
        return buildItem(config, row.id, row.t, "series", config.poster(row.id));
      }).filter(Boolean);
      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, errorCode: "SEARCH_FAILED", message: String(e && e.message || e) });
    }
  }

  // ─── load ────────────────────────────────────────────────────────────────────

  async function load(url, cb) {
    try {
      var input  = parsePayload(url);
      var config = PROVIDERS[String(input.providerId || "").toLowerCase()] || selectedProvider();
      var id     = String(input.id || "");
      var cacheKey = config.id + ":" + id;
      var cached = loadCache[cacheKey];
      if (cached && Date.now() - cached.time < LOAD_CACHE_TTL_MS) {
        return cb({ success: true, data: cached.data });
      }

      var token     = await bypass();
      var detailUrl = MAIN_URL + "/mobile" + config.prefix +
                      "/post.php?id=" + encodeURIComponent(id) + "&t=" + unixTime();
      var res  = await httpGet(detailUrl, pageHeaders(config, token));
      var data = parseJsonSafe(res.body, {});

      var title       = trim(data.title || input.title || config.name);
      var rawEpisodes = data.episodes || [];
      var isMovie     = !rawEpisodes.length || rawEpisodes[0] == null;
      var episodes    = [];

      if (isMovie) {
        episodes.push(new Episode({
          name: title,
          url: payload({ providerId: config.id, id: id, title: title }),
          season: 1, episode: 1
        }));
      } else {
        rawEpisodes.filter(Boolean).forEach(function (row) {
          var ep = buildEpisode(config, title, row);
          ep.posterUrl = config.initialEpisodePoster(row.id);
          episodes.push(ep);
        });

        // Fetch remaining pages / older seasons in parallel
        var tasks = [];
        if (Number(data.nextPageShow || 0) === 1 && data.nextPageSeason) {
          tasks.push({ seasonId: data.nextPageSeason, page: 2 });
        }
        (data.season || []).slice(0, Math.max(0, (data.season || []).length - 1)).forEach(function (s) {
          if (s && s.id) tasks.push({ seasonId: s.id, page: 1 });
        });
        var extra = await fetchEpisodePagesFast(config, token, title, id, tasks);
        extra.forEach(function (ep) { if (ep) episodes.push(ep); });
      }

      var cast = String(data.cast || "").split(",").map(trim).filter(Boolean)
                   .slice(0, 30).map(function (n) { return new Actor({ name: n }); });
      var genres = String(data.genre || "").split(",").map(trim).filter(Boolean);
      var recommendations = (data.suggest || []).map(function (row) {
        return row && row.id ? buildItem(config, row.id, "", "series", config.suggestPoster(row.id)) : null;
      }).filter(Boolean);

      var item = new MultimediaItem({
        title: title,
        url: payload({ providerId: config.id, id: id, title: title }),
        posterUrl: config.poster(id),
        bannerUrl: config.background(id),
        type: isMovie ? "movie" : "series",
        description: trim(data.desc),
        year: numberFrom(data.year),
        score: parseFloat(String(data.match || "").replace(/IMDb/i, "").trim()) || undefined,
        duration: runtimeToMinutes(data.runtime),
        contentRating: trim(data.ua) || undefined,
        cast: cast,
        tags: genres,
        recommendations: recommendations,
        episodes: episodes
      });

      loadCache[cacheKey] = { time: Date.now(), data: item };
      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_FAILED", message: String(e && e.message || e) });
    }
  }

  // ─── loadStreams ──────────────────────────────────────────────────────────────

  async function loadStreams(url, cb) {
    try {
      var input  = parsePayload(url);
      var config = PROVIDERS[String(input.providerId || "").toLowerCase()] || selectedProvider();
      var id     = String(input.id || "");

      var apiBase = await resolveApiUrl();
      var res     = await httpGet(
        apiBase + "/newtv/player.php?id=" + encodeURIComponent(id),
        newTvHeaders(config.playerOtt)
      );
      var json = parseJsonSafe(res.body, {});
      if (json.status !== "ok" || !json.video_link) {
        return cb({ success: true, data: [] });
      }

      var referer = json.referer || apiBase;
      var streamHeaders = {
        "User-Agent": NEWTV_USER_AGENT,
        "Accept": "*/*",
        "Referer": referer,
        "Cookie": "hd=on"
      };

      // Expand HLS variants into per-resolution + per-language StreamResults
      var streams  = await expandHlsStreams(json.video_link, config.name, streamHeaders, referer);
      var maxQ     = streams.reduce(function (m, s) { return Math.max(m, parseInt(s.quality) || 0); }, 0);

      // Also add the raw adaptive stream (player picks quality automatically)
      var adaptive = new StreamResult({
        url: json.video_link,
        quality: maxQ ? String(maxQ) + "p" : "Auto",
        headers: streamHeaders
      });
      streams.push(adaptive);

      cb({ success: true, data: streams });
    } catch (e) {
      cb({ success: false, errorCode: "STREAMS_FAILED", message: String(e && e.message || e) });
    }
  }

  // ─── Exports ──────────────────────────────────────────────────────────────────

  globalThis.getHome      = getHome;
  globalThis.search       = search;
  globalThis.load         = load;
  globalThis.loadStreams   = loadStreams;

})();
