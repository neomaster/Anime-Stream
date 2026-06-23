const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.animeunity.to';
const episodeId = '4851-frieren-beyond-journeys-end/74008';

async function main() {
  const pageUrl = `${BASE}/anime/${episodeId}`;
  const html = await fetch(pageUrl, {
    headers: { 'User-Agent': config.USER_AGENT },
  }).then((r) => r.text());
  const $ = cheerio.load(html);
  const embedUrl = $('video-player').attr('embed_url');
  console.log('embed:', embedUrl);
  const embedHtml = await fetch(embedUrl, {
    headers: { 'User-Agent': config.USER_AGENT, Referer: pageUrl },
  }).then((r) => r.text());

  const vtt = embedHtml.match(/https?:\/\/[^"'\s<>]+\.vtt/gi) || [];
  const srt = embedHtml.match(/https?:\/\/[^"'\s<>]+\.srt/gi) || [];
  console.log('vtt:', vtt);
  console.log('srt:', srt);

  const subMatch = embedHtml.match(/subtitles?[^]{0,200}/gi) || [];
  console.log('sub snippets:', subMatch.slice(0, 5));

  const script = embedHtml.match(/window\.video[\s\S]{0,3000}/);
  if (script) console.log('video script head:', script[0].slice(0, 1500));
}

main().catch(console.error);