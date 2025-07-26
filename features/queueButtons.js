const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Buttons for students
const studentButtons = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('join-student')
            .setLabel('Join Queue')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('leave-student')
            .setLabel('Leave Queue')
            .setStyle(ButtonStyle.Secondary),
        // new ButtonBuilder()
        //     .setCustomId('show')
        //     .setLabel('Show Queue')
        //     .setStyle(ButtonStyle.Success),
        // new ButtonBuilder()
        //     .setCustomId('position')
        //     .setLabel('View Position')
        //     .setStyle(ButtonStyle.Secondary),
    );

// Buttons for staff
const staffButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('queue-blacklist')   // opens selector; switch has a case for this
      .setLabel('Blacklist Users')
      .setStyle(ButtonStyle.Danger),
  
    new ButtonBuilder()
      .setCustomId('clear-queue')       // matches switch 'clear-queue'
      .setLabel('Clear Queue')
      .setStyle(ButtonStyle.Secondary),
  
    new ButtonBuilder()
      .setCustomId('shuffle-queue')     // matches switch 'shuffle-queue'
      .setLabel('Shuffle Queue')
      .setStyle(ButtonStyle.Primary)
  );

module.exports = { studentButtons, staffButtons };
