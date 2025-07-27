const { SlashCommandBuilder } = require('@discordjs/builders');
const chrono = require('chrono-node');
const { addReminder } = require('../reminderManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Schedule a private reminder')
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('When to remind you (e.g. "in 10 minutes")')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Reminder text')
        .setRequired(true)),
  async execute(interaction) {
    const timeStr = interaction.options.getString('time');
    const text    = interaction.options.getString('message');
    const parsed  = chrono.parse(timeStr)[0];
    if (!parsed) {
      return interaction.reply({
        content: '❗ I couldn\'t understand the time. Try "in 10 minutes" or "tomorrow 9am".',
        ephemeral: true
      });
    }
    const remindAt = parsed.start.date();
    await addReminder(interaction.user.id, interaction.guildId ?? null, text, remindAt);
    await interaction.reply({
      content: `✅ Reminder set for <t:${Math.floor(remindAt.getTime()/1000)}:f>. I\'ll DM you then.`,
      ephemeral: true
    });
  }
};
