const PROVIDER_LABEL = 'alt';
const STREAM_WAIT_MS = 120000;
const STREAM_POLL_MS = 800;

export function formatSeederLabel(seeders, leechers, phase = 'found') {
  const s = seeders != null && seeders !== '' ? Number(seeders) : null;
  const l = leechers != null && leechers !== '' ? Number(leechers) : null;
  if (s == null || Number.isNaN(s)) {
    if (phase === 'scan') return 'Varrendo fontes alternativas…';
    return '🧲 Streaming magnet';
  }
  const parts = [`${s} seeder${s === 1 ? '' : 's'}`];
  if (l != null && !Number.isNaN(l)) parts.push(`${l} leecher${l === 1 ? '' : 's'}`);
  const suffix =
    phase === 'scan' ? ' encontrados…' : phase === 'resolve' ? ' · resolvendo…' : ' · conectando…';
  return `🧲 ${parts.join(', ')}${suffix}`;
}

export async function fetchEpisodeMagnetCatalog(malId, episode) {
  const res = await fetch(
    `/api/alt/episode?malId=${encodeURIComponent(malId)}&ep=${encodeURIComponent(episode)}`,
    { headers: { Accept: 'application/json' } }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.code = data.code || `HTTP_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function openEpisodeMagnet(malId, episode, ref) {
  const res = await fetch('/api/alt/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(ref ? { ref } : { malId, episode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.code = data.code || `HTTP_${res.status}`;
    err.status = res.status;
    err.tried = data.tried;
    err.triedSources = data.triedSources;
    err.seeders = data.seeders;
    err.leechers = data.leechers;
    err.episode = data.episode;
    throw err;
  }
  if (!data.streamUrl) {
    const err = new Error('Servidor não retornou URL de streaming');
    err.code = 'NO_STREAM_URL';
    throw err;
  }
  return data;
}

export async function waitForTorrentStream(statusUrl, { onProgress } = {}) {
  const start = Date.now();

  while (Date.now() - start < STREAM_WAIT_MS) {
    const res = await fetch(statusUrl, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));

    if (!res.ok && res.status !== 425) {
      const err = new Error(data.error || `Erro ${res.status}`);
      err.code = data.code || `HTTP_${res.status}`;
      throw err;
    }

    if (data.status === 'error') {
      const err = new Error(data.error || 'Falha ao carregar torrent');
      err.code = 'TORRENT_ERROR';
      throw err;
    }

    if (data.ready) return data;

    const pct = Math.round((data.progress || 0) * 100);
    const peers = data.peers || 0;
    onProgress?.(pct, peers, data.status);
    await new Promise((r) => setTimeout(r, STREAM_POLL_MS));
  }

  const err = new Error('Tempo esgotado aguardando o torrent');
  err.code = 'TORRENT_TIMEOUT';
  throw err;
}

export async function playMagnetStream({ streamUrl, statusUrl, videoEl, onProgress, onReady, onError }) {
  if (!videoEl) throw new Error('Player de vídeo indisponível');

  try {
    if (statusUrl) {
      await waitForTorrentStream(statusUrl, { onProgress });
    }

    return new Promise((resolve, reject) => {
      const onLoaded = () => {
        videoEl.removeEventListener('loadeddata', onLoaded);
        videoEl.removeEventListener('error', onVideoErr);
        onReady?.();
        resolve({ mode: 'stream' });
      };

      const onVideoErr = () => {
        videoEl.removeEventListener('loadeddata', onLoaded);
        videoEl.removeEventListener('error', onVideoErr);
        const err = new Error('Erro ao reproduzir stream do magnet');
        err.code = 'VIDEO_ERROR';
        onError?.(err);
        reject(err);
      };

      videoEl.addEventListener('loadeddata', onLoaded, { once: true });
      videoEl.addEventListener('error', onVideoErr, { once: true });
      videoEl.src = streamUrl;
      videoEl.load();
      videoEl.play().catch(() => {});
    });
  } catch (err) {
    onError?.(err);
    throw err;
  }
}

let pickerState = null;

function closeEpisodePicker() {
  const picker = document.getElementById('episodePicker');
  const magnetBtn = document.getElementById('pickerMagnetBtn');
  const statusEl = document.getElementById('pickerMagnetStatus');
  if (picker) picker.hidden = true;
  if (magnetBtn) {
    magnetBtn.disabled = false;
    magnetBtn.classList.remove('is-loading');
    magnetBtn.textContent = '🧲 Streaming magnet';
  }
  if (statusEl) {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }
  pickerState = null;
}

function updateMagnetPickerUI({ buttonLabel, statusLabel, loading = true }) {
  const magnetBtn = document.getElementById('pickerMagnetBtn');
  const statusEl = document.getElementById('pickerMagnetStatus');
  if (magnetBtn) {
    magnetBtn.disabled = loading;
    magnetBtn.classList.toggle('is-loading', loading);
    if (buttonLabel) magnetBtn.textContent = buttonLabel;
  }
  if (statusEl && statusLabel) {
    statusEl.hidden = false;
    statusEl.textContent = statusLabel;
  }
}

export function showEpisodePicker({ episode, malId, onStream, onMagnet, onError }) {
  const picker = document.getElementById('episodePicker');
  const epLabel = document.getElementById('pickerEpNum');
  const streamBtn = document.getElementById('pickerStreamBtn');
  const magnetBtn = document.getElementById('pickerMagnetBtn');
  const cancelBtn = document.getElementById('pickerCancelBtn');
  const backdrop = picker?.querySelector('.episode-picker-backdrop');

  if (!picker || !streamBtn || !magnetBtn) {
    onStream();
    return;
  }

  pickerState = { episode, malId, onStream, onMagnet };
  if (epLabel) epLabel.textContent = String(episode.number);
  magnetBtn.disabled = false;
  magnetBtn.classList.remove('is-loading');
  magnetBtn.textContent = '🧲 Streaming magnet';
  const statusEl = document.getElementById('pickerMagnetStatus');
  if (statusEl) {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }
  picker.hidden = false;

  streamBtn.onclick = () => {
    closeEpisodePicker();
    onStream();
  };

  magnetBtn.onclick = async () => {
    updateMagnetPickerUI({
      buttonLabel: 'Varrendo fontes alternativas…',
      statusLabel: 'Buscando melhor fonte…',
      loading: true,
    });

    try {
      await onMagnet({
        onMagnetProgress: ({ buttonLabel, statusLabel }) => {
          updateMagnetPickerUI({ buttonLabel, statusLabel, loading: true });
        },
        onPickerClose: closeEpisodePicker,
      });
    } catch (err) {
      updateMagnetPickerUI({
        buttonLabel: '🧲 Streaming magnet',
        statusLabel: '',
        loading: false,
      });
      if (statusEl) statusEl.hidden = true;
      if (onError) onError(err);
    }
  };

  cancelBtn.onclick = closeEpisodePicker;
  if (backdrop) backdrop.onclick = closeEpisodePicker;
}

export { PROVIDER_LABEL };