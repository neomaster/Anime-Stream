const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../config');

const BASE = 'https://legendas.net';

async function searchAutocomplete(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const res = await fetch(`${BASE}/search-autocomplete?query=${encodeURIComponent(q)}`, {
    headers: {
      'User-Agent': config.USER_AGENT,
      Accept: 'application/json',
      Referer: `${BASE}/`,
    },
    timeout: 20000,
  });

  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function pickReleaseForEpisode(item, season, episode) {
  const releases = item.releases || [];
  const exact = releases.find(
    (r) =>
      !r.is_pack &&
      Number(r.tv_season) === season &&
      Number(r.tv_episode) === episode
  );
  if (exact) return exact;

  const pack = releases.find((r) => r.is_pack && Number(r.tv_season) === season);
  return pack || releases[0] || null;
}

async function fetchSubtitleFileUrl(legendaPageUrl) {
  const res = await fetch(legendaPageUrl, {
    headers: { 'User-Agent': config.USER_AGENT, Referer: BASE },
    timeout: 25000,
  });
  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);

  const dl =
    $('a[href*="/download/"]').attr('href') ||
    $('a.btn-download').attr('href') ||
    $('a[href$=".srt"]').attr('href') ||
    $('a[href$=".zip"]').attr('href');

  if (!dl) return null;
  return dl.startsWith('http') ? dl : `${BASE}${dl.startsWith('/') ? '' : '/'}${dl}`;
}

async function searchPtBrSubtitles(titles, episodeNumber, season = 1) {
  const queries = [...new Set((titles || []).filter(Boolean))].slice(0, 5);
  const out = [];

  for (const query of queries) {
    const items = await searchAutocomplete(query);
    for (const item of items) {
      if (item.type === 'user' || item.type === 'movie') continue;
      const release = pickReleaseForEpisode(item, season, episodeNumber);
      if (!release?.id || !item.tmdb_id) continue;

      const pageUrl = `${BASE}/tv_legenda?movie_id=${item.tmdb_id}&legenda_id=${release.id}`;
      const fileUrl = await fetchSubtitleFileUrl(pageUrl);
      if (!fileUrl) continue;

      out.push({
        url: fileUrl,
        label: `Português (BR) · ${release.release_name || item.name}`,
        format: fileUrl.endsWith('.zip') ? 'zip' : 'srt',
        lang: 'pt-BR',
        source: 'legendas.net',
        provider: 'legendas.net',
      });
      if (out.length >= 2) return out;
    }
    if (out.length) break;
  }

  return out;
}

module.exports = {
  searchAutocomplete,
  searchPtBrSubtitles,
};