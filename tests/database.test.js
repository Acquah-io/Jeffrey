const test = require('node:test');
const assert = require('node:assert/strict');
const { stashEnv, clearModule } = require('./test-helpers');

test('database exports stub when DATABASE_URL is missing', { concurrency: false }, async () => {
  const restoreDbUrl = stashEnv('DATABASE_URL');
  delete process.env.DATABASE_URL;

  clearModule('../config');
  const configModule = require('../config');
  configModule.config.databaseUrl = '';
  process.env.DATABASE_URL = '';
  clearModule('../database');

  const db = require('../database');
  assert.strictEqual(db.configured, false);
  await assert.rejects(() => db.query('SELECT 1'), /Database is not configured/);

  restoreDbUrl();
  clearModule('../config');
  clearModule('../database');
});
