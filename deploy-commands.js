const { REST, Routes } = require('discord.js');
require('dotenv').config();

const { ACCESS_TOKEN_DISCORD, CLIENT_ID, GUILD_ID } = process.env;

// If GUILD_ID is provided, register commands to that guild for instant refresh.
// Otherwise, register globally (may take up to 1 hour to propagate).
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

const scopeLabel = GUILD_ID ? `guild ${GUILD_ID}` : 'global scope';

const commands = [
    {
        name: 'createevent',
        description: 'Open a modal to create an event',
    },
    {
        name: 'viewevents',
        description: 'See upcoming events organized by staff',
    },
    // Add other commands as needed
    {
        name: 'history',
        description: 'Query past Discord chat history',
        options: [
            {
                name: 'who_asked',
                description: 'Who asked about "something" in the chat?',
                type: 1, // SUB_COMMAND
                options: [
                    { name: 'term', description: 'Keyword', type: 3, required: true }
                ]
            },
            {
                name: 'last_mentioned',
                description: 'When was "something" last mentioned?',
                type: 1,
                options: [
                    { name: 'term', description: 'Keyword', type: 3, required: true }
                ]
            },
            {
                name: 'who_said',
                description: 'Who said "something" in the chat?',
                type: 1,
                options: [
                    { name: 'term', description: 'Keyword', type: 3, required: true }
                ]
            },
            {
                name: 'last_message',
                description: 'What was the last message in the chat?',
                type: 1
            },
            {
                name: 'mentioned_period',
                description: 'What was mentioned yesterday / last week / last Friday?',
                type: 1,
                options: [
                    {
                        name: 'period',
                        description: 'Relative period',
                        type: 3,
                        required: true,
                        choices: [
                            { name: 'yesterday',   value: 'yesterday' },
                            { name: 'last week',   value: 'last week' },
                            { name: 'last Friday', value: 'last Friday' }
                        ]
                    }
                ]
            },
            {
                name: 'user_said_on',
                description: 'What did @User say on a given date?',
                type: 1,
                options: [
                    { name: 'user', description: 'User', type: 6, required: true },
                    { name: 'date', description: 'Date (YYYY-MM-DD)', type: 3, required: true }
                ]
            },
            {
                name: 'talk_channel_on',
                description: 'What did we talk about in #channel on a day?',
                type: 1,
                options: [
                    { name: 'channel', description: 'Channel', type: 7, required: true },
                    { name: 'day', description: 'Relative day (e.g. "last Friday")', type: 3, required: true }
                ]
            },
            {
                name: 'user_message_count',
                description: 'How many messages has @User sent in the last N hours/days?',
                type: 1,
                options: [
                    { name: 'user', description: 'User', type: 6, required: true },
                    { name: 'amount', description: 'Number', type: 4, required: true },
                    {
                        name: 'unit',
                        description: 'hours or days',
                        type: 3,
                        required: true,
                        choices: [
                            { name: 'hours', value: 'hours' },
                            { name: 'days',  value: 'days'  }
                        ]
                    }
                ]
            },
            {
                name: 'keyword_between',
                description: 'What did we say about keyword between two dates?',
                type: 1,
                options: [
                    { name: 'term',   description: 'Keyword', type: 3, required: true },
                    { name: 'start',  description: 'Start date (YYYY-MM-DD)', type: 3, required: true },
                    { name: 'end',    description: 'End date (YYYY-MM-DD)',   type: 3, required: true }
                ]
            },
            {
                name: 'channel_discussed_period',
                description: 'What was discussed in #channel during a period?',
                type: 1,
                options: [
                    { name: 'channel', description: 'Channel', type: 7, required: true },
                    {
                        name: 'period',
                        description: 'Relative period',
                        type: 3,
                        required: true,
                        choices: [
                            { name: 'yesterday',   value: 'yesterday' },
                            { name: 'last week',   value: 'last week' },
                            { name: 'last Friday', value: 'last Friday' }
                        ]
                    }
                ]
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(ACCESS_TOKEN_DISCORD);

(async () => {
    try {
        console.log(`Started refreshing application (/) commands for ${scopeLabel}.`);

        await rest.put(route, { body: commands });

        console.log(`Successfully registered application (/) commands for ${scopeLabel}.`);
    } catch (error) {
        console.error(error);
    }
})();
