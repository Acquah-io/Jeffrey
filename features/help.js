// features/help.js
// Context-aware /help command
// Shows either staff-only or student-only instructions based on the caller’s roles.
// UK English throughout.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { makeLoc } = require('../localization');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display context-aware help documentation')
    .setDescriptionLocalizations(makeLoc('Display context-aware help documentation'))
    .setDMPermission(true),

  async execute(interaction) {
    // Detect whether we’re in a guild or a DM
    if (!interaction.guild) {
      // DM context – send a generic help message
      const dmEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Jeffrey Bot Help')
        .setDescription('Here’s a quick reference you can use in any chat with Jeffrey.')
        .addFields(
          { name: '/smart_search', value: 'Search server chat history with natural‑language queries.' },
          { name: '/help',        value: 'Display this help message.' },
        )
        .setFooter({ text: 'Tip: run commands inside a server for role‑specific guidance.' });

      return interaction.reply({ embeds: [dmEmbed], ephemeral: true });
    }

    // Guild context
    const member = interaction.member;

    // Detect roles (case-insensitive)
    const isStaff   = member.roles.cache.some(r => r.name.toLowerCase() === 'staff');
    const isStudent = member.roles.cache.some(r => r.name.toLowerCase() === 'students');

    if (isStaff) {
      const staffEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('Jeffrey Bot Help · Staff')
        .setDescription('Commands available to staff members')
        .addFields(
          { name: '/setup',       value: 'Re-run setup: roles, docs and queue channels.' },
          { name: '/language',    value: 'Set the server language (use scope: Server).' },
          { name: '/createevent', value: 'Create a new event for the server.' },
        )
        .setFooter({ text: 'For further assistance, contact the server admin.' });

      return interaction.reply({ embeds: [staffEmbed], ephemeral: true });
    }

    if (isStudent) {
      const studentEmbed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('Jeffrey Bot Help · Students')
        .setDescription('Commands available to students')
        .addFields(
          { name: '/viewevents',  value: 'View upcoming events on the server.' },
          { name: '/language',    value: 'Change your personal language (use scope: Me).' },
        )
        .setFooter({ text: 'For further assistance, contact a staff member.' });

      return interaction.reply({ embeds: [studentEmbed], ephemeral: true });
    }

    // Fallback for users with neither role
    return interaction.reply({
      content: '❌ You don’t appear to have the Staff or Students role.',
      ephemeral: true,
    });
  },
};
