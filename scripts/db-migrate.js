const fs = require('fs');
const path = require('path');
const { closePool, getPool } = require('../db/pool');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  if (!sql.trim()) {
    throw new Error('db/schema.sql is empty');
  }

  await getPool().query(sql);
  console.log('Database schema applied');
  await closePool();
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
