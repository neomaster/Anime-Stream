const fetch = require('node-fetch');
const config = require('../config');
const goanime = require('./goanime');
const legendasNet = require('./legendas-net');
const { normalizeSubtitles } = require('./subtitles');

function hasPtBrSubs(subs) {
  return (subs || []).some((sub) => {
    const hay = `${sub.lang || ''} ${sub.label || ''} ${sub.url || ''}`.toLowerCase();
    return /pt-br|pt_br|\bpt\b|portugu[eê]s/.test(hay);
  });
}

function needsPtBrSubs(stream) {
  if (hasPtBrSubs(stream.subtitles)) return false;
  if (stream.embeddedSubtitles && /^pt/i.test(stream.subtitleLang || '')) return false;
  return true;
}

async function fetchAnimeFireEpisodeSubs(animeUrl, episodeNumber) {
  if (!animeUrl || !episodeNumber) return [];

  try {
    const eps = await goanime.getEpisodes(animeUrl);
    const ep = eps.find((e) => e.number === episodeNumber);
    if (!ep?.url) return [];

    const stream = await goanime.getEpisodeStream(ep.url);
    if (stream?.subtitles?.length) return stream.subtitles;
    if (stream?.embeddedSubtitles && /^pt/i.test(stream.subtitleLang || '')) {
      return {
        embedded: true,
        subtitleLang: stream.subtitleLang || 'pt-BR',
        subtitleLangLabel: stream.subtitleLangLabel || 'Português (BR)',
      };
    }
  } catch (err) {
    console.warn('[subtitle-sources] AnimeFire', err.message);
  }

  return [];
}

async function findAnimeFireMatch(titles, options = {}) {
  const queries = [...new Set((titles || []).filter(Boolean))].slice(0, 4);
  for (const q of queries) {
    const results = await goanime.searchAnimeFire(q).catch(() => []);
    if (!results.length) continue;

    const ranked = await goanime.findBestMatch(
      titles[0] || q,
      titles.slice(1),
      { ...options, audioPref: options.audioPref || 'legendado' }
    );
    if (ranked?.url) return ranked;
  }
  return null;
}

async function fetchFromWyzie(titles, episodeNumber) {
  const apiKey = process.env.WYZIE_API_KEY;
  if (!apiKey || !episodeNumber) return [];

  const release = (titles || [])
    .map((t) =>
      String(t || '')
        .replace(/[^\w\s-]/g, ' ')
        .trim()
    )
    .filter((t) => t.length >= 4)
    .slice(0, 3)
    .join(',');

  if (!release) return [];

  const params = new URLSearchParams({
    release,
    season: '1',
    episode: String(episodeNumber),
    language: 'pt-BR,pt,pob',
    format: 'srt,vtt',
    source: 'opensubtitles,subdl',
    key: apiKey,
  });

  try {
    const res = await fetch(`https://sub.wyzie.io/search?${params}`, {
      headers: { 'User-Agent': config.USER_AGENT, Accept: 'application/json' },
      timeout: 20000,
    });
    if (!res.ok) return [];

    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.subtitles || data?.results || [];
    return list
      .filter((item) => item?.url && /pt|pob|portuguese/i.test(`${item.language} ${item.display}`))
      .slice(0, 3)
      .map((item) => ({
        url: item.url,
        label: item.display || 'Português (BR)',
        format: (item.format || 'srt').toLowerCase(),
        lang: 'pt-BR',
        source: 'wyzie',
      }));
  } catch (err) {
    console.warn('[subtitle-sources] Wyzie', err.message);
    return [];
  }
}

async function enrichStreamSubtitles(stream, ctx = {}) {
  if (!stream || !needsPtBrSubs(stream)) {
    return {
      ...stream,
      subtitles: normalizeSubtitles(stream.subtitles || []),
    };
  }

  const collected = [...(stream.subtitles || [])];
  let embeddedPatch = null;

  const tryUrls = [];
  if (ctx.sourceMatch?.source === 'animefire' && ctx.sourceMatch.url) {
    tryUrls.push(ctx.sourceMatch.url);
  }
  if (ctx.animefireUrl) tryUrls.push(ctx.animefireUrl);

  for (const url of tryUrls) {
    const result = await fetchAnimeFireEpisodeSubs(url, ctx.episodeNumber);
    if (result?.embedded) {
      embeddedPatch = result;
      break;
    }
    if (Array.isArray(result) && result.length) {
      collected.push(...result);
      break;
    }
  }

  if (!hasPtBrSubs(collected) && !embeddedPatch) {
    const afMatch =
      ctx.animefireMatch ||
      (await findAnimeFireMatch(ctx.titles, { audioPref: ctx.audioPref || 'legendado' }));
    if (afMatch?.url && !tryUrls.includes(afMatch.url)) {
      const result = await fetchAnimeFireEpisodeSubs(afMatch.url, ctx.episodeNumber);
      if (result?.embedded) embeddedPatch = result;
      else if (Array.isArray(result)) collected.push(...result);
    }
  }

  if (!hasPtBrSubs(collected) && !embeddedPatch) {
    collected.push(...(await legendasNet.searchPtBrSubtitles(ctx.titles, ctx.episodeNumber)));
  }

  if (!hasPtBrSubs(collected) && !embeddedPatch) {
    collected.push(...(await fetchFromWyzie(ctx.titles, ctx.episodeNumber)));
  }

  const subtitles = normalizeSubtitles(collected);
  const out = { ...stream, subtitles };

  if (embeddedPatch) {
    out.embeddedSubtitles = true;
    out.subtitleLang = embeddedPatch.subtitleLang;
    out.subtitleLangLabel = embeddedPatch.subtitleLangLabel;
  }

  return out;
}

module.exports = {
  hasPtBrSubs,
  needsPtBrSubs,
  enrichStreamSubtitles,
  fetchAnimeFireEpisodeSubs,
  findAnimeFireMatch,
  fetchFromWyzie,
};