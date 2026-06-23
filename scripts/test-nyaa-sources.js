const nyaa = require('../services/nyaa');
const torrentSources = require('../services/torrent-sources');

async function main() {
  const rows = await nyaa.searchIndex(['Sousou no Frieren 10'], 10);
  console.log('nyaa rows', rows.length);
  console.log(
    rows.slice(0, 3).map((r) => ({
      name: r.name.slice(0, 60),
      seeds: r.seeds,
      leeches: r.leeches,
      magnet: r.magnet ? 'yes' : 'no',
    }))
  );

  const ranked = await torrentSources.openForEpisode(
    ['Sousou no Frieren', 'Frieren: Beyond Journey\'s End'],
    10
  );
  console.log('open result', {
    ok: ranked.ok,
    source: ranked.source,
    seeders: ranked.seeders,
    leechers: ranked.leechers,
    tried: ranked.triedSources?.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});