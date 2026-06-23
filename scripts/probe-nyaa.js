const fetch = require('node-fetch');
const config = require('../config');

async function main() {
  const url = 'https://nyaa.one/?page=rss&f=0&c=1_0&q=frieren+10';
  const res = await fetch(url, {
    headers: { 'User-Agent': config.USER_AGENT, Accept: 'application/rss+xml' },
    timeout: 30000,
  });
  const xml = await res.text();
  console.log('status', res.status, 'len', xml.length);
  console.log(xml.slice(0, 2500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});