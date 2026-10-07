// ------------------------------------------------------------------
// db.js — connection to the DATA TIER (PostgreSQL).
//
// Why a "pool"? Opening a new database connection for every request is
// slow, and a database only accepts a limited number of connections.
// A pool keeps a few connections open and lends them out to requests.
// When many users hit the API at once, extra requests simply wait a
// moment for a free connection instead of crashing the database.
// ------------------------------------------------------------------
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // AWS RDS requires an encrypted (SSL/TLS) connection.
  // For a stricter setup, download the RDS CA bundle and verify it instead.
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

// Run a single query: const { rows } = await db.query('SELECT ...', [params])
// Always pass user input as $1, $2 parameters — never glue it into the SQL
// string. This is what prevents SQL injection.
function query(text, params) {
  return pool.query(text, params);
}

// Run several queries as ONE transaction (all succeed, or none are saved).
// Usage:
//   const result = await db.transaction(async (client) => {
//     await client.query(...);
//     await client.query(...);
//     return something;
//   });
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
