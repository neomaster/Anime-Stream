const fetch = require('node-fetch');
const {
  rankCandidates,
  buildSearchQueries,
  buildPrioritizedQueries,
  titleSimilarity,
} = require('./matcher');
const {
  validateSourceCandidate,
  validateStreamUrlEpisode,
  validateEpisodeRef,
} = require('./source-validator');
const { normalizeSubtitles, subtitleLangLabel } = require('./subtitles');
const unityDirect = require('./animeunity-direct');
const saturnDirect = require('./anime-saturn-direct');
const cache = require('./cache');
const config = require('../config');

const PROVIDER_NAME = 'AnimeUnity';
const EP_PREFIX = 'consumet:';

let animeModule = null;

async function getSaturnProvider() {
  if (!animeModule) animeModule = await import('@consumet/extensions');
  return new animeModule.ANIME.AnimeSaturn();
}

function useDirectUnity() {
  return config.CLOUD_MODE;
}

function encodeRef(provider, id, animeId) {
  const base = `${EP_PREFIX}${provider}:${id}`;
  return animeId ? `${base}~${animeId}` : base;
}

function decodeRef(ref) {
  if (!ref || !ref.startsWith(EP_PREFIX)) return null;
  const body = ref.slice(EP_PREFIX.length);
  const tilde = body.indexOf('~');
  const main = tilde >= 0 ? body.slice(0, tilde) : body;
  const animeId = tilde >= 0 ? body.slice(tilde + 1) : null;
  const sep = main.indexOf(':');
  if (sep < 0) return null;
  return { provider: main.slice(0, sep), id: main.slice(sep + 1), animeId };
}

function parseEpisodeNumber(episodeId, fallbackIndex) {
  const slash = episodeId.match(/\/(\d+)$/);
  if (slash) return parseInt(slash[1], 10) || fallbackIndex + 1;
  const dash = episodeId.match(/-ep-(\d+)$/i);
  if (dash) return parseInt(dash[1], 10) || fallbackIndex + 1;
  return fallbackIndex + 1;
}

function mapSearchResult(item) {
  return {
    name: item.title,
    url: encodeRef(PROVIDER_NAME, item.id),
    image: item.image || null,
    source: 'animeunity',
    dub: item.dub ?? null,
  };
}

async function searchUnity(query) {
  const items = await unityDirect.search(query);
  return items.map(mapSearchResult);
}

async function searchSaturnConsumet(query) {
  const provider = await getSaturnProvider();
  const data = await provider.search(query);
  return (data.results || []).map((item) => ({
    name: item.title,
    url: encodeRef('AnimeSaturn', item.id),
    image: item.image || null,
    source: 'animesaturn',
  }));
}

async function searchSaturnDirect(query) {
  const items = await saturnDirect.search(query);
  return items.map((item) => ({
    name: item.title,
    url: encodeRef('AnimeSaturn', item.id),
    image: item.image || null,
    source: 'animesaturn',
  }));
}

async function searchSaturn(query) {
  if (useDirectUnity()) {
    try {
      const direct = await searchSaturnDirect(query);
      if (direct.length) return direct;
    } catch (err) {
      console.warn('[AnimeSaturn/direct]', query, err.message);
    }
  }

  try {
    return await searchSaturnConsumet(query);
  } catch (err) {
    console.warn('[AnimeSaturn/consumet]', query, err.message);
    return [];
  }
}

async function searchAnimeFire(query) {
  if (useDirectUnity()) {
    const [saturnSettled, unitySettled] = await Promise.allSettled([
      searchSaturn(query),
      searchUnity(query),
    ]);
    const saturn = saturnSettled.status === 'fulfilled' ? saturnSettled.value : [];
    const unity = unitySettled.status === 'fulfilled' ? unitySettled.value : [];
    return [...saturn, ...unity];
  }

  try {
    return await searchSaturn(query);
  } catch {
    return [];
  }
}

function mergeSearchResults(lists, cap = 24) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= cap) return merged;
    }
  }
  return merged;
}

