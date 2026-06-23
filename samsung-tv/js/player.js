var TvPlayer = (function () {
  var player = null;
  var loading = null;
  var playPauseBtn = null;
  var progressBar = null;
  var timeDisplay = null;
  var iconPlay = null;
  var iconPause = null;
  var episodeLabel = null;
  var isSeeking = false;
  var onEnded = null;
  var controlsTimer = null;
  var controlsVisible = true;

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

  function showControls() {
    var ctrl = document.getElementById('playerControls');
    if (ctrl) ctrl.classList.remove('hidden');
    controlsVisible = true;
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, 5000);
  }

  function hideControls() {
    if (!player || player.paused) return;
    var ctrl = document.getElementById('playerControls');
    if (ctrl) ctrl.classList.add('hidden');
    controlsVisible = false;
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

    progressBar.addEventListener('mousedown', function () { isSeeking = true; showControls(); });
    progressBar.addEventListener('input', function () {
      if (player.duration) {
        player.currentTime = (progressBar.value / 1000) * player.duration;
        updateTime();
      }
    });
    progressBar.addEventListener('mouseup', function () { isSeeking = false; });

    var wrap = document.getElementById('playerWrap');
    if (wrap) {
      wrap.addEventListener('mousemove', showControls);
      wrap.addEventListener('click', showControls);
    }
  }

  function init() {
    player = document.getElementById('videoPlayer');
    loading = document.getElementById('playerLoading');
    playPauseBtn = document.getElementById('playPauseBtn');
    progressBar = document.getElementById('progressBar');
    timeDisplay = document.getElementById('timeDisplay');
    episodeLabel = document.getElementById('playerEpisodeLabel');
    iconPlay = playPauseBtn.querySelector('.icon-play');
    iconPause = playPauseBtn.querySelector('.icon-pause');

    bindLoadingEvents();
    bindControls();
  }

  return {
    init: init,
    get el() { return player; },
    showLoading: showLoading,
    hideLoading: hideLoading,
    setEpisodeLabel: setEpisodeLabel,
    setOnEnded: function (fn) { onEnded = fn; },
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
      setPlayingUI(false);
      if (progressBar) progressBar.value = 0;
      if (timeDisplay) timeDisplay.textContent = '0:00 / 0:00';
      setEpisodeLabel('');
      showControls();
    },
  };
})();