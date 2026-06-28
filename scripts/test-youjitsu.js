#!/usr/bin/env node
process.env.CLOUD_MODE = 'true';
delete require.cache[require.resolve('../config')];

const streaming = require('../services/streaming');

const title = 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season: 2-nensei-hen 1 Gakki';
const alts = [
  'Classroom of the Elite 4th Season: Second Year, First Semester',
  'You-jitsu 4th Season',
  'Classroom of the Elite IV: Year 2',
];

(async () => {
  const match = await streaming.findBestMatch(title, alts, { malId: 59708 });
  console.log('match', match?.name, match?.url, match?.matchScore);
  if (!match?.url) return;
  const eps = await streaming.getEpisodes(match.url);
  console.log('eps', eps.length, eps[0]);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});