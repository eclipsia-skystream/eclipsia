// ─────────────────────────────────────────────────────────────────────────────
//  NetMirror – SkyStream Plugin
//  Ported from the Nuvio plugin by NuvioMedia
//  Provides streams for Netflix (nf), Prime Video (pv), and Hotstar (hs)
//  via the imgcdn.kim mirror API.
// ─────────────────────────────────────────────────────────────────────────────

// ── Manifest ─────────────────────────────────────────────────────────────────
// SkyStream calls getManifest() to register the plugin.
function getManifest() {
  return {
    name: "Soryn",
    id: "com.net2.skystream",   // unique, do NOT change after release
    version: 1,
    baseUrl: "https://net11.cc",
    description: "Streams Netflix, Prime Video & Hotstar content via NetMirror CDN (nf / pv / hs).",
    authors: ["NuvioMedia (original)", "ported to SkyStream"],
    languages: ["en", "hi", "ta"],
    categories: ["Movie", "TvSeries"],
    type: "Movie"   // signals the app this plugin handles both movies & series
  };
}

// ── Constants ────────────────────────────────────────────────────────────────
var API = "https://tv.imgcdn.kim/newtv";
var REFERER = "https://net11.cc/";

var SERVICES = [
  { code: "nf", name: "Netflix" },
  { code: "pv", name: "Prime Video" },
  { code: "hs", name: "Disney+ Hotstar" }
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeHeaders(ottCode) {
  return {
    "ott": ottCode,
    "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
    "accept": "application/json, text/plain, */*",
    "referer": REFERER
  };
}

// Fetch wrapper that always returns parsed JSON or throws.
function fetchJson(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) {
    return r.json();
  });
}

// ── Stream-fetching core ─────────────────────────────────────────────────────

// getPlayer: fetches the final video_link for a content id from one service.
function getPlayer(id, svc) {
  var h = makeHeaders(svc.code);
  return fetchJson(API + "/player.php?id=" + id, h).then(function (data) {
    if (!data.video_link || !data.video_link.startsWith("https")) return [];
    return [{
      name: svc.name,
      url: data.video_link,
      quality: "1080p",
      type: data.video_link.includes(".m3u8") ? "m3u8" : "mp4",
      headers: {
        "Referer":    data.referer || REFERER,
        "Origin":     data.referer || REFERER,
        "User-Agent": h["user-agent"]
      }
    }];
  });
}

// findEpisode: pages through episode listings until it finds the right ep.
function findEpisode(seasonId, epNum, svc, page) {
  page = page || 1;
  var h = makeHeaders(svc.code);
  return fetchJson(API + "/episodes.php?id=" + seasonId + "&page=" + page, h)
    .then(function (data) {
      var eps = (data.episodes || []).filter(Boolean);
      for (var i = 0; i < eps.length; i++) {
        if (parseInt(eps[i].ep) === epNum && eps[i].id) {
          return getPlayer(eps[i].id, svc);
        }
      }
      if (parseInt(data.nextPageShow) === 1 && page < 20) {
        return findEpisode(seasonId, epNum, svc, page + 1);
      }
      return [];
    });
}

// getServiceStreams: searches one service for the title, then resolves to links.
function getServiceStreams(svc, title, mediaType, season, episode) {
  var h = makeHeaders(svc.code);
  var tl = title.trim().toLowerCase();

  return fetchJson(API + "/search.php?s=" + encodeURIComponent(title), h)
    .then(function (json) {
      var results = json.searchResult || [];
      var match = null;
      for (var i = 0; i < results.length; i++) {
        if (results[i].t && results[i].t.trim().toLowerCase() === tl) {
          match = results[i];
          break;
        }
      }
      if (!match && results.length === 1) match = results[0];
      if (!match) return [];

      // Movie: go straight to player.
      if (mediaType !== "tv") {
        return getPlayer(match.id, svc);
      }

      // TV: navigate series → season → episode.
      return fetchJson(API + "/post.php?id=" + match.id, h).then(function (post) {
        var seasons = post.season || [];
        var seasonId = null;
        for (var i = 0; i < seasons.length; i++) {
          var m = seasons[i].s && seasons[i].s.match(/Season\s*(\d+)/i);
          if (m && parseInt(m[1]) === parseInt(season)) {
            seasonId = seasons[i].id;
            break;
          }
        }
        if (!seasonId) return [];
        return findEpisode(seasonId, parseInt(episode), svc);
      });
    })
    .catch(function () { return []; });
}

// ── SkyStream entry-points ────────────────────────────────────────────────────
// SkyStream calls getStreams({ tmdbId, mediaType, season, episode }).
// It expects an array of stream objects: [{ name, url, quality, type, headers }]

function getStreams(args) {
  var tmdbId    = args.tmdbId;
  var mediaType = args.mediaType;   // "movie" | "tv"
  var season    = args.season    || 1;
  var episode   = args.episode   || 1;

  var type = mediaType === "tv" ? "tv" : "movie";
  var TMDB_KEY = args.tmdbApiKey || "";   // SkyStream passes its own TMDB key

  // Fetch title from TMDB, then hit all three services in parallel.
  return fetch(
    "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY
  )
    .then(function (r) { return r.json(); })
    .then(function (media) {
      var title = mediaType === "tv" ? media.name : media.title;
      if (!title) return [];

      return Promise.all(
        SERVICES.map(function (svc) {
          return getServiceStreams(svc, title, mediaType, season, episode)
            .catch(function () { return []; });
        })
      ).then(function (results) {
        // Flatten [[...], [...], [...]] → [...]
        return results.reduce(function (a, b) { return a.concat(b); }, []);
      });
    })
    .catch(function () { return []; });
}

// ── Home / trending (optional but improves app UX) ───────────────────────────
// SkyStream can call getHome() to populate the home screen.
// We return TMDB trending as a lightweight fallback since NetMirror
// has no public catalogue endpoint.
function getHome(args) {
  var TMDB_KEY = (args && args.tmdbApiKey) || "";
  return fetch(
    "https://api.themoviedb.org/3/trending/all/week?api_key=" + TMDB_KEY
  )
    .then(function (r) { return r.json(); })
    .then(function (json) {
      var items = (json.results || []).slice(0, 20).map(function (item) {
        return {
          title:     item.title || item.name || "",
          url:       "tmdb://" + (item.media_type === "tv" ? "tv" : "movie") + "/" + item.id,
          posterUrl: item.poster_path
            ? "https://image.tmdb.org/t/p/w500" + item.poster_path
            : ""
        };
      });
      return { "Trending This Week": items };
    })
    .catch(function () { return {}; });
}

// ── Search ───────────────────────────────────────────────────────────────────
// SkyStream calls search({ query, tmdbApiKey }) for in-plugin search.
function search(args) {
  var query    = (args && args.query) || "";
  var TMDB_KEY = (args && args.tmdbApiKey) || "";
  if (!query) return Promise.resolve([]);

  return fetch(
    "https://api.themoviedb.org/3/search/multi?api_key=" + TMDB_KEY +
    "&query=" + encodeURIComponent(query)
  )
    .then(function (r) { return r.json(); })
    .then(function (json) {
      return (json.results || [])
        .filter(function (item) { return item.media_type === "movie" || item.media_type === "tv"; })
        .slice(0, 15)
        .map(function (item) {
          return {
            title:     item.title || item.name || "",
            url:       "tmdb://" + item.media_type + "/" + item.id,
            posterUrl: item.poster_path
              ? "https://image.tmdb.org/t/p/w500" + item.poster_path
              : ""
          };
        });
    })
    .catch(function () { return []; });
}
