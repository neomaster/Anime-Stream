const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE_URL = process.env.ANIMEUNITY_BASE || 'https://www.animeunity.to';

function headers(referer) {
  return {
    'User-Agent': config.USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: referer || BASE_URL,
  };
}

async function fetchText(url, referer) {
  const res = await fetch(url, { headers: headers(referer), timeout: 45000 });
  if (!res.ok) throw new Error(`AnimeUnity HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url, referer) {
  const res = await fetch(url, { headers: headers(referer), timeout: 45000 });
  if (!res.ok) throw new Error(`AnimeUnity API HTTP ${res.status}`);
  return res.json();
}

async function search(query) {
  const url = `${BASE_URL}/archivio?title=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const raw = $('archivio').attr('records');
  if (!raw) return [];

  const items = JSON.parse(raw);
  return items.map((item) => ({
    id: `${item.id}-${item.slug}`,
    title: item.title || item.title_eng,
    image: item.imageurl || null,
    dub: item.dub === 1 ? 1 : 0,
  }));
}

function parseStreamMeta(embedHtml) {
  const filename = decodeURIComponent((embedHtml.match(/filename=([^&'"]+)/) || [])[1] || '');
  let subtitleLang = null;
  let audioMode = 'legendado';
  let embeddedSubtitles = false;

  if (/\bSUB_ITA\b/i.test(filename)) {
    subtitleLang = 'ita';
    embeddedSubtitles = true;
  } else if (/\bSUB_/i.test(filename)) {
    subtitleLang = 'sub';
    embeddedSubtitles = true;
  }

  if (/\b_ITA\.mp4/i.test(filename) && !/\bSUB_ITA\b/i.test(filename)) {
    audioMode = 'dublado';
    subtitleLang = null;
    embeddedSubtitles = false;
  }

  return { filename, subtitleLang, audioMode, embeddedSubtitles };
}

function extractEmbedSubtitles(embedHtml) {
  const subs = [];
  const seen = new Set();
  const vttRe = /(https?:\/\/[^"'\s<>]+\.vtt(?:\?[^"'\s<>]*)?)/gi;

  for (const url of embedHtml.match(vttRe) || []) {
    if (/thumbnails/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    subs.push({ url, label: 'Legenda', format: 'vtt' });
  }

  return subs;
}

async function fetchAnimeInfo(id) {
  const pageUrl = `${BASE_URL}/anime/${id}`;
  const html = await fetchText(pageUrl, pageUrl);
  const $ = cheerio.load(html);
  const totalEpisodes = parseInt($('video-player').attr('episodes_count') || '0', 10);
  const episodes = [];

  if (totalEpisodes > 0) {
    const batchSize = 120;
    for (let start = 1; start <= totalEpisodes; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalEpisodes);
      const apiUrl = `${BASE_URL}/info_api/${id}/1?start_range=${start}&end_range=${end}`;
      const data = await fetchJson(apiUrl, pageUrl);
      for (const ep of data.episodes || []) {
        episodes.push({
          id: `${id}/${ep.id}`,
          number: parseInt(ep.number, 10) || episodes.length + 1,
          title: ep.title || null,
        });
      }
    }
  }

  return {
    id,
    title: $('h1.title').text().trim(),
    image: $('img.cover').attr('src') || null,
    description: $('.description').text().trim(),
    episodes,
  };
}

async function fetchEpisodeSources(episodeId) {
  const pageUrl = `${BASE_URL}/anime/${episodeId}`;
  const html = await fetchText(pageUrl, BASE_URL);
  const $ = cheerio.load(html);
  const embedUrl = $('video-player').attr('embed_url');
  if (!embedUrl) throw new Error('Embed nao encontrado');

  const embedHtml = await fetchText(embedUrl, pageUrl);
  const $embed = cheerio.load(embedHtml);
  const script = $embed('script:contains("window.video")').text() || '';
  const domain = (script.match(/url:\s*'([^']+)'/) || [])[1];
  const token = (script.match(/token':\s*'([^']+)'/) || [])[1];
  const expires = (script.match(/expires':\s*'([^']+)'/) || [])[1];
  if (!domain || !token) throw new Error('Token de video nao encontrado');

  const defaultUrl = `${domain}${domain.includes('?') ? '&' : '?'}token=${token}&referer=&expires=${expires}&h=1`;
  const manifest = await fetchText(defaultUrl, embedUrl);
  const sources = [];

  if (manifest.includes('EXTM3U')) {
    const parts = manifest.split('#EXT-X-STREAM-INF:');
    for (const part of parts) {
      if (!part.includes('BANDWIDTH')) continue;
      const lines = part.split('\n');
      const streamUrl = lines.find((l) => l.startsWith('http'));
      const resLine = part.match(/RESOLUTION=\d+x(\d+)/);
      if (streamUrl) {
        sources.push({
          url: streamUrl.trim(),
          quality: resLine ? `${resLine[1]}p` : 'auto',
          isM3U8: true,
        });
      }
    }
  }

  sources.push({ url: defaultUrl, quality: 'default', isM3U8: true });

  const streamMeta = parseStreamMeta(embedHtml);
  const subtitles = extractEmbedSubtitles(embedHtml);

  return {
    sources,
    subtitles,
    ...streamMeta,
  };
}

module.exports = {
  name: 'AnimeUnity',
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};