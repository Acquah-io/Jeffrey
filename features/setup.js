// features/setup.js
const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Re-run Jeffrey setup: roles, docs, and queue channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '⛔ Manage Server is required to run setup.', ephemeral: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('run-setup-again').setStyle(ButtonStyle.Primary).setLabel('Run setup again')
    );
    return interaction.reply({
      content: 'Click to run setup now. This will (re)create documentation channels, student/staff queues, and pinned panels.',
      components: [row],
      ephemeral: true,
    });
  }
};

