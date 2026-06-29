const STATUS_PT = {
  'Finished Airing': 'Finalizado',
  'Currently Airing': 'Em exibição',
  'Not yet aired': 'Ainda não exibido',
  'Cancelled': 'Cancelado',
  'On Hiatus': 'Em hiato',
};

const GENRE_PT = {
  Action: 'Ação',
  Adventure: 'Aventura',
  Comedy: 'Comédia',
  Drama: 'Drama',
  Fantasy: 'Fantasia',
  Horror: 'Terror',
  Mystery: 'Mistério',
  Romance: 'Romance',
  'Sci-Fi': 'Ficção científica',
  'Slice of Life': 'Cotidiano',
  Sports: 'Esportes',
  Supernatural: 'Sobrenatural',
  Suspense: 'Suspense',
  Ecchi: 'Ecchi',
  Erotica: 'Erótico',
  Hentai: 'Hentai',
  'Award Winning': 'Premiado',
  Gourmet: 'Gastronomia',
  'Boys Love': 'Boys Love',
  'Girls Love': 'Girls Love',
  School: 'Escolar',
  Shounen: 'Shounen',
  Shoujo: 'Shoujo',
  Seinen: 'Seinen',
  Josei: 'Josei',
};

function translateStatus(status) {
  return STATUS_PT[status] || status || '';
}

function translateGenre(genre) {
  return GENRE_PT[genre] || genre;
}

function translateGenres(genres) {
  return (genres || []).map(translateGenre);
}

function pickDisplayTitle(anime, sourceMatch) {
  if (sourceMatch?.name && !/sub ita|ita\)/i.test(sourceMatch.name)) {
    return sourceMatch.name;
  }
  const pt =
    (anime.synonyms || []).find((t) => /[áàâãéêíóôõúç]/i.test(t)) ||
    anime.title_japanese ||
    anime.title;
  return pt || anime.title;
}

function cleanSynopsis(text) {
  return String(text || '')
    .replace(/\s*\[Written by MAL Rewrite\]\s*/gi, '')
    .replace(/\s*Fonte:.*$/gim, '')
    .trim();
}

function isSeoBlurb(text) {
  return /assistir.*epis[oó]dios|baixe os epis[oó]dios|n[aã]o hospeda nenhum v[ií]deo/i.test(
    String(text || '')
  );
}

function buildPtSummary(anime, sourceMatch) {
  const title = pickDisplayTitle(anime, sourceMatch);
  const genres = translateGenres(anime.genres).slice(0, 2);
  const status = translateStatus(anime.status);
  const parts = [`${title}`];

  if (genres.length) parts.push(`é um anime de ${genres.join(' e ')}`);
  if (status) parts.push(`com status ${status.toLowerCase()}`);
  if (anime.episodes) parts.push(`${anime.episodes} episódios`);
  if (anime.score) parts.push(`nota ${anime.score} no MAL`);

  return `${parts.join(', ').replace(', é', ' é')}.`;
}

function localizeAnime(anime, sourceMatch, sourceSynopsis) {
  const cleanedSource = cleanSynopsis(sourceSynopsis);
  const hasPtSource =
    cleanedSource &&
    !isSeoBlurb(cleanedSource) &&
    (cleanedSource.length > 80 || /[áàâãéêíóôõúç]/i.test(cleanedSource));

  const jikanSynopsis = cleanSynopsis(anime.synopsis);
  const hasPtJikan = jikanSynopsis && /[áàâãéêíóôõúç]/i.test(jikanSynopsis);

  let synopsis;
  let synopsisLang;

  if (hasPtSource) {
    synopsis = cleanedSource;
    synopsisLang = 'pt';
  } else if (hasPtJikan) {
    synopsis = jikanSynopsis;
    synopsisLang = 'pt';
  } else {
    synopsis = buildPtSummary(anime, sourceMatch);
    synopsisLang = 'pt';
  }

  return {
    ...anime,
    displayTitle: pickDisplayTitle(anime, sourceMatch),
    synopsis: synopsis || 'Sinopse não disponível.',
    synopsisLang,
    synopsisFull: hasPtSource || hasPtJikan ? undefined : jikanSynopsis || undefined,
    statusLabel: translateStatus(anime.status),
    genres: translateGenres(anime.genres),
  };
}

module.exports = {
  translateStatus,
  translateGenre,
  translateGenres,
  pickDisplayTitle,
  cleanSynopsis,
  localizeAnime,
};