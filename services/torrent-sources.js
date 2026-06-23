const { buildSearchQueries, titleSimilarity } = require('./matcher');
const x1337 = require('./x1337');
const nyaa = require('./nyaa');
const vault = require('./source-vault');
const cache = require('./cache');
const config = require('../config');

const PROVIDER_X7F = 'x7f';
const PROVIDER_NYAA = 'nya';
const PROVIDER_TAG = 'nya+x7f';

const SOURCE_LABELS = {
  [PROVIDER_NYAA]: 'Nyaa',
  [PROVIDER_X7F]: '1337x',
};

function sourceLabel(provider) {
  return SOURCE_LABELS[provider] || provider || 'índice';
}

function maskToken(title) {
  const words = String(title || '')
    .replace(/[^\w\sáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  return words
    .map((w) => {
      if (w.length <= 2) return '██';
      const head = w.slice(0, 1);
      const tail = w.slice(-1);
      const mid = '█'.repeat(Math.min(8, Math.max(2, w.length - 2)));
      return `${head}${mid}${tail}`;
    })
    .join(' ');
}

function bandCount(n) {
  const v = parseInt(n, 10) || 0;
  if (v >= 200) return '200+';
  if (v >= 100) return '100+';
  if (v >= 50) return '50+';
  if (v >= 10) return '10+';
  if (v >= 1) return '1+';
  return '—';
}

function blurSize(size) {
  const raw = String(size || '').trim();
  const m = raw.match(/([\d.]+)\s*([KMGT]?B)/i);
  if (!m) return '∿∿∿';
  const unit = m[2].toUpperCase();
  const num = parseFloat(m[1]);
  const bucket = num >= 10 ? Math.floor(num) : Math.floor(num * 10) / 10;
  return `~${bucket}x ${unit}`;
}

function inferQuality(name) {
  const n = String(name).toLowerCase();
  if (/2160|4k/.test(n)) return '4K';
  if (/1080/.test(n)) return '1080p';
  if (/720/.test(n)) return '720p';
  if (/480/.test(n)) return '480p';
  return 'SD';
}

function normalizeTorrentName(name) {
  return String(name || '')
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractEpisodeNumber(name) {
  const raw = String(name || '');
  const patterns = [
    /\bS\d{1,2}E(\d{1,3})\b/i,
    /\bE(?:P?)?\.?\s*0?(\d{1,3})\b/i,
    /\bEpisode\s*0?(\d{1,3})\b/i,
    /\bEp\.?\s*0?(\d{1,3})\b/i,
    /\b0?(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\b/i,
    /\[\s*0?(\d{1,3})\s*\]/,
    /\s-\s*0?(\d{1,3})(?:\s|\.|\[|$)/,
    /\b0?(\d{1,3})(?:\s*v\d|\s*\(|\s*\[)/i,
  ];

  for (const re of patterns) {
    const match = raw.match(re);
    if (!match) continue;
    const episode = parseInt(match[1], 10);
    if (episode >= 1 && episode <= 999) return episode;
  }
  return null;
}

function isBatchPack(name) {
  return /\b(batch|complete|full\s*season|season\s*\d*\s*complete|pack|cole[cç][aã]o)\b/i.test(
    String(name || '')
  );
}

function titleTokens(titles) {
  const tokens = new Set();
  for (const t of titles) {
    normalizeTorrentName(t)
      .split(' ')
      .filter((w) => w.length > 2)
      .forEach((w) => tokens.add(w));
  }
  return [...tokens];
}

function scoreTorrentRow(row, titles, episodeNum) {
  const normalized = normalizeTorrentName(row.name);
  let best = 0;
  for (const t of titles) {
    best = Math.max(best, titleSimilarity(t, row.name));
    best = Math.max(best, titleSimilarity(t, normalized));
  }

  const tokens = titleTokens(titles);
  let hits = 0;
  for (const tok of tokens) {
    if (normalized.includes(tok)) hits += 1;
  }
  if (hits > 0) {
    best = Math.max(best, Math.min(0.95, 0.35 + hits * 0.12));
  }

  if (/frieren|sousou/i.test(normalized) && titles.some((t) => /frieren|sousou/i.test(t))) {
    best = Math.max(best, 0.72);
  }

  const seedBoost = Math.min(0.12, (row.seeds || 0) / 500);
  let score = best + seedBoost;

  if (row.provider === PROVIDER_NYAA) score += 0.06;

  if (/\.(mp4|webm|m4v)$/i.test(row.name)) score += 0.2;
  else if (/\.mkv$/i.test(row.name)) score += 0.05;

  if (episodeNum) {
    const ep = extractEpisodeNumber(row.name);
    const epStr = String(episodeNum).padStart(2, '0');
    if (ep === episodeNum) score += 0.35;
    else if (!ep && isBatchPack(row.name)) score += 0.08;
    else if (
      normalized.includes(`e${epStr}`) ||
      normalized.includes(`ep${episodeNum}`) ||
      normalized.includes(`episode ${episodeNum}`) ||
      new RegExp(`\\b0?${episodeNum}\\b`).test(normalized)
    ) {
      score += 0.2;
    }
  }

  return score;
}

function episodeMatchBand(row, episodeNum) {
  const ep = extractEpisodeNumber(row.name);
  if (ep === episodeNum) return 2;
  if (!ep && isBatchPack(row.name)) return 1;
  const norm = normalizeTorrentName(row.name);
  if (
    norm.includes(`e${String(episodeNum).padStart(2, '0')}`) ||
    norm.includes(`ep${episodeNum}`) ||
    norm.includes(`episode ${episodeNum}`)
  ) {
    return 1;
  }
  return 0;
}

function toPublicItem(row, ref) {
  const episode = extractEpisodeNumber(row.name);
  return {
    ref,
    label: maskToken(row.name),
    quality: inferQuality(row.name),
    sizeBand: blurSize(row.size),
    seeders: row.seeds ?? 0,
    leechers: row.leeches ?? 0,
    seedersBand: bandCount(row.seeds),
    leechersBand: bandCount(row.leeches),
    ageBand: row.date ? 'recent' : 'unknown',
    provider: row.provider || PROVIDER_X7F,
    matchBand: row._score >= 0.7 ? 'high' : row._score >= 0.45 ? 'mid' : 'low',
    episode: episode || null,
    isPack: episode ? false : isBatchPack(row.name),
  };
}

function rankRows(rows, titles, episodeNum, options = {}) {
  const minScore = options.minScore ?? 0.18;
  const requireEpisode = options.requireEpisode ?? false;

  return rows
    .map((row) => ({
      ...row,
      _score: scoreTorrentRow(row, titles, episodeNum),
      _episodeMatch: episodeNum ? episodeMatchBand(row, episodeNum) : 0,
    }))
    .filter((row) => row._score >= minScore)
    .filter((row) => !requireEpisode || row._episodeMatch > 0)
    .sort(
      (a, b) =>
        b._episodeMatch - a._episodeMatch ||
        b._score - a._score ||
        b.seeds - a.seeds
    );
}

function stubFromRow(row) {
  return {
    magnet: row.magnet || null,
    href: row.href,
    name: row.name,
    mirrorBase: row.mirrorBase || null,
    provider: row.provider || PROVIDER_X7F,
    seeds: row.seeds ?? 0,
    leeches: row.leeches ?? 0,
    infoHash: row.infoHash || null,
  };
}

function sourceSnapshot(rowOrStub) {
  const provider = rowOrStub.provider || PROVIDER_X7F;
  return {
    provider,
    source: sourceLabel(provider),
    seeders: rowOrStub.seeds ?? rowOrStub.seeders ?? null,
    leechers: rowOrStub.leeches ?? rowOrStub.leechers ?? null,
    label: maskToken(rowOrStub.name),
  };
}

async function fetchFromNyaa(queries, fetchLimit) {
  if (!config.NYAA_ENABLED) return [];
  try {
    const rows = await nyaa.searchIndex(queries, Math.max(fetchLimit || 24, 20));
    return rows.map((row) => ({ ...row, provider: PROVIDER_NYAA }));
  } catch (err) {
    err.provider = PROVIDER_NYAA;
    err.source = sourceLabel(PROVIDER_NYAA);
    throw err;
  }
}

async function fetchFromX1337(queries, fetchLimit) {
  try {
    const rows = await x1337.searchIndex(queries, Math.max(fetchLimit || 24, 20));
    return rows.map((row) => ({ ...row, provider: PROVIDER_X7F }));
  } catch (err) {
    err.provider = PROVIDER_X7F;
    err.source = sourceLabel(PROVIDER_X7F);
    throw err;
  }
}

async function fetchRankedRows(titles, episodeNum, options = {}) {
  const list = titles.filter(Boolean);
  const episode = episodeNum ? parseInt(episodeNum, 10) : null;

  const baseQueries = buildSearchQueries(list).slice(0, 5);
  const epQueries = episode
    ? [
        `${list[0]} ${episode}`,
        `${list[0]} episode ${episode}`,
        `${list[0]} ep ${episode}`,
        `${list[0]} E${String(episode).padStart(2, '0')}`,
        `${list[0]} S01E${String(episode).padStart(2, '0')}`,
      ]
    : [];

  const queries = [...new Set([...epQueries, ...baseQueries, list[0]])].slice(0, 10);
  const fetchLimit = Math.max(options.fetchLimit || 24, 20);
  const indexErrors = [];

  const [nyaaSettled, x7Settled] = await Promise.allSettled([
    fetchFromNyaa(queries, fetchLimit),
    fetchFromX1337(queries, fetchLimit),
  ]);

  let rows = [];

  if (nyaaSettled.status === 'fulfilled') {
    rows = rows.concat(nyaaSettled.value);
  } else {
    indexErrors.push({
      provider: PROVIDER_NYAA,
      source: sourceLabel(PROVIDER_NYAA),
      error: nyaaSettled.reason?.message || 'Nyaa indisponível',
      code: nyaaSettled.reason?.code || 'INDEX_UNAVAILABLE',
    });
  }

  if (x7Settled.status === 'fulfilled') {
    rows = rows.concat(x7Settled.value);
  } else {
    indexErrors.push({
      provider: PROVIDER_X7F,
      source: sourceLabel(PROVIDER_X7F),
      error: x7Settled.reason?.message || '1337x indisponível',
      code: x7Settled.reason?.code || 'INDEX_UNAVAILABLE',
    });
  }

  if (!rows.length) {
    const err = new Error('Índices Nyaa e 1337x indisponíveis no momento');
    err.code = 'INDEX_UNAVAILABLE';
    err.sources = indexErrors;
    throw err;
  }

  let ranked = rankRows(rows, list, episode, { minScore: 0.2, requireEpisode: true });

  if (!ranked.length && episode) {
    ranked = rankRows(rows, list, episode, { minScore: 0.15, requireEpisode: false }).filter(
      (row) => row._episodeMatch > 0 || row._score >= 0.35
    );
  }

  if (!ranked.length) {
    ranked = rankRows(rows, list, episode, { minScore: 0.12, requireEpisode: false }).slice(0, 12);
  }

  ranked._indexErrors = indexErrors;
  return ranked.slice(0, options.limit || 8);
}

async function catalogForEpisode(titles, episodeNum, options = {}) {
  const list = titles.filter(Boolean);
  const episode = parseInt(episodeNum, 10);
  if (!list.length || !episode || episode < 1) {
    return { items: [], provider: PROVIDER_TAG, episode };
  }

  const cacheKey = `alt:ep:${list[0]}:${episode}:${options.limit || 12}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ranked = await fetchRankedRows(list, episode, options);

  const items = [];
  for (const row of ranked) {
    const ref = vault.storePayload(stubFromRow(row), {
      provider: row.provider,
      score: row._score,
      episode,
      seeds: row.seeds,
      leeches: row.leeches,
    });
    items.push({ ...toPublicItem(row, ref), _row: row });
  }

  const payload = {
    provider: PROVIDER_TAG,
    episode,
    items: items.map(({ _row, ...item }) => item),
    notice: 'Fontes vinculadas ao episódio selecionado.',
  };
  cache.set(cacheKey, payload, 8 * 60 * 1000);
  return payload;
}

async function catalogForTitles(titles, options = {}) {
  const list = titles.filter(Boolean);
  if (!list.length) return { items: [], provider: PROVIDER_TAG };

  const cacheKey = `alt:${list[0]}:${options.limit || 12}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ranked = await fetchRankedRows(list, null, options);

  const items = [];
  for (const row of ranked) {
    const ref = vault.storePayload(stubFromRow(row), {
      provider: row.provider,
      score: row._score,
      seeds: row.seeds,
      leeches: row.leeches,
    });
    items.push(toPublicItem(row, ref));
  }

  const payload = {
    provider: PROVIDER_TAG,
    items,
    notice: 'Endereços de fonte não são expostos ao cliente.',
  };
  cache.set(cacheKey, payload, 8 * 60 * 1000);
  return payload;
}

async function resolveMagnet(ref) {
  const stub = vault.readPayload(ref);
  if (!stub) {
    const err = new Error('Ref inválida ou expirada');
    err.code = 'REF_EXPIRED';
    throw err;
  }

  if (stub.magnet) return stub.magnet;

  if (stub.provider === PROVIDER_NYAA && stub.infoHash) {
    const magnet = nyaa.buildMagnet(stub.infoHash, stub.name);
    if (magnet) {
      vault.updatePayload(ref, { ...stub, magnet }, { provider: PROVIDER_NYAA, resolved: true });
      return magnet;
    }
  }

  if (!stub.href) {
    const err = new Error('Torrent sem link associado');
    err.code = 'INVALID_HREF';
    throw err;
  }

  const { magnet, title, pageUrl } = await x1337.fetchMagnetForHref(stub.href, stub.mirrorBase);
  vault.updatePayload(
    ref,
    {
      magnet,
      href: pageUrl || stub.href,
      name: title || stub.name,
      mirrorBase: stub.mirrorBase,
      provider: stub.provider || PROVIDER_X7F,
      seeds: stub.seeds,
      leeches: stub.leeches,
    },
    { provider: stub.provider || PROVIDER_X7F, resolved: true }
  );
  return magnet;
}

async function reserveRef(ref, clientHint = '') {
  const stub = vault.readPayload(ref);
  if (!stub) return { ok: false, error: 'Ref inválida ou expirada', code: 'REF_EXPIRED' };

  await resolveMagnet(ref).catch(() => null);

  const ticket = vault.createDispatchToken(ref, clientHint);
  if (!ticket) return { ok: false, error: 'Não foi possível reservar', code: 'RESERVE_FAILED' };

  return {
    ok: true,
    ticket,
    status: 'reserved',
    provider: stub.provider || PROVIDER_TAG,
    source: sourceLabel(stub.provider),
    label: maskToken(stub.name),
    seeders: stub.seeds ?? null,
    leechers: stub.leeches ?? null,
    expiresIn: 90,
  };
}

function dispatchTicket(ticket) {
  const payload = vault.consumeDispatch(ticket);
  if (!payload?.magnet) return null;
  return payload;
}

async function openForRef(ref) {
  const stub = vault.readPayload(ref);
  if (!stub) {
    return { ok: false, error: 'Fonte inválida ou expirada', code: 'REF_EXPIRED' };
  }

  const snap = sourceSnapshot(stub);

  try {
    const magnet = await resolveMagnet(ref);
    return {
      ok: true,
      magnet,
      label: snap.label,
      quality: inferQuality(stub.name),
      provider: snap.provider,
      source: snap.source,
      seeders: snap.seeders,
      leechers: snap.leechers,
      mode: 'magnet',
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Não foi possível obter o magnet',
      code: err.code || 'MAGNET_RESOLVE_FAILED',
      provider: snap.provider,
      source: snap.source,
      seeders: snap.seeders,
      leechers: snap.leechers,
    };
  }
}

async function openForEpisode(titles, episodeNum) {
  const episode = parseInt(episodeNum, 10);
  let catalog;
  let rankedRows = [];

  try {
    rankedRows = await fetchRankedRows(titles, episode, { limit: 8, fetchLimit: 30 });
    catalog = {
      items: [],
    };
    for (const row of rankedRows) {
      const ref = vault.storePayload(stubFromRow(row), {
        provider: row.provider,
        score: row._score,
        episode,
        seeds: row.seeds,
        leeches: row.leeches,
      });
      catalog.items.push({ ...toPublicItem(row, ref), ref, _row: row });
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err.code === 'INDEX_UNAVAILABLE'
          ? 'Índices Nyaa e 1337x indisponíveis no momento. Tente novamente em instantes.'
          : err.message || 'Falha ao consultar os índices',
      code: err.code || 'INDEX_UNAVAILABLE',
      sources: err.sources || undefined,
    };
  }

  if (!catalog.items.length) {
    return {
      ok: false,
      error: `Nenhum torrent encontrado para o episódio ${episode}. Tente outro episódio ou assista online.`,
      code: 'NOT_FOUND',
      episode,
    };
  }

  const errors = [];
  const triedSources = [];
  const candidates = catalog.items.slice(0, 8);

  for (const item of candidates) {
    const snap = sourceSnapshot(item._row || item);
    const opened = await openForRef(item.ref);
    const entry = {
      ref: item.ref,
      seeders: snap.seeders,
      leechers: snap.leechers,
      label: snap.label,
      quality: item.quality,
      ok: opened.ok,
      code: opened.ok ? undefined : opened.code,
    };
    triedSources.push(entry);

    if (opened.ok) {
      return {
        ...opened,
        episode,
        ref: item.ref,
        candidates: candidates.map((i) => i.ref),
        triedSources,
        alternatives: catalog.items
          .filter((i) => i.ref !== item.ref)
          .slice(0, 3)
          .map((i) => ({
            ref: i.ref,
            label: i.label,
            quality: i.quality,
            isPack: i.isPack,
            seedersBand: i.seedersBand,
            leechersBand: i.leechersBand,
          })),
      };
    }
    errors.push(opened.error);
  }

  const last = triedSources[triedSources.length - 1] || {};
  return {
    ok: false,
    error: errors[0] || 'Não foi possível resolver o magnet para este episódio',
    code: 'MAGNET_RESOLVE_FAILED',
    tried: catalog.items.length,
    triedSources,
    provider: last.provider,
    source: last.source,
    seeders: last.seeders,
    leechers: last.leechers,
    episode,
  };
}

module.exports = {
  catalogForTitles,
  catalogForEpisode,
  reserveRef,
  dispatchTicket,
  openForRef,
  openForEpisode,
  maskToken,
  sourceLabel,
  PROVIDER_TAG,
  PROVIDER_X7F,
  PROVIDER_NYAA,
  SOURCE_LABELS,
};