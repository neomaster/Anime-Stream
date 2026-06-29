const fetch = require('node-fetch');
const config = require('../config');

const cache = new Map();
const CACHE_TTL = 60_000;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function jikanFetch(path, attempt = 0) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  let res;
  try {
    res = await fetch(`${config.JIKAN_BASE}${path}`, {
      headers: { 'User-Agent': config.USER_AGENT },
      timeout: 25000,
    });
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await delay(700 * Math.pow(1.6, attempt));
      return jikanFetch(path, attempt + 1);
    }
    throw new Error('Jikan indisponível (rede)');
  }

  if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
    await delay(900 * Math.pow(1.7, attempt));
    return jikanFetch(path, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Jikan API error: ${res.status}`);
  }

  const data = await res.json();
  cache.set(path, { data, time: Date.now() });
  return data;
}

function pickLocalizedTitle(titles, typePattern) {
  const hit = (titles || []).find((t) => typePattern.test(t.type || ''));
  return hit?.title || null;
}

function formatAnime(anime) {
  const synonyms = (anime.titles || [])
    .map((t) => t.title)
    .filter((t) => t && t !== anime.title);

  const title_portuguese = pickLocalizedTitle(anime.titles, /portuguese|brazil|pt-?br/i);

  const synopsis_pt =
    anime.synopsis && /[áàâãéêíóôõúç]/i.test(anime.synopsis) ? anime.synopsis : null;

  return {
    mal_id: anime.mal_id,
    title: anime.title,
    title_english: anime.title_english,
    title_japanese: anime.title_japanese,
    title_portuguese,
    synonyms,
    synopsis: anime.synopsis,
    synopsis_pt,
    poster: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url,
    poster_small: anime.images?.jpg?.small_image_url,
    score: anime.score,
    episodes: anime.episodes,
    status: anime.status,
    genres: anime.genres?.map((g) => g.name) || [],
    year: anime.year,
    type: anime.type,
    url: anime.url,
  };
}

function searchVariants(query) {
  const base = String(query || '').trim();
  const variants = [base];

  const shorter = base.replace(/\s+(super|ultra|season|temporada|s\d+).*$/i, '').trim();
  if (shorter && shorter !== base) variants.push(shorter);

  const words = base.split(/\s+/).filter(Boolean);
  if (words.length > 3) variants.push(words.slice(0, 3).join(' '));
  if (words.length > 2) variants.push(words.slice(0, 2).join(' '));

  return [...new Set(variants)].filter((q) => q.length >= 2);
}

async function searchAnime(query, limit = 25) {
  let lastErr = null;

  for (const q of searchVariants(query)) {
    try {
      const data = await jikanFetch(
        `/anime?q=${encodeURIComponent(q)}&limit=${limit}&order_by=popularity`
      );
      return (data.data || []).map(formatAnime);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Jikan indisponível');
}

async function searchAnimeSafe(query, limit = 25) {
  try {
    return await searchAnime(query, limit);
  } catch {
    return [];
  }
}

async function getAnimeById(malId) {
  const data = await jikanFetch(`/anime/${malId}/full`);
  return formatAnime(data.data);
}

async function getTopAnime(limit = 12) {
  const data = await jikanFetch(`/top/anime?limit=${limit}`);
  return (data.data || []).map(formatAnime);
}

async function getSeasonAnime() {
  const data = await jikanFetch('/seasons/now?limit=12');
  return (data.data || []).map(formatAnime);
}

async function getTopAnimeSafe(limit = 12) {
  try {
    return await getTopAnime(limit);
  } catch {
    return [];
  }
}

async function getSeasonAnimeSafe() {
  try {
    return await getSeasonAnime();
  } catch {
    return [];
  }
}

module.exports = {
  searchAnime,
  searchAnimeSafe,
  getAnimeById,
  getTopAnime,
  getSeasonAnime,
  getTopAnimeSafe,
  getSeasonAnimeSafe,
  formatAnime,
};