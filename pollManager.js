const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const polls = new Map(); // messageId -> { question, options, votes: Map<userId, index> }

function buildResults(question, options, votes) {
  const counts = new Array(options.length).fill(0);
  for (const idx of votes.values()) {
    if (typeof idx === 'number' && counts[idx] !== undefined) counts[idx]++;
  }
  const lines = options.map((opt, i) => `${i + 1}. **${opt}** – ${counts[i]} vote${counts[i] === 1 ? '' : 's'}`);
  return new EmbedBuilder().setTitle(question).setDescription(lines.join('\n'));
}

async function setupPollChannel(channel) {
  try {
    const pinned = await channel.messages.fetchPinned();
    let msg = pinned.find(m => m.author.id === channel.client.user.id && m.components.some(row => row.components.some(c => c.customId === 'create-poll')));
    const embed = new EmbedBuilder()
      .setTitle('Poll Management')
      .setDescription('Staff can create polls for students. Click **Create Poll** to begin.');
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('create-poll').setLabel('Create Poll').setStyle(ButtonStyle.Success)
    );
    if (msg) {
      await msg.edit({ embeds: [embed], components: [buttonRow] });
    } else {
      msg = await channel.send({ embeds: [embed], components: [buttonRow] });
      await msg.pin();
    }
  } catch (err) {
    console.error(`Failed to set up polls channel ${channel.id}:`, err);
  }
}

async function handleCreatePollButton(interaction) {
  if (!interaction.member.roles.cache.some(r => r.name === 'Staff')) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }
  const modal = new ModalBuilder().setCustomId('create-poll-modal').setTitle('Create Poll');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('poll-question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('poll-opt1').setLabel('Option 1').setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('poll-opt2').setLabel('Option 2').setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('poll-opt3').setLabel('Option 3').setStyle(TextInputStyle.Short)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('poll-opt4').setLabel('Option 4').setStyle(TextInputStyle.Short)
    )
  );
  await interaction.showModal(modal);
}

async function handleCreatePollModal(interaction) {
  const question = interaction.fields.getTextInputValue('poll-question');
  const options = [];
  for (let i = 1; i <= 4; i++) {
    const val = interaction.fields.getTextInputValue(`poll-opt${i}`);
    if (val) options.push(val);
  }
  if (options.length < 2) {
    return interaction.reply({ content: 'Please provide at least two options.', ephemeral: true });
  }
  const poll = { question, options, votes: new Map() };
  const row = new ActionRowBuilder();
  options.forEach((opt, idx) => {
    row.addComponents(new ButtonBuilder().setCustomId(`vote-${idx}`).setLabel(opt).setStyle(ButtonStyle.Secondary));
  });
  const embed = buildResults(question, options, poll.votes);
  const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
  polls.set(msg.id, poll);
  await interaction.reply({ content: '✅ Poll created.', ephemeral: true });
}

async function handleVoteButton(interaction) {
  const index = parseInt(interaction.customId.split('-')[1], 10);
  const poll = polls.get(interaction.message.id);
  if (!poll) {
    return interaction.reply({ content: '⚠️ Poll not found or expired.', ephemeral: true });
  }
  poll.votes.set(interaction.user.id, index);
  const embed = buildResults(poll.question, poll.options, poll.votes);
  await interaction.message.edit({ embeds: [embed] });
  await interaction.reply({ content: 'Vote recorded!', ephemeral: true });
}

module.exports = { setupPollChannel, handleCreatePollButton, handleCreatePollModal, handleVoteButton };
