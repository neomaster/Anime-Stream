const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://www.1377x.to';

async function getMagnet(path) {
  const url = BASE + path;
  const html = await fetch(url, { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
  const $ = cheerio.load(html);
  const magnet = $('a[href^="magnet:?"]').first().attr('href');
  const title = $('div.box-info-heading h1').text().trim() || $('h1').text().trim();
  console.log({ path, title: title.slice(0, 80), magnet: magnet ? 'OK' : 'NONE' });
  return { magnet, title };
}

(async () => {
  const listHtml = await fetch(BASE + '/cat/Anime/1/', { headers: { 'User-Agent': config.USER_AGENT } }).then((r) => r.text());
  const $ = cheerio.load(listHtml);
  const href = $('table.table-list tbody tr').first().find('td.name a').last().attr('href');
  console.log('list first', href);
  if (href) await getMagnet(href);
})();