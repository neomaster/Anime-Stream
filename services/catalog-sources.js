const config = require('../config');
const consumet = require('./consumet-stream');
const goanime = require('./goanime');
const { buildPrioritizedQueries } = require('./matcher');

function mergeByUrl(lists, cap = 32) {
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

async function searchCatalog(query) {
  const [international, animefire] = await Promise.all([
    consumet.searchAnimeFire(query).catch(() => []),
    goanime.searchAnimeFire(query).catch(() => []),
  ]);
  return mergeByUrl([international, animefire], 16);
}

async function searchCatalogMulti(queries, maxQueries) {
  const limit = maxQueries ?? (config.CLOUD_MODE ? 5 : Math.min(queries.length, 14));
  const batch = queries.slice(0, limit);
  const lists = await Promise.all(batch.map((q) => searchCatalog(q)));
  return mergeByUrl(lists, config.CLOUD_MODE ? 28 : 28);
}

async function findBestMatch(jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const queries = buildPrioritizedQueries(titles);
  const fastCount = config.CLOUD_MODE ? 3 : 6;

  let results = await searchCatalogMulti(queries, fastCount);
  let match = await consumet.matchFromResults(results, jikanTitle, alternatives, options);
  if (match) return match;

  if (queries.length > fastCount) {
    results = await searchCatalogMulti(queries);
    match = await consumet.matchFromResults(results, jikanTitle, alternatives, options);
    if (match) return match;
  }

  if (!results.length && queries.length) {
    const fallback = queries.slice(0, 4);
    const lists = await Promise.all(fallback.map((q) => searchCatalog(q)));
    results = mergeByUrl(lists, 24);
    return consumet.matchFromResults(results, jikanTitle, alternatives, options);
  }

  return null;
}

module.exports = {
  mergeByUrl,
  searchCatalog,
  searchCatalogMulti,
  findBestMatch,
};