var TvPlayer = (function () {
  var player = null;
  var wrap = null;
  var loading = null;
  var playPauseBtn = null;
  var progressBar = null;
  var timeDisplay = null;
  var fullscreenBtn = null;
  var iconPlay = null;
  var iconPause = null;
  var iconFsEnter = null;
  var iconFsExit = null;
  var episodeLabel = null;
  var isSeeking = false;
  var onEnded = null;
  var controlsTimer = null;
  var lastTap = 0;

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateTime() {
    if (!timeDisplay || !player) return;
    timeDisplay.textContent = formatTime(player.currentTime) + ' / ' + formatTime(player.duration);
    if (!isSeeking && player.duration) {
      progressBar.value = Math.round((player.currentTime / player.duration) * 1000);
    }
  }

  function setPlayingUI(playing) {
    if (!iconPlay || !iconPause) return;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }

  function isFullscreen() {
    return !!(wrap && wrap.classList.contains('is-fullscreen')) ||
      !!document.fullscreenElement ||
      !!document.webkitFullscreenElement;
  }

  function updateFullscreenUI() {
    var active = isFullscreen();
    if (iconFsEnter) iconFsEnter.hidden = active;
    if (iconFsExit) iconFsExit.hidden = !active;
    if (fullscreenBtn) {
      fullscreenBtn.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Tela cheia');
    }
  }

  function enterFullscreen() {
    if (!wrap) return;
    wrap.classList.add('is-fullscreen');
    document.body.classList.add('player-fullscreen');
    updateFullscreenUI();
    showControls();

    var target = wrap;
    var req = target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen;
    if (req) {
      try { req.call(target); } catch (e) { /* CSS fullscreen */ }
    }
  }

  function exitFullscreen() {
    if (!wrap) return;
    wrap.classList.remove('is-fullscreen');
    document.body.classList.remove('player-fullscreen');
    updateFullscreenUI();
    showControls();

    var exit = document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
      try { exit.call(document); } catch (e) { /* ok */ }
    }
  }

  function toggleFullscreen() {
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen();
  }

  function showControls() {
    var ctrl = document.getElementById('playerControls');
    if (ctrl) ctrl.classList.remove('hidden');
    clearTimeout(controlsTimer);
    if (player && !player.paused) {
      controlsTimer = setTimeout(hideControls, 5000);
    }
  }

  function hideControls() {
    if (!player || player.paused || isSeeking) return;
    var ctrl = document.getElementById('playerControls');
    if (ctrl) ctrl.classList.add('hidden');
  }

  function showLoading(text) {
    if (!loading) return;
    var label = document.getElementById('playerLoadingText');
    if (label) label.textContent = text || 'Carregando episodio...';
    loading.hidden = false;
  }

  function hideLoading() {
    if (loading) loading.hidden = true;
  }

  function setEpisodeLabel(text) {
    if (episodeLabel) {
      episodeLabel.textContent = text || '';
      episodeLabel.hidden = !text;
    }
  }

  function onFullscreenChange() {
    var native = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!native && wrap && wrap.classList.contains('is-fullscreen')) {
      /* keep css mode */
    } else if (!native) {
      document.body.classList.remove('player-fullscreen');
      if (wrap) wrap.classList.remove('is-fullscreen');
    }
    updateFullscreenUI();
  }

  function bindLoadingEvents() {
    var hide = function () {
      if (player.readyState >= 2 || !player.paused) hideLoading();
    };

    player.addEventListener('loadeddata', hide);
    player.addEventListener('canplay', hide);
    player.addEventListener('playing', function () {
      hideLoading();
      setPlayingUI(true);
      showControls();
    });
    player.addEventListener('waiting', function () { showLoading('Bufferizando...'); });
    player.addEventListener('pause', function () {
      setPlayingUI(false);
      showControls();
    });
    player.addEventListener('play', function () { setPlayingUI(true); });
    player.addEventListener('ended', function () {
      setPlayingUI(false);
      showControls();
      if (onEnded) onEnded();
    });
    player.addEventListener('error', function () {
      hideLoading();
      setPlayingUI(false);
    });
    player.addEventListener('timeupdate', updateTime);
    player.addEventListener('durationchange', updateTime);
  }

  function bindControls() {
    playPauseBtn.addEventListener('click', function () {
      if (player.paused) player.play().catch(function () {});
      else player.pause();
      showControls();
    });

    document.getElementById('rewindBtn').addEventListener('click', function () {
      player.currentTime = Math.max(0, player.currentTime - 10);
      showControls();
    });

    document.getElementById('forwardBtn').addEventListener('click', function () {
      player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
      showControls();
    });

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleFullscreen();
      });
    }

    progressBar.addEventListener('mousedown', function () { isSeeking = true; showControls(); });
    progressBar.addEventListener('touchstart', function () { isSeeking = true; showControls(); }, { passive: true });
    progressBar.addEventListener('input', function () {
      if (player.duration) {
        player.currentTime = (progressBar.value / 1000) * player.duration;
        updateTime();
      }
    });
    progressBar.addEventListener('mouseup', function () { isSeeking = false; showControls(); });
    progressBar.addEventListener('touchend', function () { isSeeking = false; showControls(); });

    if (wrap) {
      wrap.addEventListener('click', function (e) {
        if (e.target === progressBar || e.target.closest('.ctrl-btn')) return;
        showControls();
      });

      wrap.addEventListener('touchend', function (e) {
        if (e.target !== player && !e.target.closest('.player-controls')) return;
        var now = Date.now();
        if (now - lastTap < 320) {
          toggleFullscreen();
          lastTap = 0;
        } else {
          lastTap = now;
          if (e.target === player) {
            if (player.paused) player.play().catch(function () {});
            else player.pause();
          }
        }
      });
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  function init() {
    player = document.getElementById('videoPlayer');
    wrap = document.getElementById('playerWrap');
    loading = document.getElementById('playerLoading');
    playPauseBtn = document.getElementById('playPauseBtn');
    progressBar = document.getElementById('progressBar');
    timeDisplay = document.getElementById('timeDisplay');
    fullscreenBtn = document.getElementById('fullscreenBtn');
    episodeLabel = document.getElementById('playerEpisodeLabel');
    iconPlay = playPauseBtn.querySelector('.icon-play');
    iconPause = playPauseBtn.querySelector('.icon-pause');
    if (fullscreenBtn) {
      iconFsEnter = fullscreenBtn.querySelector('.icon-fs-enter');
      iconFsExit = fullscreenBtn.querySelector('.icon-fs-exit');
    }

    bindLoadingEvents();
    bindControls();
    updateFullscreenUI();
  }

  return {
    init: init,
    get el() { return player; },
    showLoading: showLoading,
    hideLoading: hideLoading,
    setEpisodeLabel: setEpisodeLabel,
    setOnEnded: function (fn) { onEnded = fn; },
    toggleFullscreen: toggleFullscreen,
    exitFullscreen: exitFullscreen,
    isFullscreen: isFullscreen,
    togglePlay: function () {
      if (!player) return;
      if (player.paused) player.play().catch(function () {});
      else player.pause();
      showControls();
    },
    seekRelative: function (delta) {
      if (!player) return;
      player.currentTime = Math.max(0, Math.min(player.duration || 0, player.currentTime + delta));
      showControls();
    },
    reset: function () {
      exitFullscreen();
      setPlayingUI(false);
      if (progressBar) progressBar.value = 0;
      if (timeDisplay) timeDisplay.textContent = '0:00 / 0:00';
      setEpisodeLabel('');
      showControls();
    },
  };
})();