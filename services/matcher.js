const STOP_WORDS = new Set([
  'the', 'a', 'an', 'no', 'na', 'ni', 'wo', 'wa', 'ga', 'to', 'de', 'and', 'of',
]);

const TYPE_PATTERNS = [
  { type: 'movie', re: /\b(movie|film|filme|gekijouban|gekijou)\b/i },
  { type: 'ova', re: /\b(ova|oav)\b/i },
  { type: 'ona', re: /\bona\b/i },
  { type: 'special', re: /\b(special|especial)\b/i },
  { type: 'tv', re: /\b(tv|tv\s*short)\b/i },
];

const SEASON_PATTERNS = [
  /(\d+)(?:st|nd|rd|th)\s+season(?:\s+part\s+(\d+))?/i,
  /season\s+(\d+)(?:\s+part\s+(\d+))?/i,
  /(\d+)(?:ª|º)?\s*temporada(?:\s+parte\s+(\d+))?/i,
  /temporada\s+(\d+)/i,
];

function cleanAnimeName(name) {
  return (name || '')
    .replace(/\s+\d+\.\d+.*$/i, '')
    .replace(/\s+N\/A.*$/i, '')
    .replace(/\s+A\d+.*$/i, '')
    .replace(/\s*\[(?:PT-BR|English|Movie|TV)\]\s*/gi, '')
    .replace(/\s*\((?:dublado|legendado|Dublado|Legendado)\)\s*/gi, '')
    .trim();
}

function normalizeText(text) {
  return cleanAnimeName(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function extractMeta(title) {
  const raw = cleanAnimeName(title);
  let working = raw;
  let season = null;
  let part = null;
  let mediaType = 'tv';

  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(working)) {
      mediaType = type;
      working = working.replace(re, ' ');
    }
  }

  for (const re of SEASON_PATTERNS) {
    const m = working.match(re);
    if (m) {
      season = parseInt(m[1], 10);
      part = m[2] ? parseInt(m[2], 10) : null;
      working = working.replace(re, ' ');
      break;
    }
  }

  const partOnly = working.match(/\bpart\s+(\d+)\b/i);
  if (partOnly && season === null) {
    part = parseInt(partOnly[1], 10);
    working = working.replace(partOnly[0], ' ');
  }

  if (season === null) {
    const trailing = working.match(/(?:^|\s)(\d{1,2})\s*$/);
    if (trailing) {
      const n = parseInt(trailing[1], 10);
      if (n >= 2 && n <= 30) {
        season = n;
        working = working.replace(/(?:^|\s)\d{1,2}\s*$/, ' ').trim();
      }
    }
  }

  const core = normalizeText(working);
  const tokens = tokenize(working);

  return { raw, core, tokens, season, part, mediaType };
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;

  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  const union = new Set([...setA, ...setB]).size;
  return inter / union;
}

function prefixPollution(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const qSet = new Set(queryTokens);
  let extraBefore = 0;
  let foundFirst = false;

  for (const t of candidateTokens) {
    if (qSet.has(t)) {
      foundFirst = true;
      break;
    }
    extraBefore++;
  }

  if (!foundFirst) return 0;
  return Math.min(0.45, extraBefore * 0.18);
}

function seasonScore(qMeta, cMeta) {
  const qHas = qMeta.season !== null;
  const cHas = cMeta.season !== null;

  if (qHas && cHas) {
    if (qMeta.season !== cMeta.season) return -1;
    if (qMeta.part !== null && cMeta.part !== null && qMeta.part !== cMeta.part) return -0.8;
    if (qMeta.part !== null && cMeta.part === null) return -0.25;
    return 0.2;
  }

  if (qHas && !cHas) return -0.55;
  if (!qHas && cHas) return -0.35;
  return 0;
}

function mediaTypeScore(qMeta, cMeta) {
  if (qMeta.mediaType === cMeta.mediaType) return 0.05;
  const serialTypes = new Set(['tv', 'ona', 'ova']);
  if (serialTypes.has(qMeta.mediaType) && serialTypes.has(cMeta.mediaType)) return 0;
  if (qMeta.mediaType === 'tv' && cMeta.mediaType === 'movie') return -0.3;
  if (qMeta.mediaType === 'movie' && cMeta.mediaType === 'tv') return -0.3;
  return -0.1;
}

