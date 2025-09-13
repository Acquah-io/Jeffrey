const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Signal to any required modules (e.g., database.js) that we're only deploying
// commands and should not establish heavyweight connections.
process.env.COMMANDS_DEPLOY = process.env.COMMANDS_DEPLOY || '1';

const { ACCESS_TOKEN_DISCORD, CLIENT_ID, GUILD_ID } = process.env;

// If GUILD_ID is provided, register commands to that guild for instant refresh.
// Otherwise, register globally (may take up to 1 hour to propagate).
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

const scopeLabel = GUILD_ID ? `guild ${GUILD_ID}` : 'global scope';

// Load all slash commands from /features to avoid drift
const commands = [];
const featuresPath = path.join(__dirname, 'features');
for (const file of fs.readdirSync(featuresPath).filter(f => f.endsWith('.js'))) {
  try {
    const mod = require(path.join(featuresPath, file));
    if (mod?.data?.toJSON) commands.push(mod.data.toJSON());
  } catch (_) { /* ignore non-command modules */ }
}

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
