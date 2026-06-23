const https = require('https');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const DEFAULT_MIRRORS = [
  'https://www.1377x.to',
  'https://www.1337x.st',
  'https://1337x.gd',
  'https://x1337x.ws',
];

function getMirrors() {
  const raw = process.env.X1337_MIRRORS || config.X1337_MIRRORS || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...fromEnv, ...DEFAULT_MIRRORS])];
  return merged;
}

const MIRRORS = getMirrors();

const BLOCK_RE =
  /\b(xxx|porn|jav|fetish|onlyfans|fansly|hentai|nsfw|affair|milf|stepdad|bbc|nude|erotic)\b/i;

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

function buildUrl(base, path) {
  const cleanBase = String(base).replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function normalizeHref(href, base) {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return buildUrl(base, trimmed);
  return buildUrl(base, `/${trimmed}`);
}

async function fetchHtml(pathOrUrl, options = {}) {
  const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
  const bases = options.preferredBase
    ? [options.preferredBase, ...MIRRORS.filter((b) => b !== options.preferredBase)]
    : MIRRORS;

  let lastErr = null;

  for (let mirrorIdx = 0; mirrorIdx < bases.length; mirrorIdx++) {
    const base = bases[mirrorIdx];
    const url = isAbsolute ? pathOrUrl : buildUrl(base, pathOrUrl);
    const isLastMirror = mirrorIdx === bases.length - 1;

    const attempts = [
      { agent: undefined, label: 'tls' },
      ...(isLastMirror ? [{ agent: insecureAgent, label: 'tls-relaxed' }] : []),
    ];

    for (const attempt of attempts) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': config.USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            Referer: `${base}/`,
          },
          timeout: 35000,
          agent: attempt.agent,
        });

        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status} em ${base}`);
          continue;
        }

        const html = await res.text();
        if (html.length < 800 || /Error\s*404/i.test(html)) {
          lastErr = new Error(`Página inválida em ${base}`);
          continue;
        }

        return { html, base, url };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  const msg = lastErr?.message || 'Índice indisponível';
  const error = new Error(msg);
  error.code = 'INDEX_UNAVAILABLE';
  throw error;
}

function parseListRow($, el) {
  const name = $(el).find('td.name a').last().text().replace(/\s+/g, ' ').trim();
  const href = $(el).find('td.name a').last().attr('href');
  const seeds = parseInt($(el).find('td.seeds').text().trim(), 10) || 0;
  const leeches = parseInt($(el).find('td.leeches').text().trim(), 10) || 0;
  const size = $(el).find('td.size').text().replace(/\s+/g, ' ').trim();
  const date = $(el).find('td.coll-date').text().trim();
  if (!name || !href || BLOCK_RE.test(name)) return null;
  return { name, href, seeds, leeches, size, date };
}

function parseSearchHtml(html, base, seen, merged) {
  const $ = cheerio.load(html);
  $('table.table-list tbody tr').each((_, el) => {
    const row = parseListRow($, el);
    if (!row) return;
    const key = row.href;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...row, mirrorBase: base });
  });
}

async function searchPath(path, seen, merged, limit) {
  try {
    const { html, base } = await fetchHtml(path);
    parseSearchHtml(html, base, seen, merged);
  } catch {
    /* próxima rota */
  }
  return merged.length >= limit;
}

async function searchIndex(queries, limit = 20) {
  const seen = new Set();
  const merged = [];
  const target = limit * 3;

  for (const q of queries) {
    if (!q || q.length < 2) continue;
    const encoded = encodeURIComponent(q);

    const paths = [
      `/search/${encoded}/1/`,
      `/sort-search/${encoded}/seeders/desc/1/`,
      `/srch?search=${encoded}`,
    ];

    for (const path of paths) {
      await searchPath(path, seen, merged, target);
      if (merged.length >= target) break;
    }
    if (merged.length >= target) break;
  }

  if (merged.length < 3) {
    await searchPath('/cat/Anime/1/', seen, merged, target);
    await searchPath('/cat/Anime/2/', seen, merged, target);
  }

  return merged.slice(0, limit * 2);
}

function extractMagnetFromHtml(html) {
  const $ = cheerio.load(html);

  const fromLink = $('a[href^="magnet:?"]').first().attr('href');
  if (fromLink) return fromLink.trim();

  const onclick = $('[onclick*="magnet"]').first().attr('onclick') || '';
  const onMatch = onclick.match(/magnet:\?[^'"]+/i);
  if (onMatch) return onMatch[0].trim();

  const rawMatch = html.match(/magnet:\?xt=urn:btih:[A-Fa-f0-9]{32,40}[^"'<\s]*/i);
  if (rawMatch) return decodeURIComponent(rawMatch[0].trim());

  return null;
}

async function fetchMagnetForHref(href, preferredBase) {
  const normalized = /^https?:\/\//i.test(href)
    ? href
    : normalizeHref(href, preferredBase || MIRRORS[0]);

  if (!normalized) {
    const err = new Error('Link do torrent inválido');
    err.code = 'INVALID_HREF';
    throw err;
  }

  const { html } = await fetchHtml(normalized, { preferredBase });
  const $ = cheerio.load(html);
  const magnet = extractMagnetFromHtml(html);

  const title =
    $('div.box-info-heading h1').text().replace(/\s+/g, ' ').trim() ||
    $('h1').text().replace(/\s+/g, ' ').trim() ||
    '';

  if (!magnet) {
    const err = new Error('Magnet não encontrado na página do torrent');
    err.code = 'MAGNET_NOT_FOUND';
    throw err;
  }

  if (!/^magnet:\?/i.test(magnet)) {
    const err = new Error('Link magnet inválido');
    err.code = 'MAGNET_INVALID';
    throw err;
  }

  return { magnet, title, pageUrl: normalized };
}

module.exports = {
  searchIndex,
  fetchMagnetForHref,
  normalizeHref,
  BLOCK_RE,
  getMirrors,
};