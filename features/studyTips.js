const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  settingsChannelId: null,
};
let config = { ...DEFAULT_CONFIG };
const TIP_COUNT = 1;
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

function lastSundayOfMonth(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(1, 0, 0, 0); // 1:00 UTC
  return d;
}

function isUkDst(date) {
  const year = date.getUTCFullYear();
  const start = lastSundayOfMonth(year, 2); // March
  const end = lastSundayOfMonth(year, 9);   // October
  return date >= start && date < end;
}

function londonNoonUtc(year, month, day) {
  const dt = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (isUkDst(dt)) dt.setUTCMinutes(dt.getUTCMinutes() - 60);
  return dt;
}

function nextTriggerDate() {
  const now = new Date();
  let next = londonNoonUtc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  while (next <= now || next.getUTCDay() !== 0) {
    next = londonNoonUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate() + 1);
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
    const tips = await fetchTips(TIP_COUNT);
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
          await member.send(`\uD83D\uDCDA **Study Tip:**\n${msg}`);
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
  const desc = [
    `**Status:** ${config.enabled ? 'Enabled' : 'Disabled'}`,
    `**Next send (UTC):** ${next.toUTCString()}`,
    '',
    'Tips are sent every Sunday at 12:00 UK time.'
  ].join('\n');
  return new EmbedBuilder()
    .setTitle('Study Tip Settings')
    .setColor('#00b0ff')
    .setDescription(desc);
}

function buildComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('study-enable')
      .setLabel('Enable')
      .setStyle(ButtonStyle.Success)
      .setDisabled(config.enabled),
    new ButtonBuilder()
      .setCustomId('study-disable')
      .setLabel('Disable')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!config.enabled)
  );
  return [row];
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


module.exports = {
  setupStudyTips,
  ensureSettingsChannel,
  handleStudyTipButton,
};
