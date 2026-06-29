const goanime = require('./goanime');
const consumet = require('./consumet-stream');
const saturnDirect = require('./anime-saturn-direct');
const { decodeRef } = require('./consumet-stream');

async function synopsisFromAnimeFire(url) {
  const data = await goanime.getAnimeFromSource(url);
  return data.synopsis || null;
}

async function synopsisFromConsumet(url) {
  const data = await consumet.getAnimeFromSource(url);
  return data.synopsis || null;
}

async function synopsisFromSaturnId(encodedUrl) {
  const decoded = decodeRef(encodedUrl);
  if (!decoded || decoded.provider !== 'AnimeSaturn') return null;
  const animeId = decoded.animeId || decoded.id;
  const info = await saturnDirect.fetchAnimeInfo(animeId);
  return info.description || null;
}

function isUsefulSynopsis(text) {
  const t = String(text || '').trim();
  return t.length > 60 && !/assistir.*epis[oó]dios|baixe os epis[oó]dios/i.test(t);
}

async function fetchSourceSynopsis(sourceMatch) {
  if (!sourceMatch?.url) return null;

  try {
    if (sourceMatch.source === 'animefire') {
      const text = await synopsisFromAnimeFire(sourceMatch.url);
      return isUsefulSynopsis(text) ? text : null;
    }

    if (String(sourceMatch.url).startsWith('consumet:')) {
      if (sourceMatch.source === 'animesaturn') {
        const desc = await synopsisFromSaturnId(sourceMatch.url);
        if (isUsefulSynopsis(desc) && /[áàâãéêíóôõúç]/i.test(desc)) return desc;
      }
      const text = await synopsisFromConsumet(sourceMatch.url);
      return isUsefulSynopsis(text) ? text : null;
    }
  } catch {
    return null;
  }

  return null;
}

module.exports = { fetchSourceSynopsis };