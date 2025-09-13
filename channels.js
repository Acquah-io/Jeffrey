const { ChannelType } = require('discord.js');
const { allLocaleCodes, channelName, getGuildLocale } = require('./i18n');

function namesForKey(key) {
  const names = new Set();
  for (const code of allLocaleCodes()) {
    const n = channelName(code, key);
    if (n && typeof n === 'string') names.add(n);
  }
  return Array.from(names);
}

function getChannelByKey(guild, key, type = ChannelType.GuildText) {
  const candidates = namesForKey(key).map(s => s.toLowerCase());
  return guild.channels.cache.find(ch => ch.type === type && candidates.includes(ch.name.toLowerCase())) || null;
}

async function ensureChannelName(guild, channel, key) {
  const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
  const desired = channelName(locale, key);
  if (channel && channel.name !== desired) {
    try { await channel.setName(desired); } catch (_) {}
  }
}

module.exports = { getChannelByKey, ensureChannelName };

