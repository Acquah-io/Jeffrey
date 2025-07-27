const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
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
    const numTips = Math.max(1, config.count || 1);
    const tips = await fetchTips(numTips);
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
          await member.send(`\uD83D\uDCDA **Study Tip${numTips > 1 ? 's' : ''}:**\n${msg}`);
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

function buildEmbed() {
  const next = nextTriggerDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const desc = [
    `**Status:** ${config.enabled ? 'Enabled' : 'Disabled'}`,
    `**Time (UTC):** ${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')}`,
    typeof config.dayOfWeek === 'number'
      ? `**Day:** ${dayNames[config.dayOfWeek]}`
      : `**Every:** ${config.days} day(s)`,
    `**Tips per send:** ${config.count}`,
    `**Next send:** ${next.toUTCString()}`
  ].join('\n');
  return new EmbedBuilder()
    .setTitle('Study Tip Settings')
    .setColor('#00b0ff')
    .setDescription(desc);
}

function buildComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(config.enabled ? 'study-disable' : 'study-enable')
      .setLabel(config.enabled ? 'Disable' : 'Enable')
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
  );

  const dayMenu = new StringSelectMenuBuilder()
    .setCustomId('study-day-select')
    .setPlaceholder('Select day of week (or None)')
    .addOptions(
      { label: 'None', value: 'none', default: config.dayOfWeek === null },
      { label: 'Sunday', value: '0', default: config.dayOfWeek === 0 },
      { label: 'Monday', value: '1', default: config.dayOfWeek === 1 },
      { label: 'Tuesday', value: '2', default: config.dayOfWeek === 2 },
      { label: 'Wednesday', value: '3', default: config.dayOfWeek === 3 },
      { label: 'Thursday', value: '4', default: config.dayOfWeek === 4 },
      { label: 'Friday', value: '5', default: config.dayOfWeek === 5 },
      { label: 'Saturday', value: '6', default: config.dayOfWeek === 6 }
    );

  const hourMenu = new StringSelectMenuBuilder()
    .setCustomId('study-hour-select')
    .setPlaceholder('Hour (UTC)')
    .addOptions(
      Array.from({ length: 24 }, (_, i) => ({
        label: String(i).padStart(2, '0'),
        value: String(i),
        default: config.hour === i,
      }))
    );

  const minuteMenu = new StringSelectMenuBuilder()
    .setCustomId('study-minute-select')
    .setPlaceholder('Minute')
    .addOptions(
      Array.from({ length: 12 }, (_, i) => i * 5).map((m) => ({
        label: String(m).padStart(2, '0'),
        value: String(m),
        default: config.minute === m,
      }))
    );

  const freqMenu = new StringSelectMenuBuilder()
    .setCustomId('study-freq-select')
    .setPlaceholder('Frequency (days)')
    .addOptions(
      Array.from({ length: 7 }, (_, i) => i + 1).map((d) => ({
        label: String(d),
        value: String(d),
        default: config.days === d,
      }))
    );

  const countMenu = new StringSelectMenuBuilder()
    .setCustomId('study-count-select')
    .setPlaceholder('Tips per send')
    .addOptions(
      Array.from({ length: 5 }, (_, i) => i + 1).map((c) => ({
        label: String(c),
        value: String(c),
        default: config.count === c,
      }))
    );

  const row2 = new ActionRowBuilder().addComponents(dayMenu);
  const row3 = new ActionRowBuilder().addComponents(hourMenu, minuteMenu);
  const row4 = new ActionRowBuilder().addComponents(freqMenu);
  const row5 = new ActionRowBuilder().addComponents(countMenu);
  return [row1, row2, row3, row4, row5];
}

async function postPanel(channel) {
  const embed = buildEmbed();
  const components = buildComponents();
  const pinned = await channel.messages.fetchPinned();
  let msg = pinned.find(m => m.embeds[0]?.title === 'Study Tip Settings');
  if (msg) {
    await msg.edit({ embeds: [embed], components });
  } else {
    msg = await (await channel.send({ embeds: [embed], components })).pin();
  }
}

async function refreshPanel(guild) {
  const ch = await ensureSettingsChannel(guild);
  if (ch) await postPanel(ch);
}

function setupStudyTips(client) {
  loadConfig();
  for (const [, guild] of client.guilds.cache) {
    refreshPanel(guild);
  }
  scheduleNext(client);
}

async function handleStudyTipButton(interaction) {
  if (!interaction.member.roles.cache.some(r => r.name === 'Staff')) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }
  switch (interaction.customId) {
    case 'study-enable':
      config.enabled = true;
      saveConfig();
      scheduleNext(interaction.client);
      await interaction.reply({ content: 'Study tips enabled.', ephemeral: true });
      break;
    case 'study-disable':
      config.enabled = false;
      saveConfig();
      if (timeout) clearTimeout(timeout);
      await interaction.reply({ content: 'Study tips disabled.', ephemeral: true });
      break;
    default:
      return;
  }
  await refreshPanel(interaction.guild);
}

async function handleStudyTipSelect(interaction) {
  if (!interaction.member.roles.cache.some(r => r.name === 'Staff')) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }
  const val = interaction.values[0];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let msg;
  switch (interaction.customId) {
    case 'study-day-select':
      config.dayOfWeek = val === 'none' ? null : parseInt(val, 10);
      msg = val === 'none'
        ? 'Tips will send based on frequency.'
        : `Study tips will send on ${dayNames[config.dayOfWeek]}.`;
      break;
    case 'study-hour-select':
      config.hour = parseInt(val, 10);
      msg = `Hour set to ${String(config.hour).padStart(2, '0')} UTC.`;
      break;
    case 'study-minute-select':
      config.minute = parseInt(val, 10);
      msg = `Minute set to ${String(config.minute).padStart(2, '0')}.`;
      break;
    case 'study-freq-select':
      config.days = parseInt(val, 10);
      msg = `Frequency set to every ${config.days} day(s).`;
      break;
    case 'study-count-select':
      config.count = parseInt(val, 10);
      msg = `Each reminder will contain ${config.count} tip(s).`;
      break;
    default:
      return;
  }
  saveConfig();
  scheduleNext(interaction.client);
  await interaction.reply({ content: msg, ephemeral: true });
  await refreshPanel(interaction.guild);
}

module.exports = {
  setupStudyTips,
  ensureSettingsChannel,
  handleStudyTipButton,
  handleStudyTipSelect,
};
