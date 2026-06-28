const config = require('../config');
const goanime = require('./goanime');
const consumet = require('./consumet-stream');

const CONSUMET_PREFIX = 'consumet:';

function useCloudStreaming() {
  return config.CLOUD_MODE || process.env.STREAMING_PROVIDER === 'consumet';
}

function isConsumetRef(url) {
  return String(url || '').startsWith(CONSUMET_PREFIX);
}

function mergeByUrl(lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

async function findBestMatchWithEpisodes(provider, jikanTitle, alternatives, options) {
  const match = await provider.findBestMatch(jikanTitle, alternatives, options).catch(() => null);
  if (!match?.url) return null;

  const episodes = await provider.getEpisodes(match.url).catch(() => []);
  if (!episodes.length) return null;

  return match;
}

async function cloudFindBestMatch(jikanTitle, alternatives = [], options = {}) {
  const [fireMatch, unityMatch] = await Promise.all([
    findBestMatchWithEpisodes(goanime, jikanTitle, alternatives, options),
    findBestMatchWithEpisodes(consumet, jikanTitle, alternatives, options),
  ]);

  if (fireMatch && unityMatch) {
    const fireScore = fireMatch.matchScore || 0;
    const unityScore = unityMatch.matchScore || 0;
    return fireScore >= unityScore ? fireMatch : unityMatch;
  }

  return fireMatch || unityMatch || null;
}

async function cloudSearchAnimeFireMulti(queries) {
  const [unitySaturn, animefire] = await Promise.all([
    consumet.searchAnimeFireMulti(queries).catch(() => []),
    goanime.searchAnimeFireMulti(queries).catch(() => []),
  ]);
  return mergeByUrl([unitySaturn, animefire]);
}

async function cloudSearchAnimeFire(query) {
  const [unitySaturn, animefire] = await Promise.all([
    consumet.searchAnimeFire(query).catch(() => []),
    goanime.searchAnimeFire(query).catch(() => []),
  ]);
  return mergeByUrl([unitySaturn, animefire]);
}

module.exports = {
  mode: () => (useCloudStreaming() ? 'consumet+animefire' : 'animefire'),
  goanimeAvailable: () => goanime.goanimeAvailable() || useCloudStreaming(),
  searchAnimeFire: (...args) =>
    useCloudStreaming() ? cloudSearchAnimeFire(...args) : goanime.searchAnimeFire(...args),
  searchAnimeFireMulti: (...args) =>
    useCloudStreaming()
      ? cloudSearchAnimeFireMulti(...args)
      : goanime.searchAnimeFireMulti(...args),
  findBestMatch: (...args) =>
    useCloudStreaming() ? cloudFindBestMatch(...args) : goanime.findBestMatch(...args),
  getEpisodes: (url, ...args) =>
    useCloudStreaming() && isConsumetRef(url)
      ? consumet.getEpisodes(url, ...args)
      : goanime.getEpisodes(url, ...args),
  getEpisodeStream: (url, ...args) =>
    useCloudStreaming() && isConsumetRef(url)
      ? consumet.getEpisodeStream(url, ...args)
      : goanime.getEpisodeStream(url, ...args),
  getAnimeFromSource: (url, ...args) =>
    useCloudStreaming() && isConsumetRef(url)
      ? consumet.getAnimeFromSource(url, ...args)
      : goanime.getAnimeFromSource(url, ...args),
  titleSimilarity: goanime.titleSimilarity,
  buildSearchQueries: goanime.buildSearchQueries,
};