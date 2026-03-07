const { closePool, getPool } = require('../db/pool');

const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 60000);
const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS || 2000);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await getPool().query('SELECT 1');
      console.log('PostgreSQL is ready');
      await closePool();
      return;
    } catch (_) {
      await delay(intervalMs);
    }
  }

  await closePool();
  throw new Error(`Timed out waiting for PostgreSQL after ${timeoutMs}ms`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
