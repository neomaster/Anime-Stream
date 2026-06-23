const LANG_HINTS = [
  { rank: 0, re: /pt-?br|portugu[eê]s\s*\(br\)|brazil|\[pt-br\]/i, lang: 'pt-BR', label: 'Português (BR)' },
  { rank: 1, re: /portugu[eê]s|^pt$|\bport\b|\[pt\]/i, lang: 'pt', label: 'Português' },
  { rank: 2, re: /english|^en$|\[en\]/i, lang: 'en', label: 'English' },
  { rank: 3, re: /spanish|espa[nñ]ol|^es$/i, lang: 'es', label: 'Español' },
  { rank: 4, re: /italian|italiano|^ita$|sub_ita/i, lang: 'it', label: 'Italiano' },
];

function inferSubtitleMeta(sub) {
  const label = sub.label || '';
  const url = sub.url || '';
  const hay = `${label} ${url}`;

  for (const hint of LANG_HINTS) {
    if (hint.re.test(hay)) {
      return { lang: hint.lang, label: label || hint.label, rank: hint.rank };
    }
  }

  if (/pt/i.test(url)) return { lang: 'pt', label: label || 'Português', rank: 1 };
  if (/en/i.test(url)) return { lang: 'en', label: label || 'English', rank: 2 };

  return { lang: sub.lang || 'und', label: label || 'Legenda', rank: 50 };
}

function sortSubtitles(subs) {
  return [...(subs || [])]
    .map((sub) => {
      const meta = inferSubtitleMeta(sub);
      return { ...sub, lang: meta.lang, label: meta.label, _rank: meta.rank };
    })
    .sort((a, b) => a._rank - b._rank || String(a.label).localeCompare(String(b.label)));
}

function normalizeSubtitles(subs) {
  return sortSubtitles(subs).map(({ _rank, ...sub }) => sub);
}

const SUBTITLE_LANG_LABELS = {
  'pt-BR': 'Português (BR)',
  pt: 'Português',
  ita: 'Italiano',
  it: 'Italiano',
  en: 'Inglês',
};

function subtitleLangLabel(code) {
  if (!code) return null;
  return SUBTITLE_LANG_LABELS[code] || SUBTITLE_LANG_LABELS[code.toLowerCase()] || code;
}

module.exports = {
  inferSubtitleMeta,
  sortSubtitles,
  normalizeSubtitles,
  subtitleLangLabel,
};