async function searchAnimeFireMulti(queries, options = {}) {
  const maxQueries = options.maxQueries ?? (config.CLOUD_MODE ? 5 : 14);
  const limit = Math.min(queries.length, maxQueries);
  const batch = queries.slice(0, limit);
  const lists = await Promise.all(batch.map((q) => searchAnimeFire(q).catch(() => [])));
  return mergeSearchResults(lists, config.CLOUD_MODE ? 20 : 20);
}

async function validateStreamUrl(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': config.USER_AGENT,
        Range: 'bytes=0-512',
        Referer: process.env.ANIME_SATURN_BASE || 'https://www.animesaturn.cx/',
      },
      timeout: 15000,
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

async function readCandidateMalId(animeRef) {
  const cacheKey = `mal-ref:${animeRef}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined && cached !== null) return cached;

  try {
    const decoded = decodeRef(animeRef);
    if (!decoded) {
      cache.set(cacheKey, null, 10 * 60 * 1000);
      return null;
    }
    const { info } = await fetchAnimeInfoByRef(decoded);
    const malId = info?.malID ? String(info.malID) : null;
    cache.set(cacheKey, malId, 6 * 60 * 60 * 1000);
    return malId;
  } catch {
    cache.set(cacheKey, null, 5 * 60 * 1000);
    return null;
  }
}

async function getEpisodesForCandidate(candidate) {
  const cacheKey = `eps-ref:${candidate.url}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const isConsumet = String(candidate.url || '').startsWith(EP_PREFIX);
  let eps;
  if (!isConsumet || candidate.source === 'animefire') {
    const goanime = require('./goanime');
    eps = await goanime.getEpisodes(candidate.url);
  } else {
    eps = await getEpisodes(candidate.url);
  }

  if (eps?.length) cache.set(cacheKey, eps, 45 * 60 * 1000);
  return eps;
}

async function tryCandidate(candidate, options) {
  const eps = await getEpisodesForCandidate(candidate);
  if (!eps.length) return null;

  const validation = await validateSourceCandidate(
    candidate,
    {
      malId: options.malId,
      jikanTitle: options.jikanTitle,
      altTitles: options.altTitles,
      expectedEpisodes: options.expectedEpisodes,
      status: options.status,
      episodes: eps,
      matchScore: candidate.matchScore || 0,
      fastPath: config.CLOUD_MODE && (candidate.matchScore || 0) >= 0.85,
    },
    readCandidateMalId
  );

  if (!validation.ok) {
    console.warn('[match-reject]', candidate.name, validation.reason);
    return null;
  }

  if (candidate.url.includes('AnimeSaturn')) {
    return candidate;
  }

  if (candidate.source === 'animefire') {
    return candidate;
  }

  if (candidate.url.includes('AnimeUnity')) {
    if (config.CLOUD_MODE) return candidate;
    const stream = await fetchEpisodeStreamFromRef(decodeRef(eps[0].url));
    if (await validateStreamUrl(stream.videoUrl)) return candidate;
    return null;
  }

  return candidate;
}

