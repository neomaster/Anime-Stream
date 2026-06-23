const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.1377x.to';

async function search(q) {
  const url = `${BASE}/search/${encodeURIComponent(q)}/1/`;
  const html = await fetch(url, { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
  const $ = cheerio.load(html);
  const out = [];
  $('table.table-list tbody tr').each((_, el) => {
    const name = $(el).find('td.name a').last().text().trim();
    const href = $(el).find('td.name a').last().attr('href');
    const seeds = parseInt($(el).find('td.seeds').text().trim(), 10) || 0;
    if (/frieren|sousou|beyond journey|wistoria|one piece/i.test(name)) {
      out.push({ name: name.slice(0, 100), href, seeds });
    }
  });
  console.log('\nQ:', q, 'matches:', out.length);
  out.slice(0, 5).forEach((x) => console.log(' ', x.seeds, x.name));
  return out;
}

(async () => {
  for (const q of [
    'Sousou no Frieren',
    'Frieren Beyond Journey',
    'frieren 1080p',
    'one piece 1080p',
    'wistoria 1080p',
  ]) {
    await search(q);
  }
})();