function extractLocaleFlags(name, dub = null, ref = '') {
  const raw = name || '';
  const lower = raw.toLowerCase();
  const refLower = (ref || '').toLowerCase();

  const isIta =
    /\(\s*ita\s*\)/i.test(raw) ||
    refLower.includes('-ita') ||
    refLower.endsWith('ita') ||
    /\s\(ita\)/i.test(raw);

  const isPtBr = /pt-?br|\(pt\)|portugu[eê]s/i.test(raw);
  const isDubbed = dub === 1 || /\bdublad/i.test(raw);
  const isSubbed = dub === 0 || /legendad/i.test(raw);

  return { isIta, isPtBr, isDubbed, isSubbed, dub };
}

function localePreferenceScore(name, dub, preference = 'legendado', ref = '') {
  const flags = extractLocaleFlags(name, dub, ref);
  let score = 0;

  if (preference === 'dublado') {
    if (flags.isIta || flags.dub === 1) score += 0.32;
    else if (flags.dub === 0) score -= 0.18;
    return score;
  }

  // legendado / pt-br (padrão): prioriza original legendado, evita dublado ITA
  if (flags.isPtBr) score += 0.2;
  if (!flags.isIta && flags.dub !== 1) score += 0.3;
  if (flags.isIta || flags.dub === 1) score -= 0.38;
  if (flags.isSubbed && !flags.isIta) score += 0.08;

  return score;
}

function titleSimilarity(query, candidate) {
  const qMeta = extractMeta(query);
  const cMeta = extractMeta(candidate);

  if (!qMeta.core || !cMeta.core) return 0;

  if (qMeta.core === cMeta.core) {
    let score = 1;
    const s = seasonScore(qMeta, cMeta);
    if (s < 0) return Math.max(0, 0.15 + s);
    score += s;
    score += mediaTypeScore(qMeta, cMeta);
    return Math.min(1, score);
  }

  const seasonS = seasonScore(qMeta, cMeta);
  if (seasonS <= -0.8) return 0;

  let score = jaccard(qMeta.tokens, cMeta.tokens);

  if (cMeta.core.startsWith(qMeta.core)) score = Math.max(score, 0.88);
  else if (qMeta.core.startsWith(cMeta.core)) score = Math.max(score, 0.82);
  else if (cMeta.core.includes(qMeta.core) || qMeta.core.includes(cMeta.core)) {
    score = Math.max(score, 0.7);
  }

  const qFirst = qMeta.tokens[0];
  if (qFirst && !cMeta.tokens.includes(qFirst)) score -= 0.2;

  score -= prefixPollution(qMeta.tokens, cMeta.tokens);

  const lenDiff = Math.abs(cMeta.tokens.length - qMeta.tokens.length);
  score -= Math.min(0.3, lenDiff * 0.06);

  score += seasonS;
  score += mediaTypeScore(qMeta, cMeta);

  return Math.max(0, Math.min(1, score));
}

function buildSearchQueries(titles) {
  const queries = new Map();

  const add = (q, weight = 1) => {
    const key = q.toLowerCase().trim();
    if (key.length < 2) return;
    const prev = queries.get(key);
    queries.set(key, Math.max(prev || 0, weight));
  };

  for (const raw of titles) {
    if (!raw) continue;
    const t = cleanAnimeName(raw);
    add(t, 1);

    const meta = extractMeta(t);
    add(meta.core, 0.95);

    const colonBase = t.split(':')[0].trim();
    if (colonBase && colonBase !== t) add(colonBase, 0.9);

    if (meta.tokens.length >= 2) {
      add(meta.tokens.slice(0, 3).join(' '), 0.94);
      add(meta.tokens.slice(0, 2).join(' '), 0.91);
    }

    if (meta.season !== null) {
      add(`${meta.core} ${meta.season}`, 0.93);
      add(`${meta.core} season ${meta.season}`, 0.9);
      add(`${meta.core} ${meta.season} season`, 0.92);
      add(`${colonBase} ${meta.season}`, 0.91);
      if (meta.part) add(`${meta.core} season ${meta.season} part ${meta.part}`, 0.95);
    }

    const noSeason = t
      .replace(/\s*\d+(st|nd|rd|th)\s+season.*/i, '')
      .replace(/\s*season\s*\d+.*/i, '')
      .replace(/\s*\d+(?:ª|º)?\s*temporada.*/i, '')
      .trim();
    if (noSeason && noSeason !== t) add(noSeason, 0.75);

    const slug = normalizeText(t).replace(/\s+/g, ' ');
    if (slug.length > 2) add(slug, 0.7);
  }

  return [...queries.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([q]) => q);
}

