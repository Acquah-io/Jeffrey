// purge-commands.js
require('dotenv').config();
const { REST, Routes } = require('discord.js');

(async () => {
  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.ACCESS_TOKEN_DISCORD);

    // ⚠️  This removes every existing slash-command for this bot in the guild
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );

    console.log('✅ Cleared guild commands');
  } catch (err) {
    console.error('Purge failed:', err);
  }
})();
