const { SlashCommandBuilder, ChannelType } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CONFIG_PATH = path.join(__dirname, '..', 'studyTipConfig.json');
const DEFAULT_CONFIG = {
  enabled: true,
  hour: 9,
  minute: 0,
  days: 1,
  count: 1,
  dayOfWeek: null,
  settingsChannelId: null,
};
let config = { ...DEFAULT_CONFIG };
let timeout = null;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    Object.assign(config, JSON.parse(raw));
  } catch (_) {
    saveConfig();
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function ensureSettingsChannel(guild) {
  try {
    let ch = config.settingsChannelId
      ? guild.channels.cache.get(config.settingsChannelId)
      : guild.channels.cache.find(
          c => c.name === 'study-tip-settings' && c.type === ChannelType.GuildText
        );
    const staffRole = guild.roles.cache.find(r => r.name === 'Staff');
    if (!ch) {
      ch = await guild.channels.create({
        name: 'study-tip-settings',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.id, deny: ['ViewChannel'] },
          { id: guild.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageMessages', 'ManageChannels'] },
          ...(staffRole ? [{ id: staffRole.id, allow: ['ViewChannel', 'SendMessages'] }] : [])
        ]
      });
    } else {
      if (staffRole && !ch.permissionOverwrites.cache.has(staffRole.id)) {
        await ch.permissionOverwrites.edit(staffRole, { ViewChannel: true, SendMessages: true });
      }
      if (!ch.permissionOverwrites.cache.has(guild.client.user.id)) {
        await ch.permissionOverwrites.edit(guild.client.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ManageMessages: true,
          ManageChannels: true,
        });
      }
    }
    if (config.settingsChannelId !== ch.id) {
      config.settingsChannelId = ch.id;
      saveConfig();
    }
    return ch;
  } catch (err) {
    console.error(`Failed to ensure study tip settings channel for ${guild.name}:`, err);
  }
}

function nextTriggerDate() {
  const now = new Date();
  let next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    config.hour,
    config.minute,
    0
  ));
  if (typeof config.dayOfWeek === 'number') {
    while (next.getUTCDay() !== config.dayOfWeek || next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  } else {
    while (next <= now) {
      next.setUTCDate(next.getUTCDate() + config.days);
    }
  }
  return next;
}

async function fetchTips(count) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          'You are an educational assistant who provides concise study tips.',
      },
      {
        role: 'user',
        content: `Give ${count} unique study tips. Number each tip.`,
      },
    ],
  });
  const lines = completion.choices[0].message.content
    .split('\n')
    .map((l) => l.replace(/^\d+[\).\-]\s*/, '').trim())
    .filter(Boolean);
  return lines.slice(0, count);
}

async function sendTip(client) {
  try {
    const tipCount = Math.max(1, config.count || 1);
    const tips = await fetchTips(tipCount);
    const msg = tips.map((t, i) => `${i + 1}. ${t}`).join('\n');

    for (const guild of client.guilds.cache.values()) {
      const studentRole = guild.roles.cache.find(r => r.name === 'Students');
      if (!studentRole) continue;
      let members;
      try {
        members = await guild.members.fetch();
      } catch (_) {
        continue;
      }
      const students = members.filter(m => m.roles.cache.has(studentRole.id) && !m.user.bot);
      for (const member of students.values()) {
        try {
          await member.send(`\uD83D\uDCDA **Study Tip${tipCount > 1 ? 's' : ''}:**\n${msg}`);
        } catch (err) {
          console.error('Failed to DM study tip to', member.user.tag, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to send study tip:', err);
  }
}

function scheduleNext(client) {
  if (timeout) clearTimeout(timeout);
  if (!config.enabled) return;
  const next = nextTriggerDate();
  const delay = next.getTime() - Date.now();
  timeout = setTimeout(async () => {
    await sendTip(client);
    scheduleNext(client);
  }, delay);
}

function setupStudyTips(client) {
  loadConfig();
  for (const [, guild] of client.guilds.cache) {
    ensureSettingsChannel(guild);
  }
  scheduleNext(client);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('studytip')
    .setDescription('Manage scheduled study tips')
    .addSubcommand(sc => sc.setName('enable').setDescription('Enable tips'))
    .addSubcommand(sc => sc.setName('disable').setDescription('Disable tips'))
    .addSubcommand(sc => sc.setName('settime')
      .setDescription('Set time of day in UTC')
      .addIntegerOption(o => o.setName('hour').setDescription('0-23').setRequired(true))
      .addIntegerOption(o => o.setName('minute').setDescription('0-59').setRequired(true)))
    .addSubcommand(sc => sc.setName('frequency')
      .setDescription('Set days between tips')
      .addIntegerOption(o => o.setName('days').setDescription('Number of days').setRequired(true)))
    .addSubcommand(sc => sc.setName('count')
      .setDescription('Number of tips per send')
      .addIntegerOption(o => o.setName('count').setDescription('1 or more').setRequired(true)))
    .addSubcommand(sc => sc.setName('day')
      .setDescription('Day of week (0=Sun)')
      .addIntegerOption(o => o.setName('day').setDescription('0-6').setRequired(true))),
  async execute(interaction) {
    const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Staff');
    if (!staffRole || !interaction.member.roles.cache.has(staffRole.id)) {
      return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
    }
    if (config.settingsChannelId && interaction.channelId !== config.settingsChannelId) {
      return interaction.reply({ content: '⛔ Use the study-tip-settings channel for this command.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'enable') {
      config.enabled = true;
      saveConfig();
      scheduleNext(interaction.client);
      return interaction.reply({ content: 'Study tips enabled.', ephemeral: true });
    }
    if (sub === 'disable') {
      config.enabled = false;
      saveConfig();
      if (timeout) clearTimeout(timeout);
      return interaction.reply({ content: 'Study tips disabled.', ephemeral: true });
    }
    if (sub === 'settime') {
      const h = interaction.options.getInteger('hour');
      const m = interaction.options.getInteger('minute');
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        return interaction.reply({ content: '⛔ Invalid time.', ephemeral: true });
      }
      config.hour = h;
      config.minute = m;
      saveConfig();
      scheduleNext(interaction.client);
      return interaction.reply({ content: `Time set to ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} UTC`, ephemeral: true });
    }
    if (sub === 'frequency') {
      const d = interaction.options.getInteger('days');
      if (d < 1) return interaction.reply({ content: '⛔ Days must be at least 1.', ephemeral: true });
      config.days = d;
      saveConfig();
      scheduleNext(interaction.client);
      return interaction.reply({ content: `Frequency set to every ${d} day(s).`, ephemeral: true });
    }
    if (sub === 'count') {
      const c = interaction.options.getInteger('count');
      if (c < 1) return interaction.reply({ content: '⛔ Count must be at least 1.', ephemeral: true });
      config.count = c;
      saveConfig();
      scheduleNext(interaction.client);
      return interaction.reply({ content: `Each reminder will contain ${c} tip(s).`, ephemeral: true });
    }
    if (sub === 'day') {
      const d = interaction.options.getInteger('day');
      if (d < 0 || d > 6) return interaction.reply({ content: '⛔ Day must be between 0 and 6.', ephemeral: true });
      config.dayOfWeek = d;
      saveConfig();
      scheduleNext(interaction.client);
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return interaction.reply({ content: `Study tips will send on ${dayNames[d]}.`, ephemeral: true });
    }
  },
  setupStudyTips,
  ensureSettingsChannel
};
