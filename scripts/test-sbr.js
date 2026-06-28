#!/usr/bin/env node
process.env.CLOUD_MODE = 'true';
delete require.cache[require.resolve('../config')];
delete require.cache[require.resolve('../services/streaming')];

const streaming = require('../services/streaming');

const title = 'Steel Ball Run: JoJo no Kimyou na Bouken';
const alts = [
  "Steel Ball Run: JoJo's Bizarre Adventure",
  "JoJo's Bizarre Adventure Part 7: Steel Ball Run",
];

(async () => {
  const match = await streaming.findBestMatch(title, alts);
  console.log('match', match?.name, match?.url, match?.matchScore);
  if (!match?.url) return;
  const eps = await streaming.getEpisodes(match.url);
  console.log('eps', eps.length, eps[0]);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});