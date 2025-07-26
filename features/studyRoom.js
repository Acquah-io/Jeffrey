const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('studyroom')
    .setDescription('Create a temporary voice channel for students')
    .addIntegerOption(opt =>
      opt.setName('minutes')
        .setDescription('Duration before the room is deleted (default 60, max 180)')
        .setMinValue(5)
        .setMaxValue(180)
        .setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const member = interaction.member;

    // Find the Students role (case sensitive match as in other code)
    const studentRole = guild.roles.cache.find(r => r.name === 'Students');

    if (!studentRole || !member.roles.cache.has(studentRole.id)) {
      return interaction.reply({
        content: '❌ Only members with the Students role can use this command.',
        ephemeral: true,
      });
    }

    const minutes = interaction.options.getInteger('minutes') || 60;

    try {
      const channel = await guild.channels.create({
        name: `study-${member.user.username}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          studentRole ? {
            id: studentRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
            ],
          } : null,
          {
            id: interaction.client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
        ].filter(Boolean),
      });

      await interaction.reply({
        content: `✅ Created study room <#${channel.id}>. It will be deleted in ${minutes} minute(s).`,
        ephemeral: true,
      });

      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (err) {
          console.error('Failed to delete study room:', err);
        }
      }, minutes * 60 * 1000);
    } catch (err) {
      console.error('Failed to create study room:', err);
      await interaction.reply({
        content: '⛔ Failed to create the study room. Please check my permissions.',
        ephemeral: true,
      });
    }
  },
};
