const { scoreAgainstTitles, titleSimilarity } = require('./matcher');

const MIN_TITLE_SCORE = 0.85;
const MIN_TITLE_SCORE_NO_MAL = 0.9;

function normalizeMalId(id) {
  if (id === null || id === undefined || id === '') return null;
  return String(id);
}

function validateTitleMatch(sourceName, titles, jikanTitle) {
  const list = [jikanTitle, ...titles].filter(Boolean);
  const { score, matchedTitle } = scoreAgainstTitles(sourceName, list);
  return { ok: score >= MIN_TITLE_SCORE, score, matchedTitle };
}

function validateEpisodeCount(sourceEpisodes, expectedEpisodes, status) {
  if (!expectedEpisodes || !sourceEpisodes?.length) return { ok: true };
  const expected = parseInt(expectedEpisodes, 10);
  if (!Number.isFinite(expected) || expected <= 0) return { ok: true };

  const count = sourceEpisodes.length;
  const airing = /air/i.test(status || '');
  if (airing && count <= expected) return { ok: true };
  if (count === expected) return { ok: true };

  const ratio = count / expected;
  if (ratio >= 0.75 && ratio <= 1.35) return { ok: true };

  return {
    ok: false,
    reason: `Contagem de episodios incompativel (${count} vs ${expected} esperados)`,
  };
}

function validateEpisodeRef(episodeRef, episodeNumber) {
  if (!episodeNumber || !episodeRef) return { ok: true };
  const num = parseInt(episodeNumber, 10);
  if (!Number.isFinite(num) || num < 1) return { ok: true };

  const ref = String(episodeRef).toLowerCase();
  const patterns = [
    `-ep-${num}`,
    `_ep_${num}`,
    `_ep-${num}`,
    `/ep-${num}`,
    `ep-${num}~`,
    `/${num}`,
    `_e${String(num).padStart(2, '0')}`,
  ];

  const matched = patterns.some((p) => ref.includes(p));
  return {
    ok: matched,
    reason: matched ? null : `Referencia do episodio ${num} invalida`,
  };
}

function validateStreamUrlEpisode(videoUrl, episodeNumber) {
  if (!videoUrl || !episodeNumber) return { ok: true };
  const num = parseInt(episodeNumber, 10);
  if (!Number.isFinite(num) || num < 1) return { ok: true };

  const url = String(videoUrl);
  const patterns = [
    new RegExp(`Ep[_\\s-]*0?${num}(?:[^0-9]|$)`, 'i'),
    new RegExp(`episode[_\\s-]*0?${num}(?:[^0-9]|$)`, 'i'),
    new RegExp(`e${String(num).padStart(2, '0')}(?:[^0-9]|$)`, 'i'),
  ];

  const matched = patterns.some((re) => re.test(url));
  return {
    ok: matched,
    reason: matched ? null : `URL do video nao corresponde ao episodio ${num}`,
  };
}

async function validateSourceCandidate(candidate, context, readMalId) {
  const {
    malId: expectedMalId,
    jikanTitle,
    altTitles = [],
    expectedEpisodes,
    status,
    episodes = [],
    matchScore = 0,
    fastPath = false,
  } = context;

  const titles = altTitles.filter(Boolean);
  const expected = normalizeMalId(expectedMalId);
  const trustTitle = fastPath || matchScore >= 0.88;

  if (expected && readMalId && !trustTitle) {
    const sourceMalId = normalizeMalId(await readMalId(candidate.url));
    if (sourceMalId) {
      if (sourceMalId !== expected) {
        return { ok: false, reason: `MAL ID divergente (${sourceMalId} != ${expected})` };
      }
    } else {
      const titleCheck = validateTitleMatch(candidate.name, titles, jikanTitle);
      if (!titleCheck.ok || titleCheck.score < MIN_TITLE_SCORE_NO_MAL) {
        return {
          ok: false,
          reason: `Titulo insuficiente sem MAL ID (${titleCheck.score?.toFixed(2)})`,
        };
      }
    }
  } else if (expected && trustTitle) {
    const titleCheck = validateTitleMatch(candidate.name, titles, jikanTitle);
    if (!titleCheck.ok && titleCheck.score < 0.75) {
      return { ok: false, reason: `Titulo insuficiente (${titleCheck.score?.toFixed(2)})` };
    }
  } else {
    const titleCheck = validateTitleMatch(candidate.name, titles, jikanTitle);
    if (titleCheck.score < 0.55) {
      return { ok: false, reason: 'Titulo muito diferente' };
    }
  }

  const epCheck = validateEpisodeCount(episodes, expectedEpisodes, status);
  if (!epCheck.ok) return epCheck;

  if (jikanTitle && candidate.name) {
    const sim = titleSimilarity(jikanTitle, candidate.name);
    if (sim < 0.45 && expected) {
      return { ok: false, reason: `Similaridade baixa (${sim.toFixed(2)})` };
    }
  }

  return { ok: true };
}

module.exports = {
  MIN_TITLE_SCORE,
  validateTitleMatch,
  validateEpisodeCount,
  validateEpisodeRef,
  validateStreamUrlEpisode,
  validateSourceCandidate,
};