const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listReminders } = require('../reminderManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('myreminders')
    .setDescription('Show your pending reminders'),
  async execute(interaction) {
    const reminders = await listReminders(interaction.user.id);
    if (!reminders.length) {
      return interaction.reply({ content: 'You have no pending reminders.', ephemeral: true });
    }
    const lines = reminders.map(r => `• [${r.id}] <t:${Math.floor(new Date(r.remind_at).getTime()/1000)}:f> – ${r.message}`).join('\n');
    const rows = reminders.slice(0,5).map(r => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reminder-done-${r.id}`).setLabel('Mark Done').setStyle(ButtonStyle.Success)
    ));
    await interaction.reply({ content: `**Your reminders**:\n${lines}`, components: rows, ephemeral: true });
  }
};
