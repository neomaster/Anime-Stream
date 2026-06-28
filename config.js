module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3456,
  CLOUD_MODE: process.env.CLOUD_MODE === 'true' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT,
  PUBLIC_URL: (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    ''
  ).replace(/\/+$/, ''),
  GOANIME_PATH: process.env.GOANIME_PATH || 'C:\\Program Files\\GoAnime',
  GOANIME_EXE: process.env.GOANIME_EXE || 'C:\\Program Files\\GoAnime\\goanime.exe',
  JIKAN_BASE: 'https://api.jikan.moe/v4',
  ANIMEFIRE_BASE: process.env.ANIMEFIRE_BASE || 'https://animefire.io',
  ALT_SOURCES_ENABLED: process.env.ALT_SOURCES !== 'false',
  NYAA_ENABLED: process.env.NYAA_ENABLED !== 'false',
  NYAA_BASE: (process.env.NYAA_BASE || 'https://nyaa.si').replace(/\/+$/, ''),
  NYAA_MIRRORS: process.env.NYAA_MIRRORS || 'https://nyaa.si,https://nyaa.one',
  X1337_MIRRORS:
    process.env.X1337_MIRRORS || 'https://www.1377x.to,https://www.1337x.st,https://1337x.gd',
  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};