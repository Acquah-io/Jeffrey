// features/studyTips.js
// Configure scheduled "study time" reminders per guild.
// Frequency: 14 days, 7 days, 3 days, or 1 day; time settable; staff only.

const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');
const clientDB = require('../database');
const premium = require('../premium');
const { channelName } = require('../i18n');
const { getChannelByKey } = require('../channels');

// Allowed frequencies, ordered from least → most frequent
const FREQUENCIES = [14, 7, 3, 1];

// Ensure table
async function ensureTable() {
  await clientDB.query(`
    CREATE TABLE IF NOT EXISTS study_tips (
      guild_id           TEXT PRIMARY KEY,
      enabled            BOOLEAN NOT NULL DEFAULT false,
      frequency_days     INTEGER NOT NULL DEFAULT 7,
      time_of_day        TEXT NOT NULL DEFAULT '12:00', -- HH:MM in 24h
      timezone           TEXT NOT NULL DEFAULT 'UTC',
      settings_channel_id TEXT,
      target_channel_id   TEXT,
      next_send_at       TIMESTAMPTZ,
      last_sent_at       TIMESTAMPTZ
    );
  `);
  // Backfill new columns over time
  await clientDB.query(`ALTER TABLE study_tips ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false`);
}

function parseHHMM(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s).trim());
  if (!m) return null;
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
}

// Compute timezone offset minutes for a given Date in a specific IANA zone
function tzOffsetMinutes(date, timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return (asUTC - date.getTime()) / 60000; // minutes to add to UTC to get TZ time
  } catch (_) {
    return 0; // fallback to UTC
  }
}

// Given desired local time + timezone and an origin date, compute the next UTC time
function computeNextUTC({ from = new Date(), hour = 12, minute = 0, timeZone = 'UTC', plusDays = 0 }) {
  const now = from;
  // Current date in target TZ
  const off = tzOffsetMinutes(now, timeZone);
  const tzNow = new Date(now.getTime() + off * 60000);
  const base = new Date(Date.UTC(tzNow.getUTCFullYear(), tzNow.getUTCMonth(), tzNow.getUTCDate(), hour, minute, 0));
  let targetLocalMs = base.getTime();
  if (plusDays) targetLocalMs += plusDays * 86400000;
  // If the scheduled time today already passed, move to next day
  if (targetLocalMs <= tzNow.getTime()) {
    targetLocalMs += 86400000; // +1 day
  }
  // Convert local-in-tz ms back to UTC by subtracting the offset at that future moment
  const future = new Date(targetLocalMs - off * 60000);
  return future;
}

