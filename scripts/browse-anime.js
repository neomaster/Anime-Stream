const fetch = require('node-fetch');
const cheerio = require('cheerio');
const https = require('https');
const config = require('../config');

const agent = new https.Agent({ rejectUnauthorized: false });

async function tryBase(base, path) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.USER_AGENT },
      agent: url.startsWith('https') ? agent : undefined,
      timeout: 20000,
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const rows = $('table.table-list tbody tr').length;
    console.log(base, path, res.status, rows);
    if (rows > 0) {
      $('table.table-list tbody tr').slice(0, 3).each((_, el) => {
        console.log(' ', $(el).find('td.name a').last().text().trim().slice(0, 70));
      });
    }
    return rows;
  } catch (e) {
    console.log(base, e.code || e.message);
    return 0;
  }
}

(async () => {
  const bases = ['https://www.1377x.to', 'https://www.1337x.to', 'https://www.1337x.st'];
  const paths = [
    '/cat/Anime/1/',
    '/sub/54/1/',
    '/sort-category-search/anime/seeders/desc/1/',
    '/sort-category-search/Anime/seeders/desc/1/?search=naruto',
  ];
  for (const b of bases) {
    for (const p of paths) {
      await tryBase(b, p);
    }
  }
})();