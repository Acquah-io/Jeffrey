const { SlashCommandBuilder } = require('@discordjs/builders');
const clientDB = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('viewevents')
        .setDescription('See upcoming events organized by staff'),
    async execute(interaction) {
        // Must be used in a guild to scope events
        const guildId = interaction.guildId;
        if (!guildId) {
            return interaction.reply({ content: '⛔ Please run this command inside a server.', ephemeral: true });
        }

        try {
            const { rows } = await clientDB.query(
                `SELECT name, description, location, start_at
                   FROM events
                  WHERE guild_id = $1
                    AND (start_at IS NULL OR start_at >= NOW())
                  ORDER BY start_at NULLS LAST, created_at DESC
                  LIMIT 10`,
                [guildId]
            );

            if (!rows.length) {
                return interaction.reply({
                    content: 'There are no upcoming events at the moment.',
                    ephemeral: true,
                });
            }

            const fmtTime = (ts) => ts ? `<t:${Math.floor(new Date(ts).getTime() / 1000)}:f>` : 'TBA';

            const eventList = rows.map((ev, i) => {
                const parts = [
                    `**${i + 1}. ${ev.name}**`,
                    `When: ${fmtTime(ev.start_at)}`,
                ];
                if (ev.location) parts.push(`Where: ${ev.location}`);
                if (ev.description) parts.push(`About: ${ev.description}`);
                return parts.join('\n');
            }).join('\n\n');

            await interaction.reply({
                content: `🎉 **Upcoming Events** 🎉\n\n${eventList}`,
                ephemeral: true,
            });
        } catch (err) {
            console.error('Failed to fetch events:', err);
            await interaction.reply({ content: '❌ Failed to fetch events.', ephemeral: true });
        }
    },
};
