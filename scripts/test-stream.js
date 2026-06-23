const torrentSources = require('../services/torrent-sources');
const torrentStream = require('../services/torrent-stream');

const titles = ['Sousou no Frieren', "Frieren: Beyond Journey's End"];

(async () => {
  const opened = await torrentSources.openForEpisode(titles, 10);
  if (!opened.ok) {
    console.error('open failed', opened);
    process.exit(1);
  }
  console.log('magnet ok');
  const session = torrentStream.startSession(opened.magnet);
  console.log('session', session);
  const ready = await torrentStream.waitUntilReady(session.sessionId, 90000);
  console.log('ready', ready.file.name, ready.file.length);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});