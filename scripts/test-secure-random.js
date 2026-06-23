const { fillRandomBytes, randomHex, randomBase64Url } = require('../services/secure-random');

const buf = new Uint8Array(16);
fillRandomBytes(buf);
console.log('fillRandomBytes', buf.length, Buffer.from(buf).toString('hex').slice(0, 16) + '…');

try {
  fillRandomBytes(buf, 10, 8);
  console.error('expected RangeError');
  process.exit(1);
} catch (e) {
  if (!(e instanceof RangeError)) throw e;
  console.log('bounds ok');
}

console.log('randomHex(16)', randomHex(16).length);
console.log('randomHex(18)', randomHex(18).length);
console.log('randomBase64Url(24)', randomBase64Url(24).length);