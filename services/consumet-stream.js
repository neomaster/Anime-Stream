const fetch = require('node-fetch');
const {
  rankCandidates,
  buildSearchQueries,
  titleSimilarity,
} = require('./matcher');
const { normalizeSubtitles, subtitleLangLabel } = require('./subtitles');
const unityDirect = require('./animeunity-direct');
const saturnDirect = require('./anime-saturn-direct');
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

async function searchAnimeFireMulti(queries) {
  const limit = config.CLOUD_MODE ? 10 : Math.min(queries.length, 14);
  const batch = queries.slice(0, limit);
  const lists = await Promise.all(batch.map((q) => searchAnimeFire(q).catch(() => [])));
  return mergeSearchResults(lists, config.CLOUD_MODE ? 24 : 20);
}

async function validateStreamUrl(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': config.USER_AGENT,
        Range: 'bytes=0-512',
        Referer: 'https://www.animeunity.to/',
      },
      timeout: 15000,
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

async function readCandidateMalId(animeRef) {
  try {
    const decoded = decodeRef(animeRef);
    if (!decoded) return null;
    const { info } = await fetchAnimeInfoByRef(decoded);
    return info?.malID ? String(info.malID) : null;
  } catch {
    return null;
  }
}

async function tryCandidate(candidate, options) {
  const expectedMalId = options.malId ? String(options.malId) : null;
  if (expectedMalId) {
    const malId = await readCandidateMalId(candidate.url);
    if (malId && malId !== expectedMalId) return null;
  }

  const eps = await getEpisodes(candidate.url);
  if (!eps.length) return null;

  if (candidate.url.includes('AnimeSaturn')) {
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

async function findBestMatch(jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const queries = buildSearchQueries(titles);
  let results = await searchAnimeFireMulti(queries);

  if (!results.length && queries.length) {
    const fallback = queries.slice(0, 3);
    const lists = await Promise.all(fallback.map((q) => searchAnimeFire(q).catch(() => [])));
    results = mergeSearchResults(lists, 16);
  }

  if (!results.length) return null;

  let ranked = rankCandidates(results, titles, jikanTitle, options);
  if (config.CLOUD_MODE) {
    const saturn = ranked.filter((c) => c.source === 'animesaturn');
    const rest = ranked.filter((c) => c.source !== 'animesaturn');
    ranked = [...saturn, ...rest];
  }

  const tryLimit = useDirectUnity() ? 8 : 10;
  for (const candidate of ranked.slice(0, tryLimit)) {
    try {
      const match = await tryCandidate(candidate, options);
      if (match) return match;
    } catch {
      /* next */
    }
  }

  return null;
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

async function fetchEpisodeStreamFromRef(decoded) {
  let sources = [];
  let rawSubtitles = [];
  let streamMeta = {};

  if (decoded.provider === 'AnimeSaturn') {
    try {
      if (useDirectUnity()) {
        const data = await saturnDirect.fetchEpisodeSources(decoded.id);
        sources = data.sources || [];
      } else {
        throw new Error('fallback');
      }
    } catch {
      const provider = await getSaturnProvider();
      const data = await provider.fetchEpisodeSources(decoded.id);
      sources = data.sources || [];
    }
  } else if (decoded.provider === PROVIDER_NAME) {
    const data = await unityDirect.fetchEpisodeSources(decoded.id);
    sources = data.sources || [];
    rawSubtitles = data.subtitles || [];
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

  const sorted = [...sources].sort((a, b) => (b.isM3U8 ? 1 : 0) - (a.isM3U8 ? 1 : 0));
  let best = sorted.find((s) => s.isM3U8) || sorted[0];
  if (!best) throw new Error('Nenhuma fonte de video encontrada');

  if (!config.CLOUD_MODE) {
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

async function getEpisodeStream(episodeRef) {
  const decoded = decodeRef(episodeRef);
  if (!decoded) throw new Error('Episodio invalido');

  const stream = await fetchEpisodeStreamFromRef(decoded);
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
  getEpisodes,
  getEpisodeStream,
  getAnimeFromSource,
  titleSimilarity,
  buildSearchQueries,
  decodeRef,
  encodeRef,
};