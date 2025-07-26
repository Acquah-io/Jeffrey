const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

/**
 * Display a modal asking the user for poll details.
 * The modal uses the custom ID `create-poll`.
 */
async function handleCreatePollButton(interaction) {
  // Guard against Discord's 3s interaction timeout – if we're close, tell the user to click again
  try {
    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2500) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⏱️ That took a bit too long. Please click **Create Poll** again.', flags: 64 });
      }
      return;
    }
  } catch (_) {}

  const modal = new ModalBuilder()
    .setCustomId('create-poll')
    .setTitle('Create Poll');

  const question = new TextInputBuilder()
    .setCustomId('poll-question')
    .setLabel('Poll question')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const options = new TextInputBuilder()
    .setCustomId('poll-options')
    .setLabel('Options (comma separated)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(question),
    new ActionRowBuilder().addComponents(options)
  );

  try {
    await interaction.showModal(modal);
  } catch (err) {
    // 40060 = double‑ack, 10062 = interaction token expired/invalid
    if (err.code === 10062) {
      console.warn('Create‑poll interaction expired before showModal could run. Ask user to click again.');
      try {
        // We cannot reply to the interaction anymore; keep it quiet for users.
        // Optionally, you could notify the user via a follow‑up channel message.
      } catch (_) {}
      return;
    }
    if (err.code !== 40060) {
      console.error('Failed to show poll modal:', err);
    }
    // Ignore 40060 so the client does not emit an unhandled error
  }
}


async function handleCreatePollSubmit(interaction) {
  try {
    const question = interaction.fields.getTextInputValue('poll-question').trim();
    let options = interaction.fields
      .getTextInputValue('poll-options')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Basic validation
    if (!question) {
      return interaction.reply({ content: '⛔ The poll must have a question.', flags: 64 });
    }
    if (options.length < 2) {
      return interaction.reply({ content: '⛔ Please provide at least two options, separated by commas.', flags: 64 });
    }

    // Discord reactions reliably support up to 10 number emojis
    if (options.length > 10) options = options.slice(0, 10);

    const numberEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

    const lines = options.map((opt, i) => `${numberEmojis[i]} ${opt}`);
    const content = `**${question}**\n\n${lines.join('\n')}`;

    // Post the poll in the same channel
    const pollMessage = await interaction.channel.send({ content });

    // Add the numbered reactions so users can vote
    for (let i = 0; i < options.length; i++) {
      try { await pollMessage.react(numberEmojis[i]); } catch (_) {}
    }

    // Acknowledge the submitter ephemerally
    await interaction.reply({ content: `✅ Poll posted in <#${interaction.channel.id}>.`, flags: 64 });
  } catch (err) {
    console.error('Failed to handle create-poll modal submit:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Sorry, something went wrong creating the poll.', flags: 64 });
      }
    } catch (_) {}
  }
}

module.exports = { handleCreatePollButton, handleCreatePollSubmit };
