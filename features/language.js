const { SlashCommandBuilder } = require('@discordjs/builders');
const { makeLoc, ALL_LOCALES } = require('../localization');
const { PermissionFlagsBits } = require('discord.js');

const SUPPORTED = [
  { name: 'English (US)', value: 'en-US' },
  { name: 'English (GB)', value: 'en-GB' },
  { name: 'Bulgarian', value: 'bg' },
  { name: 'Chinese (Simplified)', value: 'zh-CN' },
  { name: 'Chinese (Traditional)', value: 'zh-TW' },
  { name: 'Croatian', value: 'hr' },
  { name: 'Czech', value: 'cs' },
  { name: 'Danish', value: 'da' },
  { name: 'Dutch', value: 'nl' },
  { name: 'Finnish', value: 'fi' },
  { name: 'French', value: 'fr' },
  { name: 'German', value: 'de' },
  { name: 'Greek', value: 'el' },
  { name: 'Hindi', value: 'hi' },
  { name: 'Hungarian', value: 'hu' },
  { name: 'Indonesian', value: 'id' },
  { name: 'Italian', value: 'it' },
  { name: 'Japanese', value: 'ja' },
  { name: 'Korean', value: 'ko' },
  { name: 'Lithuanian', value: 'lt' },
  { name: 'Norwegian', value: 'no' },
  { name: 'Polish', value: 'pl' },
  { name: 'Portuguese (Brazil)', value: 'pt-BR' },
  { name: 'Romanian', value: 'ro' },
  { name: 'Russian', value: 'ru' },
  { name: 'Spanish (Spain)', value: 'es-ES' },
  { name: 'Spanish (LATAM)', value: 'es-419' },
  { name: 'Swedish', value: 'sv-SE' },
  { name: 'Thai', value: 'th' },
  { name: 'Turkish', value: 'tr' },
  { name: 'Ukrainian', value: 'uk' },
  { name: 'Vietnamese', value: 'vi' }
  // Add more here (and in locales/)
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Set your or the server language')
    .setDescriptionLocalizations(makeLoc('Set your or the server language'))
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
       .addChoices(
         { name: 'English (US)', value: 'en-US' },
         { name: 'English (GB)', value: 'en-GB' },
         { name: 'Español (España)', value: 'es-ES' },
         { name: 'Español (LATAM)', value: 'es-419' },
         { name: 'Français', value: 'fr' },
         { name: 'Deutsch', value: 'de' },
         { name: 'Português (Brasil)', value: 'pt-BR' },
         { name: 'Italiano', value: 'it' },
         { name: '日本語', value: 'ja' },
         { name: '한국어', value: 'ko' },
         { name: '中文（简体）', value: 'zh-CN' },
         { name: '中文（繁體）', value: 'zh-TW' },
         { name: 'Русский', value: 'ru' },
         { name: 'Polski', value: 'pl' },
         { name: 'Türkçe', value: 'tr' },
         { name: 'Nederlands', value: 'nl' },
         { name: 'Svenska', value: 'sv-SE' },
         { name: 'Norsk', value: 'no' },
         { name: 'Dansk', value: 'da' },
         { name: 'Suomi', value: 'fi' },
         { name: 'Bahasa Indonesia', value: 'id' },
         { name: 'ไทย', value: 'th' },
         { name: 'Tiếng Việt', value: 'vi' },
         { name: 'Română', value: 'ro' },
         { name: 'Українська', value: 'uk' }
       )
    ),

  async execute(interaction) {
    // Lazy-load heavy modules to avoid side-effects during deploy script
    const clientDB = require('../database');
    const { t, preferredLocale, getGuildLocale } = require('../i18n');
    const queueManager = require('../queueManager');
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

// Export supported locales for autocomplete
module.exports.SUPPORTED_LOCALES = SUPPORTED;