function scoreAgainstTitles(candidateName, titles, weights = null) {
  let best = 0;
  let bestTitle = null;

  titles.forEach((title, i) => {
    const w = weights ? weights[i] : (i === 0 ? 1 : i < 3 ? 0.92 : 0.82);
    const sim = titleSimilarity(title, candidateName) * w;
    if (sim > best) {
      best = sim;
      bestTitle = title;
    }
  });

  return { score: best, matchedTitle: bestTitle };
}

function rankCandidates(candidates, titles, queryHint = null, options = {}) {
  const weights = titles.map((_, i) => (i === 0 ? 1 : i < 3 ? 0.92 : 0.82));
  const audioPref = options.audioPref === 'dublado' ? 'dublado' : 'legendado';

  const queryMeta = titles[0] ? extractMeta(titles[0]) : null;

  return candidates
    .map((c) => {
      const { score, matchedTitle } = scoreAgainstTitles(c.name, titles, weights);
      let finalScore = score;

      if (queryHint) {
        const hintScore = titleSimilarity(queryHint, c.name);
        finalScore = finalScore * 0.75 + hintScore * 0.25;
      }

      const cMeta = extractMeta(c.name);

      if (queryMeta?.tokens?.length) {
        const qSet = new Set(queryMeta.tokens);
        let overlap = 0;
        for (const token of cMeta.tokens) {
          if (qSet.has(token)) overlap++;
        }
        if (overlap >= 2) {
          finalScore = Math.max(finalScore, 0.55 + Math.min(0.35, overlap * 0.08));
        }
      }

      if (queryMeta?.season !== null) {
        const season = String(queryMeta.season);
        const name = c.name.toLowerCase();
        const seasonHints = [
          `season ${season}`,
          ` ${season} `,
          ` ${season}`,
          `${season}nd season`,
          `${season}rd season`,
          `${season}th season`,
          `${season} temporada`,
        ];
        if (cMeta.season === queryMeta.season) finalScore += 0.22;
        else if (seasonHints.some((h) => name.includes(h)) || name.endsWith(` ${season}`)) {
          finalScore += 0.18;
        } else if (cMeta.season !== null && cMeta.season !== queryMeta.season) {
          finalScore -= 0.45;
        }
      } else if (cMeta.season !== null) {
        finalScore -= 0.42;
      }

      finalScore += localePreferenceScore(c.name, c.dub, audioPref, c.url || c.id || '');

      return { ...c, matchScore: finalScore, matchedTitle, audioPref };
    })
    .filter((c) => c.matchScore >= 0.42)
    .sort((a, b) => b.matchScore - a.matchScore);
}

function findBestMatch(candidates, titles, queryHint = null, options = {}) {
  const ranked = rankCandidates(candidates, titles, queryHint, options);
  if (!ranked.length) return null;

  const best = ranked[0];
  const second = ranked[1];

  if (second && best.matchScore - second.matchScore < 0.04) {
    const bestLen = extractMeta(best.name).tokens.length;
    const secondLen = extractMeta(second.name).tokens.length;
    const queryLen = extractMeta(titles[0]).tokens.length;

    if (Math.abs(bestLen - queryLen) > Math.abs(secondLen - queryLen)) {
      return { ...second, matchScore: second.matchScore, ambiguous: true };
    }
  }

  return { ...best, ambiguous: false };
}

function isDuplicate(titleA, titleB, threshold = 0.88) {
  return titleSimilarity(titleA, titleB) >= threshold;
}

function mergeByRelevance(jikanResults, fireResults, query) {
  const merged = jikanResults.map((a) => {
    const titles = [a.title, a.title_english, a.title_japanese, ...(a.synonyms || [])].filter(Boolean);
    const { score } = scoreAgainstTitles(a.title, [query, ...titles]);
    return { ...a, source: 'jikan', relevance: score };
  });

  for (const item of fireResults) {
    const dup = merged.some((m) =>
      [m.title, m.title_english, m.title_japanese].filter(Boolean).some((t) => isDuplicate(t, item.name))
    );
    if (!dup) {
      const rel = titleSimilarity(query, item.name);
      merged.push({
        mal_id: null,
        title: item.name,
        poster: item.image || null,
        poster_small: item.image || null,
        sourceUrl: item.url,
        source: 'animefire',
        score: null,
        relevance: rel,
      });
    }
  }

  return merged.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
}

module.exports = {
  cleanAnimeName,
  normalizeText,
  extractMeta,
  extractLocaleFlags,
  localePreferenceScore,
  titleSimilarity,
  buildSearchQueries,
  scoreAgainstTitles,
  rankCandidates,
  findBestMatch,
  isDuplicate,
  mergeByRelevance,
};