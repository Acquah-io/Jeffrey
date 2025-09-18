// features/dmResponse.js
const { getOpenAIResponse } = require('./openaiService');
const premium = require('../premium');
const { augmentPrompt } = require('../services/knowledge');

async function resolveGuildId(message) {
  for (const guild of message.client.guilds.cache.values()) {
    try {
      await guild.members.fetch({ user: message.author.id, force: false });
      return guild.id;
    } catch (_) {
      continue;
    }
  }
  return null;
}

module.exports = async function handleDMResponse(message) {
  if (message.guildId === null) {
    // Premium check for user
    const ok = await premium.hasPremiumAccess({ userId: message.author.id, client: message.client });
    if (!ok) {
      const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
      await message.channel.send(`🔒 Premium required. ${link}`);
      return;
    }
    await message.channel.sendTyping();
    const guildId = await resolveGuildId(message);
    const basePrompt = `In less than 200 words respond to: ${message.content}`;
    const prompt = await augmentPrompt({ guildId, basePrompt, searchText: message.content });
    const response = await getOpenAIResponse(prompt, 300);
    await message.channel.send(response);
  }
};
