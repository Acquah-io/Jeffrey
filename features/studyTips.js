const { SlashCommandBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'studyTipConfig.json');
const DEFAULT_CONFIG = { enabled: true, hour: 9, minute: 0, days: 1 };
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

function nextTriggerDate() {
  const now = new Date();
  let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), config.hour, config.minute, 0));
  while (next <= now) {
    next.setUTCDate(next.getUTCDate() + config.days);
  }
  return next;
}

const tips = [
  'Review new material within 24 hours to boost retention.',
  'Explain concepts aloud as if teaching someone else.',
  'Take short breaks every hour to stay focused.',
  'Practice recalling information without looking at your notes.',
  'Organise your study space to minimise distractions.'
];

async function sendTip(client) {
  const tip = tips[Math.floor(Math.random() * tips.length)];
  const msg = `\uD83D\uDCDA **Study Tip:** ${tip}`;
  for (const guild of client.guilds.cache.values()) {
    const studentRole = guild.roles.cache.find(r => r.name === 'Students');
    if (!studentRole) continue;
    let members;
    try {
      members = await guild.members.fetch();
    } catch (err) {
      console.warn('Failed to fetch members for', guild.name, err);
      continue;
    }
    for (const member of members.values()) {
      if (member.user.bot) continue;
      if (!member.roles.cache.has(studentRole.id)) continue;
      try {
        await member.send(msg);
      } catch (err) {
        console.warn(`Failed to DM ${member.user.tag}:`, err.message);
      }
    }
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
  scheduleNext(client);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('studytip')
    .setDescription('Manage daily study tips')
    .addSubcommand(sc => sc.setName('enable').setDescription('Enable daily tips'))
    .addSubcommand(sc => sc.setName('disable').setDescription('Disable daily tips'))
    .addSubcommand(sc => sc.setName('settime')
      .setDescription('Set time of day in UTC')
      .addIntegerOption(o => o.setName('hour').setDescription('0-23').setRequired(true))
      .addIntegerOption(o => o.setName('minute').setDescription('0-59').setRequired(true)))
    .addSubcommand(sc => sc.setName('frequency')
      .setDescription('Set days between tips')
      .addIntegerOption(o => o.setName('days').setDescription('Number of days').setRequired(true))),
  async execute(interaction) {
    const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Staff');
    if (!staffRole || !interaction.member.roles.cache.has(staffRole.id)) {
      return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
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
    // 'channel' subcommand removed – tips are now sent via DM
  },
  setupStudyTips
};
