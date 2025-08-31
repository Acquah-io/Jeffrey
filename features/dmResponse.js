// features/dmResponse.js
const { getOpenAIResponse } = require('./openaiService');
const premium = require('../premium');

module.exports = async function handleDMResponse(message) {
  if (message.guildId === null) {
    // Premium check for user
    const ok = await premium.hasUserEntitlement(message.author.id);
    if (!ok) {
      const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
      await message.channel.send(`🔒 Premium required. ${link}`);
      return;
    }
    await message.channel.sendTyping();
    const response = await getOpenAIResponse(`In less than 200 words respond to: ${message.content}`, 300);
    await message.channel.send(response);
  }
};
