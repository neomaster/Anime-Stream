const fetch = require('node-fetch');
const config = require('../config');

const SATURN_BASE = (process.env.ANIME_SATURN_BASE || 'https://www.animesaturn.cx').replace(/\/+$/, '') + '/';
const UNITY_BASE = (process.env.ANIMEUNITY_BASE || 'https://www.animeunity.to').replace(/\/+$/, '') + '/';

function getReferer(targetUrl, override) {
  if (override) return String(override);

  try {
    const host = new URL(targetUrl).hostname;
    if (host.includes('animefire')) return config.ANIMEFIRE_BASE;
    if (host.includes('animesaturn') || host.includes('streampeaker') || host.includes('neko.')) {
      return SATURN_BASE;
    }
    if (host.includes('animeunity') || host.includes('vixcloud')) return UNITY_BASE;
    if (host.includes('lightspeedst') || host.includes('blogspot') || host.includes('blogger')) {
      return config.ANIMEFIRE_BASE;
    }
    return targetUrl;
  } catch {
    return config.ANIMEFIRE_BASE;
  }
}

function proxyUrlFor(targetUrl, req, referer) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  let out = `${proto}://${host}/api/proxy/video?url=${encodeURIComponent(targetUrl)}`;
  if (referer) out += `&referer=${encodeURIComponent(referer)}`;
  return out;
}

function rewriteM3u8Playlist(text, baseUrl, req, referer) {
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
            return `URI="${proxyUrlFor(abs, req, referer)}"`;
          });
        }
        return line;
      }
      const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
      return proxyUrlFor(abs, req, referer);
    })
    .join('\n');
}

async function fetchUpstream(targetUrl, req, referer) {
  const headers = {
    'User-Agent': config.USER_AGENT,
    Accept: '*/*',
    Referer: referer,
    Origin: (() => {
      try {
        return new URL(referer).origin;
      } catch {
        return referer.replace(/\/+$/, '');
      }
    })(),
  };

  const range = req.headers.range;
  if (range) headers.Range = range;

  return fetch(targetUrl, { headers, timeout: 60000 });
}

function refererCandidates(targetUrl, override) {
  const primary = getReferer(targetUrl, override);
  const list = [primary];

  try {
    const host = new URL(targetUrl).hostname;
    if (host.includes('streampeaker') || host.includes('neko.')) {
      list.push(SATURN_BASE, 'https://www.animesaturn.cx/', 'https://animesaturn.cx/');
    }
    if (host.includes('vixcloud')) {
      list.push(UNITY_BASE, 'https://www.animeunity.to/', config.ANIMEFIRE_BASE);
    }
  } catch {
    /* ignore */
  }

  return [...new Set(list.filter(Boolean))];
}

async function proxyStream(targetUrl, req, res) {
  const candidates = refererCandidates(targetUrl, req.query.referer);
  let response = null;
  let referer = candidates[0];

  for (const candidate of candidates) {
    referer = candidate;
    response = await fetchUpstream(targetUrl, req, candidate);
    if (response.ok) break;
  }

  if (!response.ok) {
    res.status(502).json({
      error: 'Fonte de video indisponivel no proxy',
      upstream: response.status,
      url: targetUrl.slice(0, 120),
    });
    return;
  }

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
    res.send(rewriteM3u8Playlist(text, targetUrl, req, referer));
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

async function proxyText(targetUrl, res, refererOverride) {
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Referer: getReferer(targetUrl, refererOverride),
    },
    timeout: 30000,
  });

  if (!response.ok) {
    res.status(502).json({ error: 'Legenda indisponivel no proxy', upstream: response.status });
    return;
  }

  const text = await response.text();
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(text);
}

module.exports = { proxyStream, proxyText, getReferer, proxyUrlFor };