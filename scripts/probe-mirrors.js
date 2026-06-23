const fetch = require('node-fetch');
const config = require('../config');

const mirrors = [
  'https://1337x.to',
  'https://www.1337x.to',
  'https://www.1337x.st',
  'https://1337x.gd',
  'https://www.1377x.to',
  'https://x1337x.ws',
  'https://1337x.tw',
  'https://www.1337x.ninjaproxy1.com',
];

(async () => {
  for (const base of mirrors) {
    try {
      const res = await fetch(`${base}/search/frieren/1/`, {
        headers: { 'User-Agent': config.USER_AGENT },
        timeout: 15000,
      });
      const ok = res.status === 200;
      const len = (await res.text()).length;
      console.log(base, res.status, len, ok ? 'OK' : 'skip');
      if (ok && len > 5000) break;
    } catch (e) {
      console.log(base, e.code || e.message);
    }
  }
})();