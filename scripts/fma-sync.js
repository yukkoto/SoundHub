const store = require('../db/store');
const fma = require('../services/fma');

async function main() {
  const limit = Math.max(0, Number(process.env.FMA_IMPORT_LIMIT || 0));
  const purgeLegacy = ['1', 'true', 'yes'].includes(String(process.env.FMA_PURGE_DEEZER || '').toLowerCase());

  if (purgeLegacy) {
    await store.deletePlaylistsBySourceProvider('deezer');
    await store.deleteTracksBySourceProvider('deezer');
  }

  const tracks = fma.loadCatalogTracks({
    limit: limit || undefined,
    subset: process.env.FMA_SUBSET || undefined,
    tracksCsv: process.env.FMA_TRACKS_CSV || undefined,
    genresCsv: process.env.FMA_GENRES_CSV || undefined,
    publicBaseUrl: process.env.VK_S3_PUBLIC_BASE_URL || undefined,
    audioPrefix: process.env.FMA_AUDIO_PREFIX || undefined
  });

  const imported = await store.upsertImportedTracks(tracks);
  console.log(`FMA sync imported or refreshed ${imported.length} tracks`);
}

main().catch(error => {
  const message = error && (error.message || String(error));

  if (message && message.includes('FMA tracks.csv not found')) {
    console.error(message);
    console.error('Set FMA_TRACKS_CSV in .env or place the extracted FMA metadata under data/fma/.');
  } else if (message && message.includes('127.0.0.1:5432')) {
    console.error('PostgreSQL is not reachable on the current DATABASE_URL / PGHOST settings.');
  } else {
    console.error(error.stack || message || error);
  }

  process.exit(1);
});
