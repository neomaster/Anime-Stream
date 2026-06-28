const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE_URL = (process.env.ANIME_SATURN_BASE || 'https://www.animesaturn.cx').replace(/\/+$/, '') + '/';

function headers(referer) {
  return {
    'User-Agent': config.USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: referer || BASE_URL,
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function fetchText(url, referer, timeoutMs = 35000) {
  const res = await fetch(url, { headers: headers(referer), timeout: timeoutMs });
  if (!res.ok) throw new Error(`AnimeSaturn HTTP ${res.status}`);
  return res.text();
}

async function search(query) {
  const url = `${BASE_URL}animelist?search=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const results = [];

  $('ul.list-group li').each((_, element) => {
    const link = $(element).find('h3 a');
    const href = link.attr('href') || $(element).find('a.thumb').attr('href') || '';
    const id = href.split('/').filter(Boolean).pop() || '';
    const title = link.text().trim();
    const image = $(element).find('img.copertina-archivio').attr('src') || null;
    if (id && title) {
      results.push({ id, title, image });
    }
  });

  return results;
}

async function fetchAnimeInfo(id) {
  const pageUrl = `${BASE_URL}anime/${id}`;
  const html = await fetchText(pageUrl, pageUrl);
  const $ = cheerio.load(html);

  const info = {
    id,
    title: $('div.container.anime-title-as> b').text().trim(),
    malID: ($('a[href^="https://myanimelist.net/anime/"]').attr('href') || '').match(/\/anime\/(\d+)/)?.[1],
    image: $('img.img-fluid').attr('src') || undefined,
    description: $('#full-trama').text().trim(),
    episodes: [],
  };

  const episodes = [];
  $('.tab-pane.fade').each((_, pane) => {
    $(pane)
      .find('.bottone-ep')
      .each((__, el) => {
        const link = $(el).attr('href') || '';
        const epId = link.split('/').filter(Boolean).pop() || '';
        const num = parseInt($(el).text().trim().replace('Episodio ', ''), 10);
        if (epId) {
          episodes.push({
            number: Number.isFinite(num) ? num : episodes.length + 1,
            id: epId,
          });
        }
      });
  });

  info.episodes = episodes.sort((a, b) => a.number - b.number);
  return info;
}

function extractSourcesFromHtml(html) {
  const $ = cheerio.load(html);
  const sources = [];

  const push = (url) => {
    if (!url || (!url.includes('.mp4') && !url.includes('.m3u8'))) return;
    if (sources.some((s) => s.url === url)) return;
    sources.push({ url, isM3U8: url.includes('.m3u8'), quality: 'default' });
  };

  $('video source').each((_, el) => push($(el).attr('src')));
  push($('video#myvideo').attr('src'));

  $('script').each((_, el) => {
    const text = $(el).text();
    for (const line of text.split('\n')) {
      if (!line.includes('file:')) continue;
      const url = line.split('file:')[1].trim().replace(/['",]/g, '').trim();
      push(url);
    }
    for (const url of text.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*/gi) || []) {
      push(url);
    }
  });

  return sources;
}

async function fetchEpisodeSources(episodeId) {
  const epUrl = `${BASE_URL}ep/${episodeId}`;
  const epHtml = await fetchText(epUrl, BASE_URL);
  const $ep = cheerio.load(epHtml);

  let watchUrl =
    $ep("a:contains('Guarda lo streaming')").attr('href') ||
    $ep("div:contains('Guarda lo streaming')").parent('a').attr('href') ||
    $ep("a[href*='watch']").attr('href');

  if (!watchUrl) throw new Error('Watch URL not found');

  if (!watchUrl.startsWith('http')) {
    watchUrl = watchUrl.startsWith('/') ? `${BASE_URL.replace(/\/$/, '')}${watchUrl}` : `${BASE_URL}${watchUrl}`;
  }

  const watchHtml = await fetchText(watchUrl, epUrl);
  const sources = extractSourcesFromHtml(watchHtml);
  if (!sources.length) throw new Error('Nenhuma fonte de video encontrada');

  return {
    sources,
    subtitles: [],
    headers: { Referer: watchUrl, 'User-Agent': config.USER_AGENT },
  };
}

module.exports = {
  BASE_URL,
  search,
  fetchAnimeInfo,
  fetchEpisodeSources,
};