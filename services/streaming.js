const config = require('../config');
const goanime = require('./goanime');
const consumet = require('./consumet-stream');
const catalog = require('./catalog-sources');

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

async function cloudFindBestMatch(jikanTitle, alternatives = [], options = {}) {
  return catalog.findBestMatch(jikanTitle, alternatives, options);
}

async function cloudSearchAnimeFireMulti(queries) {
  return catalog.searchCatalogMulti(queries);
}

async function cloudSearchAnimeFire(query) {
  return catalog.searchCatalog(query);
}

module.exports = {
  mode: () =>
    useCloudStreaming() ? 'animefire+saturn+unity+nyaa' : 'animefire+nyaa',
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
  getEpisodeStream: (url, options, ...args) =>
    useCloudStreaming() && isConsumetRef(url)
      ? consumet.getEpisodeStream(url, options, ...args)
      : goanime.getEpisodeStream(url, options, ...args),
  getAnimeFromSource: (url, ...args) =>
    useCloudStreaming() && isConsumetRef(url)
      ? consumet.getAnimeFromSource(url, ...args)
      : goanime.getAnimeFromSource(url, ...args),
  titleSimilarity: goanime.titleSimilarity,
  buildSearchQueries: goanime.buildSearchQueries,
};