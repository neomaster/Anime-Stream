const crypto = require('crypto');

/**
 * Preenche bytes aleatórios em um buffer existente (sem alocações extras).
 * @param {Uint8Array} buf
 * @param {number} [offset=0]
 * @param {number} [length]
 */
function fillRandomBytes(buf, offset = 0, length) {
  if (!buf || typeof buf.length !== 'number') {
    throw new TypeError('Buffer required');
  }

  offset = offset || 0;
  const span = length == null ? buf.length - offset : length;

  if (offset < 0 || span <= 0 || offset + span > buf.length) {
    throw new RangeError('Buffer overflow');
  }

  crypto.randomFillSync(buf.subarray(offset, offset + span));
  return buf;
}

/** @param {number} byteLength */
function randomHex(byteLength) {
  if (byteLength === 16 && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  const buf = new Uint8Array(byteLength);
  fillRandomBytes(buf);
  return Buffer.from(buf).toString('hex');
}

/** @param {number} byteLength */
function randomBase64Url(byteLength) {
  const buf = new Uint8Array(byteLength);
  fillRandomBytes(buf);
  return Buffer.from(buf).toString('base64url');
}

module.exports = {
  fillRandomBytes,
  randomHex,
  randomBase64Url,
};