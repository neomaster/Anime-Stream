const fetch = require('node-fetch');
const config = require('../config');

function getReferer(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname;
    if (host.includes('animefire')) return config.ANIMEFIRE_BASE;
    if (host.includes('animesaturn')) return 'https://www.animesaturn.me/';
    if (host.includes('animeunity')) return 'https://www.animeunity.so/';
    if (host.includes('vixcloud')) return 'https://www.animeunity.to/';
    if (host.includes('streampeaker') || host.includes('neko.')) return 'https://www.animesaturn.me/';
    if (host.includes('lightspeedst') || host.includes('blogspot') || host.includes('blogger')) {
      return config.ANIMEFIRE_BASE;
    }
    return targetUrl;
  } catch {
    return config.ANIMEFIRE_BASE;
  }
}

function proxyUrlFor(targetUrl, req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  return `${proto}://${host}/api/proxy/video?url=${encodeURIComponent(targetUrl)}`;
}

function rewriteM3u8Playlist(text, baseUrl, req) {
  const base = new URL(baseUrl);
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-STREAM-INF') || trimmed.startsWith('#EXT-X-MEDIA')) {
          return line;
        }
        if (trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            const abs = uri.startsWith('http') ? uri : new URL(uri, base).href;
            return `URI="${proxyUrlFor(abs, req)}"`;
          });
        }
        return line;
      }
      const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
      return proxyUrlFor(abs, req);
    })
    .join('\n');
}

async function proxyStream(targetUrl, req, res) {
  const referer = getReferer(targetUrl);
  const headers = {
    'User-Agent': config.USER_AGENT,
    Accept: '*/*',
    Referer: referer,
    Origin: referer,
  };

  const range = req.headers.range;
  if (range) headers.Range = range;

  const response = await fetch(targetUrl, { headers });
  const contentType = response.headers.get('content-type') || '';
  const isM3u8 =
    /\.m3u8/i.test(targetUrl) ||
    contentType.includes('mpegurl') ||
    contentType.includes('m3u8');

  res.status(response.status);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (isM3u8) {
    const text = await response.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.send(rewriteM3u8Playlist(text, targetUrl, req));
    return;
  }

  const passHeaders = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
  ];

  for (const h of passHeaders) {
    const val = response.headers.get(h);
    if (val) res.setHeader(h, val);
  }

  if (!response.body) {
    res.end();
    return;
  }

  response.body.pipe(res);
}

async function proxyText(targetUrl, res) {
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Referer: getReferer(targetUrl),
    },
  });

  const text = await response.text();
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(text);
}

module.exports = { proxyStream, proxyText };