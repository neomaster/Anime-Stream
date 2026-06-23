(function () {
  'use strict';

  function flattenError(err, depth) {
    var parts = [];
    var cur = err;
    var n = depth || 0;
    while (cur && n < 5) {
      if (typeof cur === 'string') {
        parts.push(cur);
        break;
      }
      parts.push(String(cur.message || cur));
      parts.push(String(cur.stack || ''));
      cur = cur.cause || cur.reason || null;
      n++;
    }
    return parts.join(' ');
  }

  function isNoise(input) {
    var s = typeof input === 'string' ? input : flattenError(input);
    return /ChromeMethodBFE|\.ldb\b|FILE_ERROR_NO_SPACE|Unable to create writable file|NewWritableFile|WritableFileAppend/i.test(s);
  }

  if (window.__animeStreamNoiseShield) return;
  window.__animeStreamNoiseShield = true;

  window.addEventListener('unhandledrejection', function (e) {
    if (isNoise(e.reason)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('error', function (e) {
    if (isNoise(e.error || e.message || '')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  var origError = console.error;
  var origWarn = console.warn;

  console.error = function () {
    var s = Array.prototype.join.call(arguments, ' ');
    if (isNoise(s) || isNoise(arguments[0])) return;
    return origError.apply(console, arguments);
  };

  console.warn = function () {
    var s = Array.prototype.join.call(arguments, ' ');
    if (isNoise(s) || isNoise(arguments[0])) return;
    return origWarn.apply(console, arguments);
  };
})();