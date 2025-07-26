const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createevent')
        .setDescription('Open the event creation modal'),
    async execute(interaction) {
        // Check if the user has the "Staff" role
        const staffRole = interaction.guild.roles.cache.find(role => role.name === 'Staff');

        if (!staffRole || !interaction.member.roles.cache.has(staffRole.id)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command. Only members with the "Staff" role can create events.',
                ephemeral: true,
            });
        }

        // If user has the "Staff" role, proceed to show the modal
        const modal = new ModalBuilder()
            .setCustomId('createEventModal')
            .setTitle('Create a New Event');

        const eventNameInput = new TextInputBuilder()
            .setCustomId('eventName')
            .setLabel('Event Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the event name')
            .setRequired(true);

        const eventDateInput = new TextInputBuilder()
            .setCustomId('eventDate')
            .setLabel('Event Date')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the event date (e.g., YYYY-MM-DD)')
            .setRequired(true);

        const eventDescriptionInput = new TextInputBuilder()
            .setCustomId('eventDescription')
            .setLabel('Event Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter a brief description of the event')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(eventNameInput),
            new ActionRowBuilder().addComponents(eventDateInput),
            new ActionRowBuilder().addComponents(eventDescriptionInput)
        );

        await interaction.showModal(modal);
    },
    async handleModalSubmit(interaction) {
        if (interaction.customId !== 'createEventModal') return;

        const eventName = interaction.fields.getTextInputValue('eventName');
        const eventDate = interaction.fields.getTextInputValue('eventDate');
        const eventDescription = interaction.fields.getTextInputValue('eventDescription');

        await interaction.reply({
            content: `🎉 Event Created:\n**Name:** ${eventName}\n**Date:** ${eventDate}\n**Description:** ${eventDescription || 'No description provided'}`,
            ephemeral: true,
        });
    },
};
