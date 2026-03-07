const fs = require('fs');
const path = require('path');
const { closePool, getPool } = require('../db/pool');

async function main() {
  const seedPath = path.join(__dirname, '..', 'db', 'seed.sql');
  const sql = fs.readFileSync(seedPath, 'utf8');

  if (!sql.trim()) {
    throw new Error('db/seed.sql is empty');
  }

  await getPool().query(sql);
  console.log('Database seed applied');
  await closePool();
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
