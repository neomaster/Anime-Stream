const torrentStream = require('torrent-stream');
const { randomHex } = require('./secure-random');

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 120000;

const sessions = new Map();

function mimeForName(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.mp4') || n.endsWith('.m4v')) return 'video/mp4';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.mkv')) return 'video/x-matroska';
  if (n.endsWith('.avi')) return 'video/x-msvideo';
  if (n.endsWith('.mov')) return 'video/quicktime';
  return 'application/octet-stream';
}

function pickVideoFile(files) {
  const list = files || [];
  const mp4 = list.find((f) => /\.(mp4|webm|m4v)$/i.test(f.name));
  if (mp4) return mp4;
  return list.find((f) => /\.(mkv|avi|mov)$/i.test(f.name)) || null;
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) destroySession(id);
  }
}

function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    if (session.engine) session.engine.destroy();
  } catch { /* ignore */ }
  if (session.timer) clearTimeout(session.timer);
  sessions.delete(sessionId);
}

function getSession(sessionId) {
  purgeExpired();
  return sessions.get(sessionId) || null;
}

function sessionStatus(session) {
  if (!session) {
    return { ready: false, status: 'missing', progress: 0, peers: 0 };
  }

  if (session.error) {
    return {
      ready: false,
      status: 'error',
      progress: session.progress || 0,
      peers: session.peers || 0,
      error: session.error,
    };
  }

  if (session.file) {
    return {
      ready: true,
      status: 'ready',
      progress: session.progress || 1,
      peers: session.peers || 0,
      fileName: session.file.name,
      length: session.file.length,
      mime: mimeForName(session.file.name),
    };
  }

  return {
    ready: false,
    status: session.status || 'connecting',
    progress: session.progress || 0,
    peers: session.peers || 0,
  };
}

function startSession(magnet) {
  if (!magnet || !String(magnet).startsWith('magnet:')) {
    const err = new Error('Magnet inválido');
    err.code = 'MAGNET_INVALID';
    throw err;
  }

  const sessionId = randomHex(16);
  const session = {
    magnet,
    status: 'connecting',
    engine: null,
    file: null,
    error: null,
    progress: 0,
    peers: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    timer: null,
  };
  sessions.set(sessionId, session);

  session.timer = setTimeout(() => {
    if (session.file || session.error) return;
    session.error = 'Tempo esgotado ao conectar no torrent';
    session.status = 'error';
    try {
      if (session.engine) session.engine.destroy();
    } catch { /* ignore */ }
  }, CONNECT_TIMEOUT_MS);

  try {
    const engine = torrentStream(magnet, { connections: 100 });
    session.engine = engine;

    engine.on('error', (err) => {
      session.error = err.message || 'Erro no torrent';
      session.status = 'error';
    });

    engine.on('download', () => {
      if (!engine.torrent) return;
      session.progress = engine.torrent.progress || 0;
      session.peers = engine.swarm ? engine.swarm.wires.length : 0;
    });

    engine.on('ready', () => {
      session.status = 'metadata';
      session.peers = engine.swarm ? engine.swarm.wires.length : 0;

      const file = pickVideoFile(engine.files);
      if (!file) {
        session.error = 'Nenhum arquivo de vídeo neste torrent';
        session.status = 'error';
        try {
          engine.destroy();
        } catch { /* ignore */ }
        return;
      }

      session.file = file;
      session.status = 'ready';
      session.progress = 1;
      if (session.timer) clearTimeout(session.timer);
    });
  } catch (err) {
    session.error = err.message || 'Falha ao iniciar torrent';
    session.status = 'error';
    if (session.timer) clearTimeout(session.timer);
    throw err;
  }

  return {
    sessionId,
    streamUrl: `/api/alt/stream/${sessionId}`,
    statusUrl: `/api/alt/stream/${sessionId}/status`,
  };
}

function pipeFileToResponse(session, req, res) {
  const file = session.file;
  if (!file) {
    res.status(425).json({
      error: 'Torrent ainda não está pronto para streaming',
      code: 'NOT_READY',
      status: sessionStatus(session),
    });
    return;
  }

  const total = file.length;
  const range = req.headers.range;
  const mime = mimeForName(file.name);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

    if (Number.isNaN(start) || start >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }

    const safeEnd = Math.min(end, total - 1);
    const chunk = safeEnd - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${safeEnd}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk,
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });

    const stream = file.createReadStream({ start, end: safeEnd });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': total,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });

  const stream = file.createReadStream();
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
}

async function waitUntilReady(sessionId, maxWaitMs = CONNECT_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const session = getSession(sessionId);
    if (!session) {
      const err = new Error('Sessão expirada');
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }
    if (session.error) {
      const err = new Error(session.error);
      err.code = 'TORRENT_ERROR';
      throw err;
    }
    if (session.file) return session;
    await new Promise((r) => setTimeout(r, 500));
  }
  const err = new Error('Tempo esgotado aguardando o torrent');
  err.code = 'TORRENT_TIMEOUT';
  throw err;
}

module.exports = {
  startSession,
  getSession,
  destroySession,
  sessionStatus,
  pipeFileToResponse,
  waitUntilReady,
  mimeForName,
};