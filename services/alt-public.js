const PUBLIC_PROVIDER = 'alt';

const GENERIC_ERRORS = {
  INDEX_UNAVAILABLE: 'Índices alternativos indisponíveis no momento.',
  NOT_FOUND: 'Nenhum torrent encontrado para este episódio.',
  MAGNET_RESOLVE_FAILED: 'Não foi possível resolver a fonte alternativa.',
  MAGNET_NOT_FOUND: 'Magnet não encontrado na fonte alternativa.',
  MAGNET_INVALID: 'Link magnet inválido.',
  REF_EXPIRED: 'Fonte inválida ou expirada.',
  INVALID_HREF: 'Torrent sem link associado.',
  STREAM_START_FAILED: 'Falha ao iniciar streaming da fonte alternativa.',
  TORRENT_TIMEOUT: 'Torrent demorou para responder.',
  TORRENT_ERROR: 'Erro ao carregar o torrent.',
  NO_VIDEO_FILE: 'Este torrent não contém vídeo compatível.',
  UNSUPPORTED_FORMAT: 'Formato de vídeo não suportado.',
};

function sanitizeText(text) {
  return String(text || '')
    .replace(/magnet:\?[^\s"'<>]+/gi, '[magnet ofuscado]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[link ofuscado]')
    .replace(/\b(nyaa\.(?:one|si)|1337x\.\w+|1377x\.\w+|x1337x\.\w+)\b/gi, '[índice]')
    .replace(/\b(Nyaa|1337x|1377x)\b/gi, 'fonte alternativa')
    .trim();
}

function publicErrorMessage(code, fallback) {
  if (code && GENERIC_ERRORS[code]) return GENERIC_ERRORS[code];
  const cleaned = sanitizeText(fallback);
  if (!cleaned || /\[link ofuscado\]|\[índice\]|HTTP \d+/i.test(cleaned)) {
    return GENERIC_ERRORS[code] || 'Falha na fonte alternativa.';
  }
  return cleaned;
}

function publicTriedSources(list) {
  if (!Array.isArray(list) || !list.length) return undefined;
  return list.map((t) => ({
    ref: t.ref,
    label: t.label,
    quality: t.quality,
    seeders: t.seeders ?? null,
    leechers: t.leechers ?? null,
    ok: !!t.ok,
    code: t.code || undefined,
  }));
}

function publicCatalogItem(item) {
  if (!item || typeof item !== 'object') return item;
  const { source, provider, _row, ...rest } = item;
  return { ...rest, provider: PUBLIC_PROVIDER };
}

function publicCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return { items: [], provider: PUBLIC_PROVIDER };
  }
  return {
    provider: PUBLIC_PROVIDER,
    episode: catalog.episode,
    items: (catalog.items || []).map(publicCatalogItem),
    notice: 'Fontes alternativas ofuscadas. Use a ref para abrir o episódio.',
  };
}

function publicReserve(result) {
  return {
    ok: true,
    status: result.status,
    ticket: result.ticket,
    label: result.label,
    provider: PUBLIC_PROVIDER,
    expiresIn: result.expiresIn,
  };
}

function publicOpenSuccess(result, streamSession) {
  return {
    ok: true,
    type: 'torrent',
    streamUrl: streamSession.streamUrl,
    statusUrl: streamSession.statusUrl,
    sessionId: streamSession.sessionId,
    label: result.label,
    quality: result.quality,
    provider: PUBLIC_PROVIDER,
    seeders: result.seeders ?? null,
    leechers: result.leechers ?? null,
  };
}

function publicOpenError(result) {
  return {
    error: publicErrorMessage(result.code, result.error),
    code: result.code,
    tried: result.tried,
    triedSources: publicTriedSources(result.triedSources),
    seeders: result.seeders ?? null,
    leechers: result.leechers ?? null,
    episode: result.episode,
  };
}

module.exports = {
  PUBLIC_PROVIDER,
  sanitizeText,
  publicErrorMessage,
  publicCatalog,
  publicReserve,
  publicOpenSuccess,
  publicOpenError,
  publicTriedSources,
};