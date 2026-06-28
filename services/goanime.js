const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const config = require('../config');
const matcher = require('./matcher');

const QUALITY_RANK = { '1080p': 5, '720p': 4, '480p': 3, '360p': 2, '240p': 1 };
const MP4_RE = /(https?:\/\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?)/i;
const M3U8_RE = /(https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?)/i;
const VTT_RE = /(https?:\/\/[^"'\s<>]+\.vtt(?:\?[^"'\s<>]*)?)/gi;
const SRT_RE = /(https?:\/\/[^"'\s<>]+\.srt(?:\?[^"'\s<>]*)?)/gi;
const EPISODE_RE = /epis[oó]dio\s+(\d+)/i;

function goanimeAvailable() {
  return fs.existsSync(config.GOANIME_EXE);
}

function resolveUrl(base, ref) {
  if (!ref) return '';
  if (ref.startsWith('http')) return ref;
  if (ref.startsWith('/')) return base + ref;
  return `${base}/${ref}`;
}

function normalizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .trim()
    .replace(/[:'"!?.,]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const {
  cleanAnimeName,
  buildSearchQueries,
  findBestMatch: matchBest,
  rankCandidates,
  titleSimilarity,
} = matcher;
const { normalizeSubtitles } = require('./subtitles');

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: `${config.ANIMEFIRE_BASE}/`,
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    throw new Error(`AnimeFire HTTP ${res.status}`);
  }

  return res.text();
}

function extractBloggerUrl(html) {
  const marker = 'https://www.blogger.com/video.g?token=';
  let search = html;
  let offset = 0;

  while (true) {
    const start = search.indexOf(marker);
    if (start < 0) return null;

    const absStart = start + offset;
    let candidate = html.slice(absStart);
    const end = candidate.search(/["' <>\r\n\t]/);
    if (end >= 0) candidate = candidate.slice(0, end);

    try {
      const parsed = new URL(candidate);
      if (parsed.hostname === 'www.blogger.com' && parsed.pathname === '/video.g') {
        const token = parsed.searchParams.get('token');
        if (token && /^[\w-]+$/.test(token)) return candidate;
      }
    } catch {
      /* continue */
    }

    const next = absStart + marker.length;
    if (next >= html.length) return null;
    search = html.slice(next);
    offset = next;
  }
}

function extractSubtitles(html) {
  const subs = [];
  const seen = new Set();

  for (const re of [VTT_RE, SRT_RE]) {
    const matches = html.match(re) || [];
    for (const url of matches) {
      if (!seen.has(url)) {
        seen.add(url);
        let label = 'Legenda';
        if (/pt-?br|pt_br/i.test(url)) label = 'Português (BR)';
        else if (/pt/i.test(url)) label = 'Português';
        else if (/en/i.test(url)) label = 'English';
        subs.push({
          url,
          label,
          format: url.endsWith('.srt') ? 'srt' : 'vtt',
        });
      }
    }
  }

  const $ = cheerio.load(html);
  $('track[kind="subtitles"], track[kind="captions"]').each((_, el) => {
    const src = $(el).attr('src');
    const label = $(el).attr('label') || $(el).attr('srclang') || 'Legenda';
    if (src && !seen.has(src)) {
      seen.add(src);
      subs.push({
        url: resolveUrl(config.ANIMEFIRE_BASE, src),
        label,
        format: src.endsWith('.srt') ? 'srt' : 'vtt',
      });
    }
  });

  return normalizeSubtitles(subs);
}

function extractVideoSources($, html) {
  const sources = [];

  $('[data-video-src]').each((_, el) => {
    const src = $(el).attr('data-video-src');
    const quality = ($(el).attr('data-quality') || '').toLowerCase();
    if (src) {
      sources.push({ url: src, quality: QUALITY_RANK[quality] || 0 });
    }
  });

  if (sources.length) {
    sources.sort((a, b) => b.quality - a.quality);
    return { videoUrl: sources[0].url, type: detectType(sources[0].url) };
  }

  const videoSrc = $('video source').attr('src') || $('video').attr('src');
  if (videoSrc) {
    return { videoUrl: videoSrc, type: detectType(videoSrc) };
  }

  let iframeSrc = '';
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('blogger.com') || src.includes('blogspot.com')) {
      iframeSrc = src;
    }
  });
  if (iframeSrc) {
    return { videoUrl: iframeSrc, type: 'embed' };
  }

  for (const [attr, selector] of [
    ['data-video', 'div[data-video]'],
    ['data-src', 'div[data-src]'],
    ['data-url', 'div[data-url]'],
  ]) {
    const val = $(selector).attr(attr);
    if (val) return { videoUrl: val, type: detectType(val) };
  }

  const blogger = extractBloggerUrl(html);
  if (blogger) return { videoUrl: blogger, type: 'embed' };

  const mp4 = html.match(MP4_RE);
  if (mp4) return { videoUrl: mp4[1], type: 'mp4' };

  const m3u8 = html.match(M3U8_RE);
  if (m3u8) return { videoUrl: m3u8[1], type: 'hls' };

  return null;
}

function detectType(url) {
  if (!url) return 'unknown';
  if (url.includes('.m3u8')) return 'hls';
  if (url.includes('.mp4')) return 'mp4';
  if (url.includes('blogger.com')) return 'embed';
  return 'stream';
}

async function searchAnimeFire(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const url = `${config.ANIMEFIRE_BASE}/pesquisar/${encodeURIComponent(normalized)}`;
  let html;
  try {
    html = await fetchPage(url);
  } catch (err) {
    if (/AnimeFire HTTP (404|429)/i.test(err.message)) return [];
    throw err;
  }
  const $ = cheerio.load(html);
  const results = [];

  $('.row.ml-1.mr-1 a').each((_, el) => {
    const href = $(el).attr('href');
    const rawName = $(el).text().trim();
    const name = cleanAnimeName(rawName);
    if (href && name) {
      results.push({ name, url: resolveUrl(config.ANIMEFIRE_BASE, href), source: 'animefire' });
    }
  });

  if (!results.length) {
    $('.card_ani').each((_, el) => {
      const title = cleanAnimeName($(el).find('.ani_name a').text().trim());
      const href = $(el).find('.ani_name a').attr('href');
      const img = $(el).find('.div_img img').attr('src');
      if (title && href) {
        results.push({
          name: title,
          url: resolveUrl(config.ANIMEFIRE_BASE, href),
          image: img ? resolveUrl(config.ANIMEFIRE_BASE, img) : null,
          source: 'animefire',
        });
      }
    });
  }

  return results;
}

async function getEpisodes(animeUrl) {
  const html = await fetchPage(animeUrl);
  const $ = cheerio.load(html);
  const episodes = [];

  $('a.lEp.epT.divNumEp.smallbox.px-2.mx-1.text-left.d-flex').each((i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href');
    let num = i + 1;
    const match = text.match(EPISODE_RE);
    if (match) num = parseInt(match[1], 10);

    episodes.push({
      number: num,
      label: text || `Episódio ${num}`,
      url: resolveUrl(config.ANIMEFIRE_BASE, href),
    });
  });

  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

async function fetchVideoApi(videoPageUrl) {
  const res = await fetch(videoPageUrl, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: config.ANIMEFIRE_BASE + '/',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`AnimeFire video API HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    return null;
  }

  return res.json();
}

function pickBestQuality(sources) {
  if (!sources?.length) return null;
  const ranked = sources.map((s) => ({
    url: s.src || s.url,
    label: (s.label || '').toLowerCase(),
    quality: QUALITY_RANK[(s.label || '').toLowerCase()] || 0,
  }));
  ranked.sort((a, b) => b.quality - a.quality);
  return ranked[0];
}

async function resolveAnimeFireStream(episodeUrl) {
  const html = await fetchPage(episodeUrl);
  const $ = cheerio.load(html);

  let videoPageUrl = $('[data-video-src]').first().attr('data-video-src');
  if (!videoPageUrl) {
    const fallback = extractVideoSources($, html);
    if (!fallback) throw new Error('Nenhuma fonte de vídeo encontrada');
    return { ...fallback, subtitles: extractSubtitles(html), qualities: [] };
  }

  videoPageUrl = resolveUrl(config.ANIMEFIRE_BASE, videoPageUrl);

  const apiData = await fetchVideoApi(videoPageUrl);
  if (apiData?.data?.length) {
    const best = pickBestQuality(apiData.data);
    const subtitles = [];

    if (apiData.subtitles) {
      for (const sub of apiData.subtitles) {
        subtitles.push({
          url: sub.src || sub.url,
          label: sub.label || sub.lang || 'Legenda',
          format: 'vtt',
        });
      }
    }

    return {
      videoUrl: best.url,
      type: detectType(best.url),
      quality: best.label,
      qualities: apiData.data.map((s) => ({ url: s.src, label: s.label })),
      subtitles: subtitles.length ? subtitles : extractSubtitles(html),
      metadata: apiData.metadata || {},
    };
  }

  const video = extractVideoSources($, html);
  if (!video) throw new Error('Nenhuma fonte de vídeo encontrada');

  return { ...video, subtitles: extractSubtitles(html), qualities: [] };
}

async function getEpisodeStream(episodeUrl) {
  const stream = await resolveAnimeFireStream(episodeUrl);

  return {
    ...stream,
    goanime: {
      available: goanimeAvailable(),
      path: config.GOANIME_PATH,
      version: goanimeAvailable() ? 'installed' : 'not found',
    },
  };
}

function limitQueries(queries, max = config.CLOUD_MODE ? 6 : 12) {
  return queries.slice(0, max);
}

async function searchAnimeFireMulti(queries) {
  const seen = new Set();
  const merged = [];
  const list = limitQueries(queries);

  for (const q of list) {
    const batch = await searchAnimeFire(q).catch(() => []);
    for (const item of batch) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
    if (merged.length >= 8) break;
  }

  return merged;
}

async function findBestMatch(jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const queries = buildSearchQueries(titles);
  const results = await searchAnimeFireMulti(queries);

  if (!results.length) return null;

  const ranked = rankCandidates(results, titles, jikanTitle, options);
  const tryLimit = config.CLOUD_MODE ? 4 : 6;
  for (const candidate of ranked.slice(0, tryLimit)) {
    const episodes = await getEpisodes(candidate.url).catch(() => []);
    if (episodes.length) return candidate;
  }

  return matchBest(results, titles, jikanTitle, options);
}

async function getAnimeFromSource(sourceUrl) {
  const html = await fetchPage(sourceUrl);
  const $ = cheerio.load(html);

  const title =
    cleanAnimeName($('h1').first().text().trim()) ||
    cleanAnimeName($('.ani_name, .anime-title').first().text().trim()) ||
    'Anime';

  const img = $('meta[property="og:image"]').attr('content') ||
    $('.div_img img, .anime-cover img').first().attr('src');
  const synopsis = $('meta[property="og:description"]').attr('content') ||
    $('.sinopse, .synopsis, .descricao').first().text().trim() || '';

  const episodes = await getEpisodes(sourceUrl);

  return {
    title,
    poster: img ? resolveUrl(config.ANIMEFIRE_BASE, img) : null,
    synopsis,
    source: { name: title, url: sourceUrl, source: 'animefire' },
    episodes,
  };
}

module.exports = {
  goanimeAvailable,
  searchAnimeFire,
  searchAnimeFireMulti,
  getEpisodes,
  getEpisodeStream,
  findBestMatch,
  getAnimeFromSource,
  titleSimilarity,
  buildSearchQueries,
};