'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const {DatabaseSync} = require('node:sqlite');
const {connect} = require('../src/postgres.cjs');
const {validState} = require('../src/validation.cjs');

async function migrate() {
  const [source, emailArg, ...extra] = process.argv.slice(2);
  if (!source || !emailArg || extra.length || !process.env.DATABASE_URL) {
    throw new Error('Indica la ruta SQLite y tu correo. Configura DATABASE_URL en el entorno.');
  }
  const email = emailArg.trim().toLowerCase();
  const local = new DatabaseSync(path.resolve(source), {readOnly: true});
  let user;
  try {
    user = local.prepare('SELECT id,email,salt,password,state,version FROM users WHERE email=?').get(email);
  } finally {
    local.close();
  }
  if (!user || !validState(JSON.parse(user.state))) throw new Error('Cuenta inexistente o registros no válidos.');
  const schema = await fs.readFile(path.join(__dirname, '../sql/schema.sql'), 'utf8');
  const pool = connect(process.env.DATABASE_URL);
  try {
    await pool.query(schema);
    const result = await pool.query(
      'INSERT INTO nutra.users(id,email,salt,password,state,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [user.id, user.email, user.salt, user.password, user.state, user.version]
    );
    console.log(result.rowCount ? 'Cuenta y registros migrados.' : 'La cuenta ya existe. Se conservó el registro remoto.');
  } finally {
    await pool.end();
  }
}

migrate().catch(error => {
  console.error('No se completó la migración. Código:', error.code || 'NUTRA_MIGRATION');
  process.exitCode = 1;
});
