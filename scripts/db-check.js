require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [[
        'user_settings',
        'guild_settings',
        'public_messages',
        'queues',
        'blacklisted_users',
        'events',
      ]]
    );
    const present = res.rows.map(r => r.table_name).sort();
    const required = ['public_messages', 'queues', 'blacklisted_users'];
    const optional = ['events'];
    const missingRequired = required.filter(t => !present.includes(t));
    const hasUnused = present.filter(t => ['user_settings', 'guild_settings'].includes(t));

    console.log('Tables present:', present.join(', ') || '(none)');
    console.log('Missing required:', missingRequired.length ? missingRequired.join(', ') : 'none');
    console.log('Optional present:', optional.filter(t => present.includes(t)).join(', ') || 'none');
    console.log('Unused settings tables present:', hasUnused.join(', ') || 'none');
  } catch (e) {
    console.error('DB check failed:', e.message);
    process.exit(1);
  } finally {
    try { await client.end(); } catch {}
  }
}

main();

