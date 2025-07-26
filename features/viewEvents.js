const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('viewevents')
        .setDescription('See upcoming events organized by staff'),
    async execute(interaction) {
        // Retrieve upcoming events from your data source.
        // This could be a database, an API call, or a local array.
        // For now, let's use a placeholder array of events.

        const upcomingEvents = [
            {
                name: "Study Group: Math Finals",
                date: "2024-12-20",
                time: "3:00 PM",
                location: "Voice Channel #2",
                description: "Join us for a study session on upcoming math finals!"
            },
            {
                name: "Coding Workshop: Intro to Python",
                date: "2024-12-22",
                time: "6:00 PM",
                location: "Voice Channel #3",
                description: "Learn the basics of Python programming!"
            },
        ];

        if (upcomingEvents.length === 0) {
            return interaction.reply({
                content: "There are no upcoming events at the moment.",
                ephemeral: true,
            });
        }

        // Format the events into a user-friendly message
        const eventList = upcomingEvents.map((event) => {
            return `**${event.name}**\nDate: ${event.date}\nTime: ${event.time}\nLocation: ${event.location}\nDescription: ${event.description}\n`;
        }).join("\n");

        await interaction.reply({
            content: `🎉 **Upcoming Events** 🎉\n\n${eventList}`,
            ephemeral: true,
        });
    },
};
