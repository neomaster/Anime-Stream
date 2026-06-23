import { safeGet, safeSet } from './storage-safe.js';

const AUDIO_KEY = 'anime_stream_audio_pref';
const SUB_KEY = 'anime_stream_sub_track';

export function getAudioPref() {
  return safeGet(AUDIO_KEY, 'legendado') || 'legendado';
}

export function saveAudioPref(value) {
  safeSet(AUDIO_KEY, value);
}

function subtitleRank(sub) {
  const hay = `${sub.label || ''} ${sub.lang || ''} ${sub.url || ''}`.toLowerCase();
  if (/pt-br|pt_br|portugu[eê]s.*br/.test(hay)) return 0;
  if (/portugu[eê]s|^pt$/.test(hay)) return 1;
  if (/english|^en$/.test(hay)) return 2;
  if (/spanish|espa/.test(hay)) return 3;
  if (/italian|italiano|ita/.test(hay)) return 4;
  return 50;
}

export function sortList(subs) {
  return [...(subs || [])].sort((a, b) => subtitleRank(a) - subtitleRank(b));
}

function inferLang(sub) {
  if (sub.lang) return sub.lang;
  const hay = `${sub.label || ''} ${sub.url || ''}`.toLowerCase();
  if (/pt-br|pt_br/.test(hay)) return 'pt-BR';
  if (/pt|portugu/.test(hay)) return 'pt';
  if (/en|english/.test(hay)) return 'en';
  if (/it|ita|ital/.test(hay)) return 'it';
  return 'und';
}

function saveTrackPref(index) {
  safeSet(SUB_KEY, String(index));
}

function getTrackPref() {
  const v = safeGet(SUB_KEY, null);
  if (v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function applyTrackMode(player, selectEl, trackIndex) {
  for (let i = 0; i < player.textTracks.length; i++) {
    player.textTracks[i].mode = trackIndex === i ? 'showing' : 'hidden';
  }
  if (selectEl) selectEl.value = trackIndex === null || trackIndex < 0 ? '' : String(trackIndex);
}

function pickDefaultTrack(subs, savedPref) {
  if (savedPref !== null && savedPref >= 0 && savedPref < subs.length) return savedPref;
  for (let i = 0; i < subs.length; i++) {
    if (subtitleRank(subs[i]) <= 1) return i;
  }
  return subs.length ? 0 : null;
}

export function setup(player, stream, selectEl, controlsEl) {
  if (!player || !controlsEl) return;

  controlsEl.hidden = true;
  player.querySelectorAll('track').forEach((t) => t.remove());

  const metaEl = document.getElementById('embeddedSubInfo');
  if (metaEl) metaEl.hidden = true;
  if (selectEl) {
    selectEl.disabled = false;
    selectEl.innerHTML = '<option value="">Desativada</option>';
  }

  const subs = sortList(stream.subtitles || []);
  if (!subs.length) {
    if (stream.embeddedSubtitles && stream.subtitleLangLabel) {
      if (metaEl) {
        metaEl.textContent = `Legendas embutidas: ${stream.subtitleLangLabel}`;
        metaEl.hidden = false;
      } else if (selectEl) {
        controlsEl.hidden = false;
        selectEl.innerHTML = `<option value="">Embutida (${stream.subtitleLangLabel})</option>`;
        selectEl.disabled = true;
      }
    }
    return;
  }

  controlsEl.hidden = false;
  const savedPref = getTrackPref();
  const defaultIdx = pickDefaultTrack(subs, savedPref);

  if (selectEl) selectEl.innerHTML = '<option value="">Desativada</option>';

  subs.forEach((sub, i) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label || 'Legenda';
    track.srclang = inferLang(sub);
    track.src = sub.proxyUrl || sub.url;
    track.default = i === defaultIdx;
    player.appendChild(track);

    if (selectEl) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = sub.label || 'Legenda';
      selectEl.appendChild(opt);
    }
  });

  if (selectEl) {
    selectEl.onchange = () => {
      if (selectEl.value === '') {
        applyTrackMode(player, selectEl, null);
        saveTrackPref(-1);
        return;
      }
      const idx = parseInt(selectEl.value, 10);
      applyTrackMode(player, selectEl, idx);
      saveTrackPref(idx);
    };
    selectEl.value = defaultIdx === null ? '' : String(defaultIdx);
  }

  const activate = () => {
    if (defaultIdx === null) applyTrackMode(player, selectEl, null);
    else applyTrackMode(player, selectEl, defaultIdx);
  };

  if (player.readyState >= 1) activate();
  else player.addEventListener('loadedmetadata', activate, { once: true });
}

export function bindAudioPrefSelect(selectEl, onChange) {
  if (!selectEl) return;
  selectEl.value = getAudioPref();
  selectEl.addEventListener('change', () => {
    saveAudioPref(selectEl.value);
    if (onChange) onChange(selectEl.value);
  });
}