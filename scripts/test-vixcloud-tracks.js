const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.animeunity.to';
const episodeId = '4851-frieren-beyond-journeys-end/74008';

async function main() {
  const pageUrl = `${BASE}/anime/${episodeId}`;
  const html = await fetch(pageUrl, { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
  const embedUrl = cheerio.load(html)('video-player').attr('embed_url');
  const embedHtml = await fetch(embedUrl, {
    headers: { 'User-Agent': config.USER_AGENT, Referer: pageUrl },
  }).then((r) => r.text());

  const playlistId = (embedHtml.match(/playlist\/(\d+)/) || [])[1];
  const token = (embedHtml.match(/token':\s*'([^']+)'/) || [])[1];
  const expires = (embedHtml.match(/expires':\s*'([^']+)'/) || [])[1];

  const variants = [
    `https://vixcloud.co/playlist/${playlistId}?token=${token}&expires=${expires}&h=1`,
    `https://vixcloud.co/playlist/${playlistId}?ub=1&token=${token}&expires=${expires}`,
    `https://vixcloud.co/playlist/${playlistId}?ab=1&token=${token}&expires=${expires}`,
  ];

  for (const url of variants) {
    const text = await fetch(url, {
      headers: { 'User-Agent': config.USER_AGENT, Referer: embedUrl },
    }).then((r) => r.text());
    console.log('\n---', url.split('?')[1], '---');
    console.log(text.slice(0, 2000));
  }
}

main().catch(console.error);