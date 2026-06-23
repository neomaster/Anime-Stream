const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.1377x.to';

async function catSearch(q) {
  const paths = [
    `/sort-category-search/Anime/seeders/desc/1/?search=${encodeURIComponent(q)}`,
    `/sort-category-search/anime/seeders/desc/1/?search=${encodeURIComponent(q)}`,
    `/search/${encodeURIComponent(q + ' anime')}/1/`,
  ];
  for (const path of paths) {
    const html = await fetch(BASE + path, { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
    const $ = cheerio.load(html);
    const n = $('table.table-list tbody tr').length;
    console.log(path, n);
    if (n) {
      $('table.table-list tbody tr').slice(0, 3).each((_, el) => {
        console.log(' ', $(el).find('td.name a').last().text().trim().slice(0, 80));
      });
    }
  }
}

catSearch('naruto').then(() => catSearch('frieren')).catch(console.error);