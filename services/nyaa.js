const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const DEFAULT_BASE = 'https://nyaa.one';
const BLOCK_RE =
  /\b(xxx|porn|jav|fetish|onlyfans|fansly|hentai|nsfw|affair|milf|stepdad|bbc|nude|erotic)\b/i;

function getBase() {
  return String(config.NYAA_BASE || process.env.NYAA_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

function buildSearchUrl(query, options = {}) {
  const base = getBase();
  const params = new URLSearchParams();
  params.set('f', String(options.filter ?? 0));
  params.set('c', String(options.category ?? '1_0'));
  params.set('q', query);
  if (options.rss) params.set('page', 'rss');
  return `${base}/?${params.toString()}`;
}

function buildMagnet(infoHash, name) {
  if (!infoHash) return null;
  const dn = name ? `&dn=${encodeURIComponent(name)}` : '';
  return `magnet:?xt=urn:btih:${infoHash}${dn}`;
}

function normalizeRow(row) {
  if (!row?.name || BLOCK_RE.test(row.name)) return null;
  const seeds = parseInt(row.seeds, 10) || 0;
  const leeches = parseInt(row.leeches, 10) || 0;
  const magnet =
    row.magnet ||
    (row.infoHash ? buildMagnet(row.infoHash, row.name) : null);

  return {
    name: row.name,
    href: row.href || null,
    seeds,
    leeches,
    size: row.size || '',
    date: row.date || '',
    magnet,
    infoHash: row.infoHash || null,
    mirrorBase: getBase(),
    provider: 'nya',
  };
}

async function fetchContent(url, accept) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Accept: accept,
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      Referer: `${getBase()}/`,
    },
    timeout: 35000,
  });

  if (!res.ok) {
    const err = new Error(`Nyaa HTTP ${res.status}`);
    err.code = 'INDEX_UNAVAILABLE';
    throw err;
  }

  return res.text();
}

function parseSearchHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table.torrent-list tbody tr').each((_, el) => {
    const tds = $(el).find('td');
    if (tds.length < 6) return;

    const name =
      $(el).find('td:nth-child(2) a').last().text().replace(/\s+/g, ' ').trim() ||
      $(el).find('td.coll-1 a').last().text().replace(/\s+/g, ' ').trim();
    const href = $(el).find('td:nth-child(2) a').last().attr('href');
    const magnet =
      $(el).find('a[href^="magnet:"]').attr('href') ||
      $(el).find('a[title="Magnet Link"]').attr('href') ||
      null;
    const size = $(tds[3]).text().replace(/\s+/g, ' ').trim();
    const date = $(tds[4]).text().replace(/\s+/g, ' ').trim();
    const seeds = parseInt($(tds[5]).text().trim(), 10) || 0;
    const leeches = parseInt($(tds[6]).text().trim(), 10) || 0;

    const normalized = normalizeRow({
      name,
      href: href && !href.startsWith('http') ? `${getBase()}${href.startsWith('/') ? '' : '/'}${href}` : href,
      magnet,
      seeds,
      leeches,
      size,
      date,
    });
    if (normalized) rows.push(normalized);
  });

  return rows;
}

function extractXmlTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  if (!match) return '';
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function parseSearchRss(xml) {
  const rows = [];
  const blocks = xml.split(/<item>/i).slice(1);

  for (const block of blocks) {
    const name = extractXmlTag(block, 'title');
    const guid = extractXmlTag(block, 'guid');
    const infoHash = extractXmlTag(block, 'nyaa:infoHash') || extractXmlTag(block, 'infoHash');
    const seeds = parseInt(extractXmlTag(block, 'nyaa:seeders'), 10) || 0;
    const leeches = parseInt(extractXmlTag(block, 'nyaa:leechers'), 10) || 0;
    const size = extractXmlTag(block, 'nyaa:size') || extractXmlTag(block, 'description');
    const pubDate = extractXmlTag(block, 'pubDate');

    const normalized = normalizeRow({
      name,
      href: guid || null,
      infoHash,
      magnet: buildMagnet(infoHash, name),
      seeds,
      leeches,
      size,
      date: pubDate,
    });
    if (normalized) rows.push(normalized);
  }

  return rows;
}

async function searchQuery(query, seen, merged, limit) {
  if (!query || query.length < 2) return false;

  const htmlUrl = buildSearchUrl(query, { category: '1_0', filter: 0 });
  try {
    const html = await fetchContent(htmlUrl, 'text/html,application/xhtml+xml');
    for (const row of parseSearchHtml(html)) {
      const key = row.magnet || row.href || row.name;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= limit) return true;
    }
  } catch {
    /* tenta RSS */
  }

  const rssUrl = buildSearchUrl(query, { category: '1_0', filter: 0, rss: true });
  try {
    const xml = await fetchContent(rssUrl, 'application/rss+xml, application/xml, text/xml');
    for (const row of parseSearchRss(xml)) {
      const key = row.magnet || row.href || row.name;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
      if (merged.length >= limit) return true;
    }
  } catch {
    /* próxima query */
  }

  return merged.length >= limit;
}

async function searchIndex(queries, limit = 20) {
  const seen = new Set();
  const merged = [];
  const target = Math.max(limit * 3, 24);

  for (const q of queries) {
    await searchQuery(q, seen, merged, target);
    if (merged.length >= target) break;
  }

  if (!merged.length) {
    const err = new Error('Nyaa indisponível ou sem resultados');
    err.code = 'INDEX_UNAVAILABLE';
    err.provider = 'nya';
    throw err;
  }

  return merged.slice(0, limit * 2);
}

module.exports = {
  searchIndex,
  getBase,
  buildMagnet,
  BLOCK_RE,
};