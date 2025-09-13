// purge-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

(async () => {
  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.ACCESS_TOKEN_DISCORD);

    const { CLIENT_ID, GUILD_ID } = process.env;
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
      console.log(`✅ Cleared guild commands for guild ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('✅ Cleared global commands');
    }
  } catch (err) {
    console.error('Purge failed:', err);
  }
})();
