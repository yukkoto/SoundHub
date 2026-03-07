const { Pool } = require('pg');

let pool;

function getConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'soundhub',
    user: process.env.PGUSER || 'soundhub',
    password: process.env.PGPASSWORD || 'soundhub'
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getConnectionConfig());
    pool.on('error', err => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }

  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withTransaction(fn) {
  return withClient(async client => {
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function closePool() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

module.exports = {
  closePool,
  getPool,
  query,
  withClient,
  withTransaction
};
