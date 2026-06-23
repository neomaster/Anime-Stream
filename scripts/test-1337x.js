const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = process.env.X1337_BASE || 'https://www.1337x.to';

async function search(q) {
  const url = `${BASE}/search/${encodeURIComponent(q)}/1/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': config.USER_AGENT, Accept: 'text/html' },
    timeout: 30000,
  });
  console.log('search status', res.status, url);
  const html = await res.text();
  const $ = cheerio.load(html);
  $('table.table-list tbody tr').slice(0, 5).each((i, el) => {
    const name = $(el).find('td.name a').last().text().trim();
    const href = $(el).find('td.name a').last().attr('href');
    const seeds = $(el).find('td.seeds').text().trim();
    const size = $(el).find('td.size').text().trim();
    console.log({ i, name, href, seeds, size });
  });
}

search('frieren 1080p').catch(console.error);