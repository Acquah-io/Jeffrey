const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

/**
 * Display a modal asking the user for poll details.
 * The modal uses the custom ID `create-poll`.
 */
async function handleCreatePollButton(interaction) {
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
    // 40060 = Interaction has already been acknowledged
    if (err.code !== 40060) {
      console.error('Failed to show poll modal:', err);
    }
    // Ignore 40060 so the client does not emit an unhandled error
  }
}

module.exports = { handleCreatePollButton };
