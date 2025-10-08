const test = require('node:test');
const assert = require('node:assert/strict');

const { stashEnv, clearModule } = require('./test-helpers');

function resetModules() {
  clearModule('../config');
  clearModule('../premium');
}

test('premium access is locked when no SKUs are configured', { concurrency: false }, async () => {
  const restoreEnv = [
    stashEnv('PREMIUM_SKU_USER'),
    stashEnv('PREMIUM_SKU_GUILD'),
    stashEnv('JEFFREY_PREMIUM_DEV_MODE'),
    stashEnv('PREMIUM_TEST_ALLOW_GUILD_IDS'),
  ];
  delete process.env.PREMIUM_SKU_USER;
  delete process.env.PREMIUM_SKU_GUILD;
  delete process.env.PREMIUM_TEST_ALLOW_GUILD_IDS;
  process.env.JEFFREY_PREMIUM_DEV_MODE = '0';

  resetModules();
  const premium = require('../premium');
  const ok = await premium.hasPremiumAccess({ userId: '123', guildId: '456' });
  assert.equal(ok, false);

  resetModules();
  restoreEnv.forEach(fn => fn());
});

test('premium dev mode bypasses entitlement checks', { concurrency: false }, async () => {
  const restoreEnv = [
    stashEnv('JEFFREY_PREMIUM_DEV_MODE'),
    stashEnv('PREMIUM_SKU_USER'),
    stashEnv('PREMIUM_SKU_GUILD'),
  ];
  process.env.JEFFREY_PREMIUM_DEV_MODE = '1';
  delete process.env.PREMIUM_SKU_USER;
  delete process.env.PREMIUM_SKU_GUILD;

  resetModules();
  const premium = require('../premium');
  const ok = await premium.hasPremiumAccess({ userId: '123', guildId: '456' });
  assert.equal(ok, true);

  resetModules();
  restoreEnv.forEach(fn => fn());
});

test('whitelisted guilds retain access without SKUs', { concurrency: false }, async () => {
  const restoreEnv = [
    stashEnv('PREMIUM_TEST_ALLOW_GUILD_IDS'),
    stashEnv('PREMIUM_SKU_USER'),
    stashEnv('PREMIUM_SKU_GUILD'),
    stashEnv('JEFFREY_PREMIUM_DEV_MODE'),
  ];
  process.env.PREMIUM_TEST_ALLOW_GUILD_IDS = '456';
  delete process.env.PREMIUM_SKU_USER;
  delete process.env.PREMIUM_SKU_GUILD;
  process.env.JEFFREY_PREMIUM_DEV_MODE = '0';

  resetModules();
  const premium = require('../premium');
  const ok = await premium.hasPremiumAccess({ userId: '123', guildId: '456' });
  assert.equal(ok, true);

  resetModules();
  restoreEnv.forEach(fn => fn());
});
