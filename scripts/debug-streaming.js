process.env.CLOUD_MODE = 'true';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../services/streaming')];

const jikan = require('../services/jikan');
const streaming = require('../services/streaming');

async function debugMal(malId) {
  const anime = await jikan.getAnimeById(malId);
  const alts = [anime.title_english, anime.title_japanese, ...(anime.synonyms || [])].filter(Boolean);
  console.log('\n===', anime.title, malId, '===');
  console.log('mode', streaming.mode());
  const queries = streaming.buildSearchQueries([anime.title, ...alts]);
  console.log('queries', queries.slice(0, 10));

  for (const q of queries.slice(0, 6)) {
    const s = await streaming.searchAnimeFire(q).catch((e) => ({ err: e.message }));
    const n = s.err ? s.err : s.length;
    console.log(' search', JSON.stringify(q), '->', n, s[0]?.name || '');
  }

  const match = await streaming.findBestMatch(anime.title, alts);
  console.log('match', match?.name, match?.matchScore, match?.url);
  if (!match?.url) return;

  const eps = await streaming.getEpisodes(match.url);
  console.log('eps', eps.length, eps[0]);
  if (!eps.length) return;

  const stream = await streaming.getEpisodeStream(eps[0].url);
  console.log('stream', stream.type, stream.videoUrl?.slice(0, 100));
}

(async () => {
  await debugMal(59983);
  await debugMal(52991);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});