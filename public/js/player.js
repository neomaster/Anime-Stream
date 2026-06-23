export function createPlayer() {
  const player = document.getElementById('videoPlayer');
  const wrap = document.getElementById('playerWrap');
  const loading = document.getElementById('playerLoading');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const rewindBtn = document.getElementById('rewindBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  const progressBar = document.getElementById('progressBar');
  const timeDisplay = document.getElementById('timeDisplay');
  const muteBtn = document.getElementById('muteBtn');
  const volumeBar = document.getElementById('volumeBar');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const iconPlay = playPauseBtn.querySelector('.icon-play');
  const iconPause = playPauseBtn.querySelector('.icon-pause');
  const iconVol = muteBtn.querySelector('.icon-vol');
  const iconMuted = muteBtn.querySelector('.icon-muted');
  const episodeLabel = document.getElementById('playerEpisodeLabel');

  let isSeeking = false;
  let onEnded = null;

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateTime() {
    timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
    if (!isSeeking && player.duration) {
      progressBar.value = Math.round((player.currentTime / player.duration) * 1000);
    }
  }

  function setPlayingUI(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }

  function showLoading(text = 'Carregando episódio...') {
    document.getElementById('playerLoadingText').textContent = text;
    loading.hidden = false;
  }

  function hideLoading() {
    loading.hidden = true;
  }

  function setEpisodeLabel(text) {
    if (!episodeLabel) return;
    episodeLabel.textContent = text || '';
    episodeLabel.hidden = !text;
  }

  function bindLoadingEvents() {
    const hide = () => {
      if (player.readyState >= 2 || !player.paused) hideLoading();
    };

    player.addEventListener('loadeddata', hide);
    player.addEventListener('canplay', hide);
    player.addEventListener('playing', () => {
      hideLoading();
      setPlayingUI(true);
    });
    player.addEventListener('waiting', () => showLoading('Bufferizando...'));
    player.addEventListener('pause', () => setPlayingUI(false));
    player.addEventListener('play', () => setPlayingUI(true));
    player.addEventListener('ended', () => {
      setPlayingUI(false);
      if (onEnded) onEnded();
    });
    player.addEventListener('error', () => {
      hideLoading();
      setPlayingUI(false);
    });
    player.addEventListener('timeupdate', updateTime);
    player.addEventListener('durationchange', updateTime);
  }

  function syncMuteUI() {
    const muted = player.muted || player.volume === 0;
    muteBtn.classList.toggle('is-muted', muted);
    muteBtn.setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
    if (iconVol) iconVol.hidden = muted;
    if (iconMuted) iconMuted.hidden = !muted;
  }

  bindLoadingEvents();
  syncMuteUI();

  playPauseBtn.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });

  rewindBtn.addEventListener('click', () => {
    player.currentTime = Math.max(0, player.currentTime - 10);
  });

  forwardBtn.addEventListener('click', () => {
    player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
  });

  progressBar.addEventListener('mousedown', () => { isSeeking = true; });
  progressBar.addEventListener('touchstart', () => { isSeeking = true; });
  progressBar.addEventListener('input', () => {
    if (player.duration) {
      player.currentTime = (progressBar.value / 1000) * player.duration;
      updateTime();
    }
  });
  progressBar.addEventListener('mouseup', () => { isSeeking = false; });
  progressBar.addEventListener('touchend', () => { isSeeking = false; });

  muteBtn.addEventListener('click', () => {
    player.muted = !player.muted;
    if (!player.muted && player.volume === 0) {
      player.volume = 0.5;
      volumeBar.value = '50';
    }
    syncMuteUI();
  });

  volumeBar.addEventListener('input', () => {
    player.volume = volumeBar.value / 100;
    player.muted = player.volume === 0;
    syncMuteUI();
  });

  fullscreenBtn.addEventListener('click', () => {
    const target = wrap.requestFullscreen ? wrap : player;
    if (document.fullscreenElement) document.exitFullscreen();
    else (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
  });

  document.addEventListener('fullscreenchange', () => {
    wrap.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  });

  wrap.addEventListener('click', (e) => {
    if (e.target === player) {
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    } else if (e.code === 'ArrowLeft') {
      player.currentTime = Math.max(0, player.currentTime - 10);
    } else if (e.code === 'ArrowRight') {
      player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
    }
  });

  return {
    el: player,
    showLoading,
    hideLoading,
    setEpisodeLabel,
    setOnEnded(fn) { onEnded = fn; },
    togglePlay() {
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    },
    reset() {
      setPlayingUI(false);
      progressBar.value = 0;
      timeDisplay.textContent = '0:00 / 0:00';
      setEpisodeLabel('');
    },
  };
}