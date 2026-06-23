process.env.CLOUD_MODE = 'true';
const consumet = require('../services/consumet-stream');

async function main() {
  const alts = ["Frieren: Beyond Journey's End"];
  const legendado = await consumet.findBestMatch('Sousou no Frieren', alts, { audioPref: 'legendado' });
  const dublado = await consumet.findBestMatch('Sousou no Frieren', alts, { audioPref: 'dublado' });
  console.log('legendado:', legendado?.name);
  console.log('dublado:', dublado?.name);
}

main().catch(console.error);