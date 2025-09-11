const { SlashCommandBuilder } = require('@discordjs/builders');
const clientDB = require('../database');
const { PermissionFlagsBits } = require('discord.js');
const { t, preferredLocale, getGuildLocale } = require('../i18n');
const queueManager = require('../queueManager');

const SUPPORTED = [
  { name: 'English (US)', value: 'en-US' },
  { name: 'Español (ES)', value: 'es-ES' }
  // Add more here (and in locales/)
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Set your or the server language')
    .addStringOption(o =>
      o.setName('scope')
       .setDescription('Apply to yourself or the server')
       .setRequired(true)
       .addChoices(
         { name: 'Me', value: 'me' },
         { name: 'Server', value: 'server' }
       ))
    .addStringOption(o =>
      o.setName('locale')
       .setDescription('Choose a language')
       .setRequired(true)
       .addChoices(...SUPPORTED)
    ),

  async execute(interaction) {
    const scope = interaction.options.getString('scope');
    const locale = interaction.options.getString('locale');

    if (scope === 'server') {
      if (!interaction.guild) {
        return interaction.reply({ content: '⛔ Run this inside a server.', ephemeral: true });
      }
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const msg = t(interaction.locale || 'en-US', 'language.need_manage_guild');
        return interaction.reply({ content: msg, ephemeral: true });
      }
      await clientDB.query(
        `INSERT INTO guild_settings (guild_id, locale)
           VALUES ($1,$2)
           ON CONFLICT (guild_id) DO UPDATE SET locale = EXCLUDED.locale`,
        [interaction.guildId, locale]
      );

      // Refresh docs + queue panels in new language
      try {
        const bot = interaction.client;
        // Update docs
        const { t: tx } = require('../i18n');
        const staffText = tx(locale, 'docs.staff');
        const studentText = tx(locale, 'docs.student');
        const { ChannelType } = require('discord.js');
        const guild = interaction.guild;
        // Update pinned docs using bot.js helper if exported, else minimally re-send
        const staffChannel = guild.channels.cache.find(ch => ch.name === 'staff-docs' && ch.type === ChannelType.GuildText);
        const studentChannel = guild.channels.cache.find(ch => ch.name === 'student-docs' && ch.type === ChannelType.GuildText);
        if (staffChannel) {
          const pinned = await staffChannel.messages.fetchPinned();
          const existing = pinned.find(m => m.content?.startsWith('**'));
          if (existing) await existing.edit(staffText); else await (await staffChannel.send(staffText)).pin();
        }
        if (studentChannel) {
          const pinned = await studentChannel.messages.fetchPinned();
          const existing = pinned.find(m => m.content?.startsWith('**'));
          if (existing) await existing.edit(studentText); else await (await studentChannel.send(studentText)).pin();
        }
        // Refresh panels
        const studentQueues = guild.channels.cache.find(ch => ch.name === 'student-queues');
        const staffQueues = guild.channels.cache.find(ch => ch.name === 'staff-queues');
        if (studentQueues) await queueManager.setupStudentQueueChannel(studentQueues);
        if (staffQueues) await queueManager.setupStaffQueueChannel(staffQueues);
      } catch (e) { /* non-fatal */ }

      const msg = t(locale, 'language.set_ok_guild', { locale });
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // scope === 'me'
    await clientDB.query(
      `INSERT INTO user_settings (user_id, locale)
         VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET locale = EXCLUDED.locale`,
      [interaction.user.id, locale]
    );
    const msg = t(locale, 'language.set_ok_user', { locale });
    return interaction.reply({ content: msg, ephemeral: true });
  }
};

