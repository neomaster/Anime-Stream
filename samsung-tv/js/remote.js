var Remote = (function () {
  var KEYS = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    ENTER: 13,
    RETURN: 10009,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    RW: 412,
    FF: 417,
    RED: 403,
  };

  var focusables = [];
  var currentIndex = 0;
  var onBack = null;
  var onMediaKey = null;
  var onRedKey = null;
  var enabled = true;

  function isVisible(el) {
    if (!el || el.hidden || el.disabled) return false;
    var node = el;
    while (node && node !== document.body) {
      if (node.hidden) return false;
      var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      node = node.parentElement;
    }
    return el.offsetParent !== null || el === document.activeElement;
  }

  function refreshFocusables() {
    focusables = Array.prototype.slice.call(
      document.querySelectorAll('.focusable:not([disabled])')
    ).filter(isVisible);
  }

  function clearFocus() {
    focusables.forEach(function (f) { f.classList.remove('focused'); });
  }

  function focusAt(index) {
    refreshFocusables();
    if (!focusables.length) return;
    currentIndex = Math.max(0, Math.min(index, focusables.length - 1));
    var el = focusables[currentIndex];
    el.focus();
    clearFocus();
    el.classList.add('focused');
    if (el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function focusElement(el) {
    refreshFocusables();
    var idx = focusables.indexOf(el);
    if (idx >= 0) focusAt(idx);
    else focusAt(0);
  }

  function findNearest(direction) {
    refreshFocusables();
    if (!focusables.length) return;
    var current = focusables[currentIndex];
    if (!current) { focusAt(0); return; }

    var cur = current.getBoundingClientRect();
    var cx = cur.left + cur.width / 2;
    var cy = cur.top + cur.height / 2;
    var best = -1;
    var bestDist = Infinity;

    focusables.forEach(function (el, i) {
      if (i === currentIndex) return;
      var r = el.getBoundingClientRect();
      var ex = r.left + r.width / 2;
      var ey = r.top + r.height / 2;
      var dx = ex - cx;
      var dy = ey - cy;

      if (direction === 'left' && dx >= -8) return;
      if (direction === 'right' && dx <= 8) return;
      if (direction === 'up' && dy >= -8) return;
      if (direction === 'down' && dy <= 8) return;

      var primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      var secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      var dist = primary + secondary * 0.35;

      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });

    if (best >= 0) focusAt(best);
  }

  function isTyping() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    if (el.classList.contains('ip-octet') || el.classList.contains('port-input') || el.classList.contains('ep-filter')) return false;
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    return type === 'text' || type === 'search' || type === 'email' || type === 'url';
  }

  function handleKey(e) {
    if (!enabled) return;

    var code = e.keyCode;

    if (code === KEYS.RETURN) {
      if (onBack) onBack();
      e.preventDefault();
      return;
    }

    if (code === KEYS.RED && onRedKey) {
      onRedKey();
      e.preventDefault();
      return;
    }

    if (onMediaKey && (code === KEYS.PLAY || code === KEYS.PAUSE || code === KEYS.RW || code === KEYS.FF || code === KEYS.STOP)) {
      onMediaKey(code);
      e.preventDefault();
      return;
    }

    if (isTyping()) return;

    if (code === KEYS.LEFT) { findNearest('left'); e.preventDefault(); }
    else if (code === KEYS.RIGHT) { findNearest('right'); e.preventDefault(); }
    else if (code === KEYS.UP) { findNearest('up'); e.preventDefault(); }
    else if (code === KEYS.DOWN) { findNearest('down'); e.preventDefault(); }
    else if (code === KEYS.ENTER) {
      var el = focusables[currentIndex];
      if (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
        el.click();
      }
      e.preventDefault();
    }
  }

  function registerTizenKeys() {
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
    var keys = [
      'MediaPlay', 'MediaPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind', 'ColorF0Red',
    ];
    keys.forEach(function (k) {
      try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* firmware antigo */ }
    });
  }

  function init(options) {
    onBack = options.onBack || null;
    onMediaKey = options.onMediaKey || null;
    onRedKey = options.onRedKey || null;
    document.addEventListener('keydown', handleKey);
    registerTizenKeys();
  }

  return {
    init: init,
    focusAt: focusAt,
    focusElement: focusElement,
    refresh: refreshFocusables,
    setEnabled: function (v) { enabled = !!v; },
    KEYS: KEYS,
  };
})();