async function matchFromResults(results, jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const matchOptions = {
    ...options,
    jikanTitle,
    altTitles: alternatives,
  };

  if (!results?.length) return null;

  let ranked = rankCandidates(results, titles, jikanTitle, matchOptions);
  if (config.CLOUD_MODE) {
    const audioPref = matchOptions.audioPref === 'dublado' ? 'dublado' : 'legendado';
    ranked = ranked
      .map((c) => {
        let bonus = 0;
        const ref = `${c.url || ''} ${c.name || ''}`.toLowerCase();
        const isDub = /dublado|dub\b|_dub_/.test(ref);

        if (c.source === 'animefire') {
          if (audioPref === 'dublado' && isDub) bonus += 0.2;
          else if (audioPref === 'legendado' && !isDub) bonus += 0.18;
          else if (audioPref === 'legendado' && isDub) bonus -= 0.22;
        } else if (c.source === 'animeunity') {
          bonus += audioPref === 'legendado' ? 0.16 : 0.1;
        } else if (c.source === 'animesaturn') {
          bonus += audioPref === 'legendado' && !/sub_ita|_ita\b/i.test(ref) ? 0.04 : 0.02;
        }

        return { ...c, matchScore: c.matchScore + bonus };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  const tryLimit = useDirectUnity() ? 5 : 12;
  for (const candidate of ranked.slice(0, tryLimit)) {
    try {
      const match = await tryCandidate(candidate, matchOptions);
      if (match) return match;
    } catch {
      /* next */
    }
  }

  return null;
}

async function findBestMatch(jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const queries = buildPrioritizedQueries(titles);
  let results = await searchAnimeFireMulti(queries);

  if (!results.length && queries.length) {
    const fallback = queries.slice(0, 3);
    const lists = await Promise.all(fallback.map((q) => searchAnimeFire(q).catch(() => [])));
    results = mergeSearchResults(lists, 16);
  }

  return matchFromResults(results, jikanTitle, alternatives, options);
}

async function fetchSaturnAnimeInfo(animeId) {
  if (useDirectUnity()) {
    try {
      const info = await saturnDirect.fetchAnimeInfo(animeId);
      if (info.episodes?.length) return info;
    } catch (err) {
      console.warn('[AnimeSaturn/direct info]', animeId, err.message);
    }
  }

  const provider = await getSaturnProvider();
  return provider.fetchAnimeInfo(animeId);
}

async function fetchAnimeInfoByRef(decoded) {
  if (decoded.provider === 'AnimeSaturn') {
    const animeId = decoded.animeId || decoded.id;
    const info = await fetchSaturnAnimeInfo(animeId);
    return { providerName: 'AnimeSaturn', info };
  }

  if (decoded.provider === PROVIDER_NAME) {
    const animeId = decoded.animeId || decoded.id;
    const info = await unityDirect.fetchAnimeInfo(animeId);
    return { providerName: PROVIDER_NAME, info };
  }

  const provider = await getSaturnProvider();
  const animeId = decoded.animeId || decoded.id;
  const info = await provider.fetchAnimeInfo(animeId);
  return { providerName: 'AnimeSaturn', info };
}

async function getEpisodes(animeRef) {
  const decoded = decodeRef(animeRef);
  const { providerName, info } = await fetchAnimeInfoByRef(decoded);
  const animeId = decoded.animeId || decoded.id;

  const episodes = (info.episodes || []).map((ep, i) => {
    const epId = ep.id || `${animeId}/${ep.number}`;
    const num = ep.number > 0 ? ep.number : parseEpisodeNumber(epId, i);
    return {
      number: num,
      label: ep.title || `Episodio ${num}`,
      url: encodeRef(providerName, epId, animeId),
    };
  });

  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

async function getAnimeFromSource(sourceRef) {
  const { info, providerName } = await fetchAnimeInfoByRef(decodeRef(sourceRef));
  const episodes = await getEpisodes(sourceRef);

  return {
    title: info.title,
    poster: info.image || null,
    synopsis: info.description || '',
    source: { name: info.title, url: sourceRef, source: providerName.toLowerCase() },
    episodes,
  };
}

function pickSaturnSource(sources, options = {}) {
  const sorted = [...sources].sort((a, b) => (b.isM3U8 ? 1 : 0) - (a.isM3U8 ? 1 : 0));
  const audioPref = options.audioPref === 'dublado' ? 'dublado' : 'legendado';

  if (audioPref === 'legendado') {
    const subFree = sorted.find(
      (s) => s.url && !/SUB_ITA|_ITA\.mp4|_DUB_/i.test(s.url)
    );
    if (subFree) return subFree;
  }

  if (audioPref === 'dublado') {
    const dubbed = sorted.find((s) => s.url && /_DUB_|dub/i.test(s.url));
    if (dubbed) return dubbed;
  }

  return sorted.find((s) => s.isM3U8) || sorted[0] || null;
}

async function fetchEpisodeStreamFromRef(decoded, options = {}) {
  let sources = [];
  let rawSubtitles = [];
  let streamMeta = {};
  let streamReferer = null;

  if (decoded.provider === 'AnimeSaturn') {
    try {
      if (useDirectUnity()) {
        const data = await saturnDirect.fetchEpisodeSources(decoded.id);
        sources = data.sources || [];
        streamReferer = data.headers?.Referer || null;
      } else {
        throw new Error('fallback');
      }
    } catch {
      const provider = await getSaturnProvider();
      const data = await provider.fetchEpisodeSources(decoded.id);
      sources = data.sources || [];
      streamReferer = data.headers?.Referer || null;
    }
  } else if (decoded.provider === PROVIDER_NAME) {
    const data = await unityDirect.fetchEpisodeSources(decoded.id);
    sources = data.sources || [];
    rawSubtitles = data.subtitles || [];
    streamReferer = data.headers?.Referer || null;
    streamMeta = {
      audioMode: data.audioMode || 'legendado',
      subtitleLang: data.subtitleLang || null,
      embeddedSubtitles: !!data.embeddedSubtitles,
    };
  } else {
    const provider = await getSaturnProvider();
    const data = await provider.fetchEpisodeSources(decoded.id);
    sources = data.sources || [];
  }

  let best =
    decoded.provider === 'AnimeSaturn'
      ? pickSaturnSource(sources, options)
      : [...sources].sort((a, b) => (b.isM3U8 ? 1 : 0) - (a.isM3U8 ? 1 : 0)).find((s) => s.isM3U8) ||
        sources[0];

  if (!best?.url) throw new Error('Nenhuma fonte de video encontrada');

  if (!config.CLOUD_MODE) {
    const sorted = [...sources].sort((a, b) => (b.isM3U8 ? 1 : 0) - (a.isM3U8 ? 1 : 0));
    for (const src of sorted) {
      if (await validateStreamUrl(src.url)) {
        best = src;
        break;
      }
    }
  }

  const subtitles = normalizeSubtitles(rawSubtitles);

  return {
    videoUrl: best.url,
    streamReferer,
    type: best.isM3U8 || /\.m3u8/i.test(best.url) ? 'hls' : 'mp4',
    quality: best.quality || 'default',
    qualities: sources.map((s) => ({ url: s.url, label: s.quality || 'default' })),
    subtitles,
    audioMode: streamMeta.audioMode || 'legendado',
    subtitleLang: streamMeta.subtitleLang || null,
    embeddedSubtitles: streamMeta.embeddedSubtitles || false,
    subtitleLangLabel: subtitleLangLabel(streamMeta.subtitleLang),
  };
}

async function getEpisodeStream(episodeRef, options = {}) {
  const decoded = decodeRef(episodeRef);
  if (!decoded) throw new Error('Episodio invalido');

  if (!config.CLOUD_MODE) {
    const refCheck = validateEpisodeRef(episodeRef, options.episodeNumber);
    if (!refCheck.ok) throw new Error(refCheck.reason || 'Episodio invalido');
  }

  const stream = await fetchEpisodeStreamFromRef(decoded, options);

  if (!config.CLOUD_MODE) {
    const urlCheck = validateStreamUrlEpisode(stream.videoUrl, options.episodeNumber);
    if (!urlCheck.ok) {
      console.warn('[stream-reject]', urlCheck.reason, stream.videoUrl?.slice(0, 100));
      throw new Error(urlCheck.reason || 'Video nao corresponde ao episodio');
    }
  }
  return {
    ...stream,
    goanime: {
      available: true,
      path: 'cloud',
      version: `unity-${decoded.provider.toLowerCase()}`,
    },
  };
}

function goanimeAvailable() {
  return true;
}

module.exports = {
  goanimeAvailable,
  searchAnimeFire,
  searchAnimeFireMulti,
  findBestMatch,
  matchFromResults,
  getEpisodes,
  getEpisodeStream,
  getAnimeFromSource,
  titleSimilarity,
  buildSearchQueries,
  decodeRef,
  encodeRef,
};