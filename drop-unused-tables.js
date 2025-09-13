// drop-unused-tables.js
// One-off cleanup to remove tables that are no longer used.
require('dotenv').config();
const client = require('./database');

(async () => {
  try {
    await client.query('DROP TABLE IF EXISTS user_settings');
    await client.query('DROP TABLE IF EXISTS guild_settings');
    console.log('✅ Dropped tables: user_settings, guild_settings (if they existed).');
  } catch (err) {
    console.error('Failed to drop tables:', err);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
})();

