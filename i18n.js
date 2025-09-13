// i18n.js
const path = require('path');
const clientDB = require('./database');

// Load locale dictionaries (extend as needed)
const locales = {
  'en-US': require('./locales/en-US.json'),
  'es-ES': require('./locales/es-ES.json'),
  // Additional locales (fallback to en-US unless overridden by a JSON file):
  'en-GB': {}, 'bg': {}, 'zh-CN': {}, 'zh-TW': {}, 'hr': {}, 'cs': {}, 'da': {}, 'nl': {}, 'fi': {},
  'fr': {}, 'de': {}, 'el': {}, 'hi': {}, 'hu': {}, 'id': {}, 'it': {}, 'ja': {}, 'ko': {}, 'lt': {}, 'no': {},
  'pl': {}, 'pt-BR': {}, 'ro': {}, 'ru': {}, 'es-419': {}, 'sv-SE': {}, 'th': {}, 'tr': {}, 'uk': {}, 'vi': {}
};

const DEFAULT_LOCALE = 'en-US';

function get(obj, key) {
  return key.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
}

function format(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function t(locale, key, vars) {
  const dict = locales[locale] || locales[DEFAULT_LOCALE] || {};
  const base = get(dict, key) ?? get(locales[DEFAULT_LOCALE] || {}, key) ?? key;
  return typeof base === 'string' ? format(base, vars) : base;
}

function channelName(locale, key) {
  return t(locale, `channels.${key}`);
}

async function getGuildLocale(guildId, fallback) {
  try {
    const r = await clientDB.query('SELECT locale FROM guild_settings WHERE guild_id=$1', [guildId]);
    if (r.rows[0]?.locale) return r.rows[0].locale;
  } catch (_) {}
  return fallback || DEFAULT_LOCALE;
}

async function getUserLocale(userId, fallback) {
  try {
    const r = await clientDB.query('SELECT locale FROM user_settings WHERE user_id=$1', [userId]);
    if (r.rows[0]?.locale) return r.rows[0].locale;
  } catch (_) {}
  return fallback || DEFAULT_LOCALE;
}

async function preferredLocale({ userId = null, guildId = null, discordLocale = null } = {}) {
  const fromUser = userId ? await getUserLocale(userId).catch(() => null) : null;
  if (fromUser) return fromUser;
  const fromGuild = guildId ? await getGuildLocale(guildId, null).catch(() => null) : null;
  if (fromGuild) return fromGuild;
  return discordLocale || DEFAULT_LOCALE;
}

function allLocaleCodes() { return Object.keys(locales); }

module.exports = { t, channelName, getGuildLocale, getUserLocale, preferredLocale, DEFAULT_LOCALE, allLocaleCodes };
