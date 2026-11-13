'use strict';
const {Pool} = require('pg');
const fs = require('node:fs');
const path = require('node:path');

function connect(url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL.');
  }
  // The pooler accepts regular parameterized queries without named prepared statements.
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith('ssl')) parsed.searchParams.delete(key);
  }
  return new Pool({
    connectionString: parsed.toString(),
    ssl: {rejectUnauthorized: true, ca: fs.readFileSync(path.join(__dirname, '../certs/supabase-ca.pem'), 'utf8')},
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    query_timeout: 8000
  });
}

function postgres(url) {
  const pool = connect(url);
  pool.on('error', () => console.error('Se perdió una conexión inactiva con PostgreSQL.'));
  return {
    prepare(sql) {
      let index = 0;
      const statement = sql.replace(/\b(FROM|INTO|UPDATE) (users|sessions|limits|captcha_used|cache)\b/g, '$1 nutra.$2').replace(/\?/g, () => '$' + ++index);
      return {
        async get(...params) {
          return (await pool.query(statement, params)).rows[0];
        },
        async run(...params) {
          return {changes: (await pool.query(statement, params)).rowCount};
        }
      };
    },
    close: () => pool.end()
  };
}

module.exports = {connect, postgres};

