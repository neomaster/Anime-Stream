const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const config = require('../config');

const BASE = process.env.X1337_BASE || 'https://www.1377x.to';

async function main() {
  const url = `${BASE}/sort-category-search/anime/seeders/desc/1/?search=frieren`;
  const res = await fetch(url, { headers: { 'User-Agent': config.USER_AGENT } });
  const html = await res.text();
  fs.writeFileSync('scripts/sample-1337x.html', html);
  const $ = cheerio.load(html);
  console.log('rows', $('table.table-list tbody tr').length);
  console.log('boxes', $('.box-info-list li').length);
  $('table.table-list tbody tr').slice(0, 3).each((i, el) => {
    console.log($(el).find('td.name').text().trim().slice(0, 80));
  });
  // try general search with anime keyword
  const url2 = `${BASE}/search/frieren%20anime/1/`;
  const res2 = await fetch(url2, { headers: { 'User-Agent': config.USER_AGENT } });
  const html2 = await res2.text();
  const $2 = cheerio.load(html2);
  console.log('general rows', $2('table.table-list tbody tr').length);
  $2('table.table-list tbody tr').slice(0, 8).each((i, el) => {
    const name = $2(el).find('td.name a').last().text().trim();
    if (/anime|frieren|sousou/i.test(name)) console.log('match:', name);
  });
}

main().catch(console.error);