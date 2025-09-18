const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const summaries = require('../services/classSummaries');
const voiceSessions = require('../services/voiceSessions');

const BROADCAST_MAP = new Map(); // messageId -> { ownerId, sessionId, selected }

function ensureStaff(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('⛔ Manage Server permission required.');
  }
}

function buildSelectOptions(members, preselect = []) {
  return members.slice(0, 25).map(member => ({
    label: member.displayName || member.user.username,
    description: member.user.username,
    value: member.id,
    default: preselect.includes(member.id)
  }));
}

async function handleBroadcast(interaction) {
  ensureStaff(interaction);
  const sessionId = interaction.options.getInteger('session_id');
  let session;
  if (sessionId) {
    session = await summaries.getSession(sessionId);
  } else {
    session = await summaries.getLatestSessionForChannel(interaction.guildId, interaction.channelId);
    if (!session) {
      // fallback globally latest
      const list = await summaries.listSessions(interaction.guildId, { limit: 1 });
      session = list[0];
    }
  }
  if (!session) {
    throw new Error('No stored sessions found yet.');
  }
  if (!session.summary && !session.transcript) {
    throw new Error('This session does not have a summary or transcript yet.');
  }

  const defaultSummary = session.summary || (session.transcript ? session.transcript.slice(0, 300) + '…' : '');

  await interaction.guild.members.fetch();
  const studentRoleName = process.env.STUDENT_ROLE_NAME || 'Students';
  const candidates = interaction.guild.members.cache.filter(member => !member.user.bot && member.roles.cache.some(role => role.name.toLowerCase() === studentRoleName.toLowerCase()));
  if (!candidates.size) {
    throw new Error(`No members with the “${studentRoleName}” role were found.`);
  }

  const members = Array.from(candidates.values());
  const preselect = members.map(m => m.id).slice(0, 25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`class-summary-select:${interaction.user.id}:${session.id}`)
    .setPlaceholder('Choose recipients (max 25 shown)')
    .setMinValues(1)
    .setMaxValues(Math.min(25, members.length))
    .addOptions(buildSelectOptions(members, preselect));

  const sendBtn = new ButtonBuilder()
    .setCustomId(`class-summary-send:${interaction.user.id}:${session.id}`)
    .setLabel('Send summary')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    sendBtn,
    new ButtonBuilder()
      .setCustomId(`class-summary-cancel:${interaction.user.id}:${session.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  const content = `Summary ready to send for **${session.topic || 'Session #' + session.id}**\n\n${defaultSummary}`;
  await interaction.reply({
    content,
    components: [row, row2],
    ephemeral: true,
  });
  const reply = await interaction.fetchReply();
  BROADCAST_MAP.set(reply.id, {
    ownerId: interaction.user.id,
    sessionId: session.id,
    selected: preselect,
    memberIds: members.map(m => m.id),
    baseContent: content,
  });
  setTimeout(() => {
    const current = BROADCAST_MAP.get(reply.id);
    if (current && current.sessionId === session.id && current.ownerId === interaction.user.id) {
      BROADCAST_MAP.delete(reply.id);
    }
  }, 10 * 60 * 1000);
}

async function handleList(interaction) {
  ensureStaff(interaction);
  const sessions = await summaries.listSessions(interaction.guildId, { limit: 5 });
  if (!sessions.length) {
    await interaction.reply({ content: 'No sessions recorded yet.', ephemeral: true });
    return;
  }
  const lines = sessions.map(sess => {
    const when = sess.ended_at || sess.started_at;
    const summary = sess.summary ? sess.summary.split('\n').slice(0, 2).join(' ') : 'No summary yet';
    return `• **ID ${sess.id}** – ${sess.topic || 'Untitled'} – <t:${Math.floor(new Date(when).getTime() / 1000)}:f>\n  ${summary.slice(0, 140)}${summary.length > 140 ? '…' : ''}`;
  });
  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true,
  });
}

async function execute(interaction) {
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'broadcast') {
      await handleBroadcast(interaction);
    } else if (sub === 'list') {
      await handleList(interaction);
    } else if (sub === 'stop') {
      const active = voiceSessions.getActiveSession(interaction.guildId);
      if (!active) {
        await interaction.reply({ content: 'No active voice session.', ephemeral: true });
        return;
      }
      await voiceSessions.stopSession(interaction.guild, { endedBy: interaction.user.id, reason: 'manual-stop' });
      await interaction.reply({ content: 'Recording stopped and summary processing has begun.', ephemeral: true });
    } else if (sub === 'start') {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isVoiceBased()) {
        await interaction.reply({ content: 'Please select a voice channel.', ephemeral: true });
        return;
      }
      await voiceSessions.startSession(channel, {
        topic: interaction.options.getString('topic'),
        initiatedBy: interaction.user.id,
      });
      await interaction.reply({ content: `Started session in ${channel.toString()}.`, ephemeral: true });
    }
  } catch (err) {
    console.error('classSession execute error:', err);
    const msg = typeof err === 'string' ? err : err.message || 'Unexpected error.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg });
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}

async function handleComponent(interaction) {
  const [prefix, ownerId, sessionId] = interaction.customId.split(':');
  if (ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the staff member who opened this menu can use it.', ephemeral: true });
    return;
  }

  const entry = BROADCAST_MAP.get(interaction.message.id);
  if (!entry) {
    await interaction.reply({ content: 'This broadcast menu has expired.', ephemeral: true });
    return;
  }

  if (prefix === 'class-summary-select') {
    entry.selected = interaction.values;
    BROADCAST_MAP.set(interaction.message.id, entry);
    const newContent = `${entry.baseContent}\n\nRecipients selected: ${entry.selected.length}`;
    await interaction.update({ content: newContent, components: interaction.message.components });
    return;
  }

  if (prefix === 'class-summary-cancel') {
    BROADCAST_MAP.delete(interaction.message.id);
    await interaction.update({ content: 'Broadcast cancelled.', components: [] });
    return;
  }

  if (prefix === 'class-summary-send') {
    const session = await summaries.getSession(Number(sessionId));
    if (!session) {
      await interaction.reply({ content: 'Session not found.', ephemeral: true });
      return;
    }
    const recipients = entry.selected && entry.selected.length ? entry.selected : entry.memberIds;
    const summary = session.summary || session.transcript || 'No summary content available yet.';
    const failures = [];
    for (const userId of recipients) {
      try {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        await member.send({
          content: `**${session.topic || 'Class Summary'}**\n\n${summary}`,
        });
        await summaries.recordDelivery({ sessionId: session.id, userId, deliveredBy: interaction.user.id });
      } catch (err) {
        console.warn('Failed to DM summary to', userId, err);
        failures.push(userId);
      }
    }

    await summaries.updateSession(session.id, { last_broadcast: new Date() });
    BROADCAST_MAP.delete(interaction.message.id);
    await interaction.update({
      content: failures.length
        ? `Summary sent, but ${failures.length} user(s) could not be reached.`
        : 'Summary sent successfully.',
      components: [],
    });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('class_session')
    .setDescription('Manage Geoffrey voice class sessions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Manually start recording a voice channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to join').setRequired(true))
        .addStringOption(opt => opt.setName('topic').setDescription('Topic for this class session'))
    )
    .addSubcommand(sub =>
      sub.setName('stop')
        .setDescription('Stop the active recording session')
    )
    .addSubcommand(sub =>
      sub.setName('broadcast')
        .setDescription('Broadcast the latest summary to students')
        .addIntegerOption(opt => opt.setName('session_id').setDescription('Specific session ID to broadcast'))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List recent recorded sessions')
    ),
  execute,
  handleComponent,
};
