const { REST } = require('discord.js');

const {
  ACCESS_TOKEN_DISCORD,
  CLIENT_ID,
  PREMIUM_SKU_USER,
  PREMIUM_SKU_GUILD
} = process.env;

// Reuse Discord REST for Entitlements API
const rest = new REST({ version: '10' }).setToken(ACCESS_TOKEN_DISCORD);

function parseSkuList(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

const userSkus = parseSkuList(PREMIUM_SKU_USER);
const guildSkus = parseSkuList(PREMIUM_SKU_GUILD);
const testGuildAllow = parseSkuList(process.env.PREMIUM_TEST_ALLOW_GUILD_IDS);

// simple in-memory caches to reduce API calls
const cacheUser = new Map(); // key: userId -> { at, ok }
const cacheGuild = new Map(); // key: guildId -> { at, ok }
const TTL_MS = 60 * 1000; // 60 seconds

async function fetchEntitlements(params) {
  // If Premium Apps not configured, treat as entitled (dev mode)
  if (!ACCESS_TOKEN_DISCORD || !CLIENT_ID) return [];
  const query = new URLSearchParams({ exclude_expired: 'true' });
  if (params.userId) query.set('user_id', params.userId);
  if (params.guildId) query.set('guild_id', params.guildId);
  if (params.skuIds && params.skuIds.length) query.set('sku_ids', params.skuIds.join(','));
  try {
    const entitlements = await rest.get(`/applications/${CLIENT_ID}/entitlements?${query.toString()}`);
    // Basic filtering: non-deleted and not obviously expired
    return (Array.isArray(entitlements) ? entitlements : []).filter(e => !e.deleted);
  } catch (err) {
    const status = err?.status ?? err?.code ?? 'unknown';
    console.warn('Entitlement fetch failed:', status, err?.message || String(err));
    // If endpoint not accessible (e.g., Premium not enabled), fail closed as not entitled
    return [];
  }
}

async function hasUserEntitlement(userId) {
  // If no SKUs configured, allow all users (free mode)
  if (!userSkus.length) return true;
  const now = Date.now();
  const hit = cacheUser.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.ok;
  const ents = await fetchEntitlements({ userId, skuIds: userSkus });
  const ok = ents.length > 0;
  cacheUser.set(userId, { at: now, ok });
  return ok;
}

async function hasGuildEntitlement(guildId) {
  // If no SKUs configured, allow all guilds (free mode)
  if (testGuildAllow.includes(String(guildId))) return true; // explicit whitelist for testing
  if (!guildSkus.length) return true;
  const now = Date.now();
  const hit = cacheGuild.get(guildId);
  if (hit && now - hit.at < TTL_MS) return hit.ok;
  const ents = await fetchEntitlements({ guildId, skuIds: guildSkus });
  const ok = ents.length > 0;
  cacheGuild.set(guildId, { at: now, ok });
  return ok;
}

function isWhitelistedGuild(guildId) {
  return testGuildAllow.includes(String(guildId));
}

async function hasPremiumAccess({ userId, guildId } = {}) {
  if (guildId && isWhitelistedGuild(guildId)) return true;

  if (guildId) {
    const guildOk = await hasGuildEntitlement(guildId);
    if (guildOk) return true;
  }

  if (userId) {
    return await hasUserEntitlement(userId);
  }

  return false;
}

module.exports = {
  hasUserEntitlement,
  hasGuildEntitlement,
  hasPremiumAccess,
  isWhitelistedGuild,
};
