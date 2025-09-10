// features/smartSearchCommand.js
// Top-level:   /smart_search
// Variants:    /smart_search who_asked …, last_mentioned …, etc. (last_message removed)
//
// UK English used throughout.

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('smart_search')
    .setDescription('Search past Discord chat history with smart queries')
    .setDMPermission(true)                      // Command enabled in DMs

    /* ---------- sub-commands ---------- */


    .addSubcommand(sub =>
      sub.setName('last_mentioned')
         .setDescription('When was “something” last mentioned?')
         .addStringOption(o =>
           o.setName('term')
            .setDescription('Keyword')
            .setRequired(true)))


    // Note: 'last_message' subcommand removed per requirements





    .addSubcommand(sub =>
      sub.setName('keyword_between')
         .setDescription('What did we say about a keyword between two dates?')
         .addStringOption(o =>
           o.setName('term')
            .setDescription('Keyword')
            .setRequired(true))
         .addStringOption(o =>
           o.setName('start')
            .setDescription('Start date (YYYY-MM-DD)')
            .setRequired(true))
         .addStringOption(o =>
           o.setName('end')
            .setDescription('End date (YYYY-MM-DD)')
            .setRequired(true)))

    .addSubcommand(sub =>
      sub.setName('channel_discussed_period')
         .setDescription('What was discussed in the general channel during a period?')
         .addStringOption(o =>
           o.setName('period')
            .setDescription('Relative period')
            .setRequired(true)
            .addChoices(
              { name: 'yesterday', value: 'yesterday' },
              { name: 'last week', value: 'last week' },
              { name: 'today', value: 'today' }
            )))
};
