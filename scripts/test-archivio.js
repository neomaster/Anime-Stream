const fetch = require('node-fetch');
const cheerio = require('cheerio');

fetch('https://www.animeunity.to/archivio?title=frieren')
  .then((r) => r.text())
  .then((h) => {
    const $ = cheerio.load(h);
    const raw = $('archivio').attr('records');
    const items = JSON.parse(raw);
    console.log(JSON.stringify(items.slice(0, 3), null, 2));
  });