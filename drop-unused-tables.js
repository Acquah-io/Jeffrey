// drop-unused-tables.js
// One-off cleanup to remove tables that are no longer used.
require('dotenv').config();
const client = require('./database');

(async () => {
  try {
    await client.query('DROP TABLE IF EXISTS voice_session_participants');
    await client.query('DROP TABLE IF EXISTS voice_session_deliveries');
    await client.query('DROP TABLE IF EXISTS voice_sessions');
    await client.query('DROP TABLE IF EXISTS knowledge_snippets');
    await client.query('DROP TABLE IF EXISTS user_settings');
    await client.query('DROP TABLE IF EXISTS guild_settings');
    console.log('✅ Dropped tables related to legacy class summaries and settings (if they existed).');
  } catch (err) {
    console.error('Failed to drop tables:', err);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
})();
