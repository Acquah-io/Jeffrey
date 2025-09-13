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
          { name: 'Sub‑commands', value: '• last_mentioned term:<keyword> — who last said it and when\n• keyword_between term:<keyword> start:<YYYY‑MM‑DD> end:<YYYY‑MM‑DD>\n• channel_discussed_period period:<yesterday|last week|today>' },
          { name: '/help',        value: 'Display this help message.' }
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
        .setDescription('Slash commands available to staff members')
        .addFields(
          { name: '/setup',       value: 'Re-run setup: roles, docs and queue channels. Use after changing permissions or roles.' },
          { name: '/createevent', value: 'Open a modal to publish a staff event (name, date/time, location, description).' },
          { name: '/viewevents',  value: 'Show upcoming events for this server (ephemeral).' },
          { name: '/study_tips',  value: 'Configure study reminders. Sub‑commands:\n• enable / disable\n• set_time time:<HH:MM> timezone:<IANA tz>\n• set_frequency days:<14|7|3|1> (two‑weeks → daily)\n• set_target channel:<#channel>\n• open_panel — post a settings panel with buttons' },
          { name: 'AI tips (Premium 🔒)', value: 'Enable with /study_tips set_ai mode:on — generates a unique short tip per reminder (uses OpenAI). Requires server Premium. Disable with /study_tips set_ai mode:off.' },
          { name: '/smart_search', value: 'Search past messages. Sub‑commands:\n• last_mentioned term:<keyword> — last mention with author and timestamp\n• keyword_between term:<keyword> start:<YYYY‑MM‑DD> end:<YYYY‑MM‑DD> — summary and examples\n• channel_discussed_period period:<yesterday|last week|today> — activity in #general' }
        )
        .setFooter({ text: 'For further assistance, contact the server admin.' });

      return interaction.reply({ embeds: [staffEmbed], ephemeral: true });
    }

    if (isStudent) {
      const studentEmbed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle('Jeffrey Bot Help · Students')
        .setDescription('Slash commands available to students')
        .addFields(
          { name: '/viewevents',  value: 'View upcoming events on the server (ephemeral).' },
          { name: '/smart_search', value: 'Search past messages. Sub‑commands:\n• last_mentioned term:<keyword>\n• keyword_between term:<keyword> start:<YYYY‑MM‑DD> end:<YYYY‑MM‑DD>\n• channel_discussed_period period:<yesterday|last week|today>' }
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