async function upsertSettings(guildId, patch) {
  const cols = Object.keys(patch);
  const vals = Object.values(patch);
  if (cols.length === 0) {
    // Insert defaults row if none exists
    await clientDB.query(
      `INSERT INTO study_tips (guild_id) VALUES ($1)
         ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );
    return;
  }
  const setSql = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
  await clientDB.query(
    `INSERT INTO study_tips (guild_id, ${cols.join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (guild_id) DO UPDATE SET ${setSql}`,
    [guildId, ...vals]
  );
}

async function readSettings(guildId) {
  await ensureTable();
  const r = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [guildId])).rows[0];
  if (r) return r;
  // Insert defaults if absent
  await upsertSettings(guildId, {});
  return (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [guildId])).rows[0];
}

function nextFrequency(current) {
  // more often → shorter interval (move RIGHT in [14,7,3,1])
  const idx = FREQUENCIES.indexOf(current);
  return idx >= 0 && idx < FREQUENCIES.length - 1 ? FREQUENCIES[idx + 1] : current;
}
function prevFrequency(current) {
  // less often → longer interval (move LEFT)
  const idx = FREQUENCIES.indexOf(current);
  return idx > 0 ? FREQUENCIES[idx - 1] : current;
}

function panelComponents(enabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('study-enable').setStyle(ButtonStyle.Success).setLabel('Enable').setDisabled(enabled),
    new ButtonBuilder().setCustomId('study-disable').setStyle(ButtonStyle.Danger).setLabel('Disable').setDisabled(!enabled),
    new ButtonBuilder().setCustomId('study-more-often').setStyle(ButtonStyle.Primary).setLabel('More often'),
    new ButtonBuilder().setCustomId('study-less-often').setStyle(ButtonStyle.Secondary).setLabel('Less often'),
    new ButtonBuilder().setCustomId('study-set-time').setStyle(ButtonStyle.Secondary).setLabel('Set time')
  );
}

async function ensureSettingsPanel(interaction, settings) {
  // Use or create a "study-tip-settings" channel visible to Staff + bot
  let ch = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'study-tip-settings');
  if (!ch) {
    const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Staff');
    const docsCat = getChannelByKey(interaction.guild, 'category_docs', ChannelType.GuildCategory);
    ch = await interaction.guild.channels.create({
      name: 'study-tip-settings',
      type: ChannelType.GuildText,
      parent: docsCat?.id,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...(staffRole ? [{ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : [])
      ]
    });
  }
  const msg = panelText(settings);

  const panel = await ch.send({ content: msg, components: [panelComponents(!!settings.enabled)] });
  try { await panel.pin(); } catch (_) {}
  await upsertSettings(interaction.guildId, { settings_channel_id: ch.id });
  return ch;
}

// Ensure a staff-only #study-tip-settings channel exists with a pinned panel.
// Can be called without a command context (e.g., from /setup).
async function ensureSettingsForGuild(guild) {
  await ensureTable();
  const gid = guild.id;
  let st = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [gid])).rows[0];
  if (!st) {
    await upsertSettings(gid, {});
    st = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [gid])).rows[0];
  }
  let ch = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === 'study-tip-settings');
  if (!ch) {
    const staffRole = guild.roles.cache.find(r => r.name === 'Staff');
    const docsCat = getChannelByKey(guild, 'category_docs', ChannelType.GuildCategory);
    ch = await guild.channels.create({
      name: 'study-tip-settings',
      type: ChannelType.GuildText,
      parent: docsCat?.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...(staffRole ? [{ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : [])
      ]
    });
  }
  await upsertSettings(gid, { settings_channel_id: ch.id });

  // If no pinned config by the bot, post one
  const pins = await ch.messages.fetchPinned().catch(() => null);
  const hasPanel = pins && pins.find(m => m.author?.id === guild.client.user.id && /Study Tip Settings/i.test(m.content));
  if (!hasPanel) {
    const sent = await ch.send({ content: panelText(st), components: [panelComponents(!!st.enabled)] });
    try { await sent.pin(); } catch (_) {}
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('study_tips')
    .setDescription('Configure scheduled study-time reminders (staff only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('enable').setDescription('Enable study tips'))
    .addSubcommand(s => s.setName('disable').setDescription('Disable study tips'))
    .addSubcommand(s => s.setName('status').setDescription('Show current settings'))
    .addSubcommand(s =>
      s.setName('set_time')
       .setDescription('Set the daily time and timezone')
       .addStringOption(o => o.setName('time').setDescription('HH:MM in 24h (e.g., 12:00)').setRequired(true))
       .addStringOption(o => o.setName('timezone').setDescription('IANA TZ (e.g., Europe/London)').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('set_frequency')
       .setDescription('Set frequency to 14, 7, 3 or 1 day(s)')
       .addIntegerOption(o => o.setName('days').setDescription('1, 3, 7, or 14').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('set_ai')
       .setDescription('Enable or disable AI-generated tips')
       .addStringOption(o => o.setName('mode').setDescription('on or off').setRequired(true).addChoices({name:'on', value:'on'}, {name:'off', value:'off'}))
    )
    .addSubcommand(s =>
      s.setName('set_target')
       .setDescription('Choose the channel to receive tips')
       .addChannelOption(o => o.setName('channel').setDescription('Target text channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand(s => s.setName('open_panel').setDescription('Post a settings panel with buttons (in a staff-only channel)')),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '⛔ Run this inside a server.', ephemeral: true });
    }
    await ensureTable();
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    let settings = await readSettings(gid);

    switch (sub) {
      case 'enable': {
        const t = parseHHMM(settings.time_of_day) || { hour: 12, minute: 0 };
        const next = computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: settings.timezone || 'UTC' });
        await upsertSettings(gid, { enabled: true, next_send_at: next });
        return interaction.reply({ content: `✅ Study tips enabled. Next send: <t:${Math.floor(next.getTime()/1000)}:F>`, ephemeral: true });
      }
      case 'disable': {
        await upsertSettings(gid, { enabled: false });
        return interaction.reply({ content: '✅ Study tips disabled.', ephemeral: true });
      }
      case 'status': {
        settings = await readSettings(gid);
        const next = settings.next_send_at ? `<t:${Math.floor(new Date(settings.next_send_at).getTime()/1000)}:F>` : 'TBA';
        return interaction.reply({ content:
          `Status: ${settings.enabled ? 'Enabled' : 'Disabled'}\n` +
          `Frequency: ${settings.frequency_days} day(s)\n` +
          `Time: ${settings.time_of_day} ${settings.timezone}\n` +
          `Target: ${settings.target_channel_id ? '<#'+settings.target_channel_id+'>' : '#student-docs (default)'}\n` +
          `Next: ${next}`,
          ephemeral: true });
      }
      case 'set_time': {
        const timeStr = interaction.options.getString('time', true);
        const tz = interaction.options.getString('timezone') || settings.timezone || 'UTC';
        const t = parseHHMM(timeStr);
        if (!t) return interaction.reply({ content: '⛔ Invalid time. Use HH:MM (24h).', ephemeral: true });
        const next = computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: tz });
        await upsertSettings(gid, { time_of_day: timeStr, timezone: tz, next_send_at: next });
        return interaction.reply({ content: `✅ Time set to ${timeStr} ${tz}. Next: <t:${Math.floor(next.getTime()/1000)}:F>`, ephemeral: true });
      }
      case 'set_frequency': {
        const days = interaction.options.getInteger('days', true);
        if (!FREQUENCIES.includes(days)) {
          return interaction.reply({ content: '⛔ Days must be one of 14, 7, 3, 1.', ephemeral: true });
        }
        const t = parseHHMM(settings.time_of_day) || { hour: 12, minute: 0 };
        const next = computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: settings.timezone || 'UTC' });
        await upsertSettings(gid, { frequency_days: days, next_send_at: next });
        return interaction.reply({ content: `✅ Frequency set to every ${days === 1 ? 'day' : days + ' days'}.`, ephemeral: true });
      }
      case 'set_target': {
        const ch = interaction.options.getChannel('channel', true);
        await upsertSettings(gid, { target_channel_id: ch.id });
        return interaction.reply({ content: `✅ Tips will be posted in <#${ch.id}>.`, ephemeral: true });
      }
      case 'set_ai': {
        const mode = interaction.options.getString('mode', true);
        const ai = mode === 'on';
        if (ai) {
          // Require Premium entitlement at guild level (or whitelist)
          const entitled = (await premium.hasGuildEntitlement(gid)) || premium.isWhitelistedGuild(gid);
          if (!entitled) {
            const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
            return interaction.reply({ content: `🔒 Premium required to enable AI tips. ${link}`, ephemeral: true });
          }
        }
        await upsertSettings(gid, { ai_enabled: ai });
        // Try to update existing panel text
        try {
          const st = await readSettings(gid);
          const ch = st.settings_channel_id ? interaction.guild.channels.cache.get(st.settings_channel_id) : null;
          const pins = ch ? await ch.messages.fetchPinned() : null;
          const panel = pins?.find(m => m.author?.id === interaction.client.user.id && /Study Tip Settings/i.test(m.content));
          if (panel) {
            await panel.edit({ content: panelText(st), components: [panelComponents(!!st.enabled)] });
          }
        } catch (_) {}
        return interaction.reply({ content: `✅ AI tips ${ai ? 'enabled' : 'disabled'}.`, ephemeral: true });
      }
      case 'open_panel': {
        settings = await readSettings(gid);
        await ensureSettingsPanel(interaction, settings);
        return interaction.reply({ content: '✅ Posted a settings panel in #study-tip-settings.', ephemeral: true });
      }
    }
  },

  // Export helpers the bot loop can use
  _helpers: {
    ensureTable,
    ensureSettingsForGuild,
    computeNextUTC,
    parseHHMM,
    nextFrequency,
    prevFrequency,
    FREQUENCIES,
    panelComponents,
    panelText,
  }
};

// Build the canonical panel text from settings
function panelText(settings){
  const tz = settings.timezone || 'UTC';
  const time = settings.time_of_day || '12:00';
  const freq = settings.frequency_days || 7;
  const next = settings.next_send_at ? `<t:${Math.floor(new Date(settings.next_send_at).getTime()/1000)}:F>` : 'TBA';
  return (
    `Study Tip Settings\n\n` +
    `Status: ${settings.enabled ? 'Enabled' : 'Disabled'}\n` +
    `Next send (server time): ${next}\n\n` +
    `Tips are sent every ${freq === 1 ? 'day' : `${freq} days`} at ${time} ${tz}.`
  );
}
