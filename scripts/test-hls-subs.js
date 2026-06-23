const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.animeunity.to';

async function getManifest(episodeId) {
  const pageUrl = `${BASE}/anime/${episodeId}`;
  const html = await fetch(pageUrl, { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
  const $ = cheerio.load(html);
  const embedUrl = $('video-player').attr('embed_url');
  const embedHtml = await fetch(embedUrl, {
    headers: { 'User-Agent': config.USER_AGENT, Referer: pageUrl },
  }).then((r) => r.text());
  const script = embedHtml.match(/window\.video[\s\S]*?url:\s*'([^']+)'/) || [];
  const domain = (embedHtml.match(/url:\s*'([^']+)'/) || [])[1];
  const token = (embedHtml.match(/token':\s*'([^']+)'/) || [])[1];
  const expires = (embedHtml.match(/expires':\s*'([^']+)'/) || [])[1];
  const defaultUrl = `${domain}${domain.includes('?') ? '&' : '?'}token=${token}&referer=&expires=${expires}&h=1`;
  const manifest = await fetch(defaultUrl, {
    headers: { 'User-Agent': config.USER_AGENT, Referer: embedUrl },
  }).then((r) => r.text());
  return { manifest, download: embedHtml.match(/filename=([^&'"]+)/)?.[1], episodeId };
}

async function main() {
  const info = await require('../services/animeunity-direct').fetchAnimeInfo('4851-frieren-beyond-journeys-end');
  const itaInfo = await require('../services/animeunity-direct').fetchAnimeInfo('4852-frieren-beyond-journeys-end-ita');

  for (const [label, ep] of [
    ['PT/sub', info.episodes[0].id],
    ['ITA dub', itaInfo.episodes[0].id],
  ]) {
    const { manifest, download } = await getManifest(ep);
    console.log('\n===', label, '===');
    console.log('download:', download);
    console.log(manifest.slice(0, 2000));
  }
}

main().catch(console.error);