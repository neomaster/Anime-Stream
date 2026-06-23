const memory = new Map();
let mode = 'localStorage';
let warned = false;

const PRUNE_LIMITS = {
  anime_stream_watch: 15,
  anime_stream_favs: 20,
};

function isExtensionNoise(reason) {
  const msg = String(reason?.message || reason || '');
  const stack = String(reason?.stack || '');
  const hay = `${msg} ${stack}`;
  return (
    /ChromeMethodBFE|\.ldb\b|FILE_ERROR_NO_SPACE|Unable to create writable file/i.test(hay) ||
    /content\.js|polyfill\.js/i.test(hay)
  );
}

function installNoiseShield() {
  if (typeof window === 'undefined' || window.__animeStreamNoiseShield) return;
  window.__animeStreamNoiseShield = true;

  window.addEventListener('unhandledrejection', (ev) => {
    if (isExtensionNoise(ev.reason)) ev.preventDefault();
  });

  window.addEventListener('error', (ev) => {
    if (isExtensionNoise(ev.error || ev.message)) ev.preventDefault();
  });
}

function probeLocalStorage() {
  try {
    const k = '__anime_stream_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function switchToMemory(reason) {
  if (mode === 'memory') return;
  mode = 'memory';
  if (typeof window !== 'undefined' && !warned) {
    warned = true;
    window.__animeStreamStorageMode = mode;
    window.dispatchEvent(new CustomEvent('anime-stream:storage', { detail: { mode, reason } }));
  }
}

function pruneValue(key, value) {
  const limit = PRUNE_LIMITS[key];
  if (!limit) return value;

  if (key === 'anime_stream_watch' && value && typeof value === 'object') {
    const sorted = Object.entries(value).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
    return Object.fromEntries(sorted.slice(0, limit));
  }

  if (key === 'anime_stream_favs' && Array.isArray(value)) {
    return value.slice(0, limit);
  }

  return value;
}

async function initStorage() {
  installNoiseShield();
  if (!probeLocalStorage()) {
    switchToMemory('localStorage bloqueado');
    return mode;
  }

  if (navigator.storage?.estimate) {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota && usage && usage / quota > 0.92) {
        switchToMemory('quota do navegador quase cheia');
      }
    } catch {
      /* ignore */
    }
  }

  return mode;
}

export function getStorageMode() {
  return mode;
}

export function safeGet(key, fallback = null) {
  if (mode === 'memory') {
    return memory.has(key) ? memory.get(key) : fallback;
  }
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    switchToMemory('leitura falhou');
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export function safeSet(key, value) {
  if (mode === 'memory') {
    memory.set(key, value);
    return true;
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    switchToMemory('disco cheio');
    memory.set(key, value);
    return false;
  }
}

export function safeGetJson(key, fallback = null) {
  const raw = safeGet(key, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function safeSetJson(key, value) {
  const pruned = pruneValue(key, value);
  try {
    return safeSet(key, JSON.stringify(pruned));
  } catch {
    return false;
  }
}

installNoiseShield();
initStorage();