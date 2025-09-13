const { SlashCommandBuilder } = require('@discordjs/builders');
const { makeLoc } = require('../localization');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const clientDB = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createevent')
        .setDescription('Open the event creation modal')
        .setDescriptionLocalizations(makeLoc('Open the event creation modal')),
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

        const eventTimeInput = new TextInputBuilder()
            .setCustomId('eventTime')
            .setLabel('Event Time')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the event time (e.g., 15:00 or 3:00 PM)')
            .setRequired(false);

        const eventLocationInput = new TextInputBuilder()
            .setCustomId('eventLocation')
            .setLabel('Location')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Voice Channel #2 or Zoom link')
            .setRequired(false);

        const eventDescriptionInput = new TextInputBuilder()
            .setCustomId('eventDescription')
            .setLabel('Event Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter a brief description of the event')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(eventNameInput),
            new ActionRowBuilder().addComponents(eventDateInput),
            new ActionRowBuilder().addComponents(eventTimeInput),
            new ActionRowBuilder().addComponents(eventLocationInput),
            new ActionRowBuilder().addComponents(eventDescriptionInput)
        );

        await interaction.showModal(modal);
    },
    async handleModalSubmit(interaction) {
        if (interaction.customId !== 'createEventModal') return;

        const eventName = interaction.fields.getTextInputValue('eventName');
        const eventDate = interaction.fields.getTextInputValue('eventDate');
        const eventTime = interaction.fields.getTextInputValue('eventTime') || '';
        const eventLocation = interaction.fields.getTextInputValue('eventLocation') || '';
        const eventDescription = interaction.fields.getTextInputValue('eventDescription') || '';

        // Parse date/time into a single timestamp
        // Accepts YYYY-MM-DD and optional time (e.g., 15:00 or 3:00 PM)
        let startAt = null;
        if (eventDate) {
            const candidate = eventTime ? `${eventDate} ${eventTime}` : `${eventDate} 12:00`;
            const parsed = new Date(candidate);
            if (!isNaN(parsed)) {
                startAt = parsed;
            }
        }

        try {
            // Ensure events table exists
            await clientDB.query(`
                CREATE TABLE IF NOT EXISTS events (
                  id           BIGSERIAL PRIMARY KEY,
                  guild_id     TEXT NOT NULL,
                  name         TEXT NOT NULL,
                  description  TEXT,
                  location     TEXT,
                  start_at     TIMESTAMPTZ,
                  created_by   TEXT,
                  created_at   TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // Insert event
            await clientDB.query(
                `INSERT INTO events (guild_id, name, description, location, start_at, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [
                    interaction.guildId,
                    eventName,
                    eventDescription,
                    eventLocation,
                    startAt,
                    interaction.user?.tag || interaction.user?.id || 'unknown'
                ]
            );

            await interaction.reply({
                content:
                  `🎉 Event saved!\n` +
                  `**Name:** ${eventName}\n` +
                  `**Date:** ${eventDate}${eventTime ? ` ${eventTime}` : ''}\n` +
                  (eventLocation ? `**Location:** ${eventLocation}\n` : '') +
                  `**Description:** ${eventDescription || 'No description provided'}`,
                ephemeral: true,
            });
        } catch (err) {
            console.error('Failed to save event:', err);
            await interaction.reply({
                content: '❌ Failed to save the event. Please try again later.',
                ephemeral: true,
            });
        }
    },
};
