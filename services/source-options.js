const config = require('../config');
const cache = require('./cache');
const catalog = require('./catalog-sources');
const consumet = require('./consumet-stream');
const { rankCandidates, buildPrioritizedQueries } = require('./matcher');
const { validateSourceCandidate } = require('./source-validator');
const subtitleSources = require('./subtitle-sources');
const legendasNet = require('./legendas-net');

const PROVIDER_LABELS = {
  animefire: 'AnimeFire',
  animeunity: 'AnimeUnity',
  animesaturn: 'AnimeSaturn',
};

const SOURCE_PRIORITY = { animefire: 0, animeunity: 1, animesaturn: 2 };

function encodeSourceId(url) {
  return Buffer.from(String(url || ''), 'utf8').toString('base64url');
}

function decodeSourceId(id) {
  try {
    return Buffer.from(String(id || ''), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function detectAudioLabel(candidate) {
  const ref = `${candidate.name || ''} ${candidate.url || ''}`.toLowerCase();
  if (/dublad|_dub_|dub\b/.test(ref)) return 'Dublado';
  if (/legendad|sub\b|sub_ita/.test(ref)) return 'Legendado';
  return 'Original';
}

function sortVersions(list, audioPref) {
  return [...list].sort((a, b) => {
    const ptDiff = Number(b.subtitlePtBr) - Number(a.subtitlePtBr);
    if (ptDiff) return ptDiff;
    if (audioPref === 'dublado') {
      const dubDiff = Number(/dublad/i.test(b.audioLabel)) - Number(/dublad/i.test(a.audioLabel));
      if (dubDiff) return dubDiff;
    }
    const srcDiff =
      (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9);
    if (srcDiff) return srcDiff;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

function probeSubtitleHeuristic(candidate) {
  const ref = `${candidate.name || ''} ${candidate.url || ''}`.toLowerCase();
  const isDub = /dublad|_dub_|\bdub\b/.test(ref);
  const isIta = /\(ita\)|sub_ita|_ita\b|-ita\b/.test(ref);

  if (candidate.source === 'animefire' && !isDub) {
    return {
      ptBr: true,
      label: 'PT-BR embutida (AnimeFire)',
      type: 'embedded',
      sources: ['animefire-embedded'],
    };
  }

  if (isDub) {
    return {
      ptBr: true,
      label: 'Áudio dublado PT-BR',
      type: 'audio',
      sources: ['dublado'],
    };
  }

  if (isIta) {
    return {
      ptBr: false,
      label: 'Legenda italiana embutida',
      type: 'embedded-other',
      sources: ['ita-embedded'],
    };
  }

  return {
    ptBr: false,
    label: 'Legenda não confirmada em PT-BR',
    type: 'unknown',
    sources: [],
  };
}

async function probeExternalPtBr(titles, episodeNumber) {
  const [legendas, wyzie] = await Promise.all([
    legendasNet.searchPtBrSubtitles(titles, episodeNumber).catch(() => []),
    subtitleSources.fetchFromWyzie(titles, episodeNumber).catch(() => []),
  ]);
  const merged = [...legendas, ...wyzie];
  if (!merged.length) return null;
  return {
    ptBr: true,
    type: 'external',
    label: `PT-BR externa (${merged.map((s) => s.source || 'web').join(', ')})`,
    sources: merged.map((s) => s.source || 'external'),
  };
}

function mergeSubtitleProbe(base, external) {
  if (base.ptBr) {
    return { ...base, sources: [...new Set(base.sources)] };
  }
  if (external) {
    return {
      ptBr: true,
      label: external.label,
      type: external.type,
      sources: [...new Set([...base.sources, ...external.sources])],
    };
  }
  return { ...base, sources: [...new Set(base.sources)] };
}

async function validateCandidate(candidate, options, readMalId) {
  const eps = await consumet.getEpisodesForCandidate(candidate).catch(() => []);
  if (!eps.length) return null;

  const validation = await validateSourceCandidate(
    candidate,
    {
      malId: options.malId,
      jikanTitle: options.jikanTitle,
      altTitles: options.altTitles,
      expectedEpisodes: options.expectedEpisodes,
      status: options.status,
      episodes: eps,
      matchScore: candidate.matchScore || 0,
      fastPath: false,
    },
    readMalId
  );

  if (!validation.ok) return null;
  return eps;
}

async function discoverVersions(jikanTitle, alternatives = [], options = {}) {
  const titles = [jikanTitle, ...alternatives].filter(Boolean);
  const audioPref = options.audioPref === 'dublado' ? 'dublado' : 'legendado';
  const cacheKey = `versions:v1:${options.malId}:${audioPref}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const queries = buildPrioritizedQueries(titles);
  const results = await catalog.searchCatalogMulti(queries, config.CLOUD_MODE ? 5 : 8);

  let ranked = rankCandidates(results, titles, jikanTitle, { ...options, audioPref });
  if (config.CLOUD_MODE) {
    ranked = ranked.map((c) => {
      let bonus = 0;
      const ref = `${c.url || ''} ${c.name || ''}`.toLowerCase();
      const isDub = /dublado|dub\b|_dub_/.test(ref);
      if (c.source === 'animefire') {
        bonus += audioPref === 'legendado' && !isDub ? 0.28 : audioPref === 'dublado' && isDub ? 0.24 : -0.2;
      } else if (c.source === 'animeunity') {
        bonus += audioPref === 'legendado' ? 0.1 : 0.06;
      } else if (c.source === 'animesaturn') {
        bonus += 0.02;
      }
      return { ...c, matchScore: (c.matchScore || 0) + bonus };
    });
  }

  ranked = ranked.sort(
    (a, b) =>
      (b.matchScore || 0) - (a.matchScore || 0) ||
      (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9)
  );

  const readMalId = consumet.readCandidateMalId;
  const seen = new Set();
  const pool = [];

  for (const candidate of ranked) {
    if (!candidate?.url || seen.has(candidate.url)) continue;
    if (
      candidate.source === 'animesaturn' &&
      audioPref === 'legendado' &&
      !config.LEGENDADO_SATURN_FALLBACK
    ) {
      continue;
    }
    seen.add(candidate.url);
    pool.push(candidate);
    if (pool.length >= (config.CLOUD_MODE ? 8 : 12)) break;
  }

  const externalPt = await probeExternalPtBr(titles, 1);
  const validated = await Promise.all(
    pool.map(async (candidate) => {
      const eps = await validateCandidate(
        candidate,
        { ...options, jikanTitle, altTitles: alternatives },
        readMalId
      );
      return eps?.length ? { candidate, eps } : null;
    })
  );

  const versions = [];
  for (const item of validated) {
    if (!item) continue;
    const { candidate, eps } = item;
    const subtitle = mergeSubtitleProbe(probeSubtitleHeuristic(candidate), externalPt);

    versions.push({
      id: encodeSourceId(candidate.url),
      url: candidate.url,
      name: candidate.name,
      source: candidate.source,
      providerLabel: PROVIDER_LABELS[candidate.source] || candidate.source,
      audioLabel: detectAudioLabel(candidate),
      subtitleLabel: subtitle.label,
      subtitlePtBr: subtitle.ptBr,
      subtitleType: subtitle.type,
      subtitleSources: subtitle.sources,
      episodes: eps.length,
      matchScore: candidate.matchScore || 0,
      image: candidate.image || null,
      recommended: false,
    });
  }

  const sorted = sortVersions(versions, audioPref);
  if (sorted.length) sorted[0].recommended = true;

  cache.set(cacheKey, sorted, 25 * 60 * 1000);
  return sorted;
}

function findVersionById(versions, sourceId) {
  if (!sourceId) return versions.find((v) => v.recommended) || versions[0] || null;
  return versions.find((v) => v.id === sourceId) || null;
}

module.exports = {
  encodeSourceId,
  decodeSourceId,
  discoverVersions,
  findVersionById,
  PROVIDER_LABELS,
};