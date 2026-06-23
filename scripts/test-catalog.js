process.env.ALT_SOURCES = 'true';
const torrentSources = require('../services/torrent-sources');

torrentSources
  .catalogForTitles(['ReZERO', 'Re:Zero'], { limit: 5 })
  .then((cat) => {
    console.log('provider', cat.provider);
    console.log('items', cat.items.length);
    cat.items.forEach((i) => {
      console.log('-', i.label, i.quality, i.seedersBand, i.ref.slice(0, 12) + '…');
      const hasMagnet = JSON.stringify(i).includes('magnet');
      const hasUrl = JSON.stringify(i).includes('1337') || JSON.stringify(i).includes('1377');
      if (hasMagnet || hasUrl) console.error('LEAK DETECTED');
    });
    return torrentSources.reserveRef(cat.items[0]?.ref);
  })
  .then((r) => {
    console.log('reserve', r);
    const leak = JSON.stringify(r).includes('magnet');
    if (leak) console.error('RESERVE LEAK');
    else console.log('OK: sem magnet na resposta');
  })
  .catch(console.error);