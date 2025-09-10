// init-and-exit.js
// Connects to the DB, ensures schema, then exits.
require('dotenv').config();
const clientDB = require('./database');
const { ensureSchema } = require('./dbInit');

(async () => {
  try {
    await clientDB.query('SELECT 1');
    await ensureSchema(clientDB);
    console.log('✅ Schema ensured.');
  } catch (err) {
    console.error('Schema init failed:', err);
    process.exitCode = 1;
  } finally {
    try { await clientDB.end(); } catch {}
  }
})();

