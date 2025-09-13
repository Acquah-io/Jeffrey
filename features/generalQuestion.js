// features/generalQuestion.js
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require("discord.js");
const { getOpenAIResponse } = require('./openaiService');
const { preferredLocale } = require('../i18n');
const premium = require('../premium');

// Build concise thread context so follow‑ups like "is it bigger"
// can resolve pronouns using earlier turns in the same thread.
async function buildThreadContext(thread, { limit = 12 } = {}) {
  try {
    const msgs = await thread.messages.fetch({ limit });
    const ordered = Array.from(msgs.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = [];
    for (const m of ordered) {
      if (m.author.bot) continue; // skip bot chatter to save tokens
      const name = m.author?.username || 'user';
      const text = (m.content || '').trim();
      if (!text) continue;
      lines.push(`${name}: ${text}`);
    }
    const ctx = lines.join('\n');
    return ctx.length > 1600 ? ctx.slice(-1600) : ctx; // keep bounded
  } catch (_) { return ''; }
}

module.exports = async function handleGeneralQuestion(message) {
  // If we're already in a thread, only reply when the bot is mentioned
  if (message.channel.isThread()) {
    if (!message.mentions.has(message.client.user)) return;

    const cleaned = message.content
      .replaceAll(`<@${message.client.user.id}>`, '')
      .trim();

    if (!cleaned.length) return;

    // Premium check for user
    const ok = (await premium.hasUserEntitlement(message.author.id)) || premium.isWhitelistedGuild(message.guildId);
    if (!ok) {
      const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
      await message.channel.send(`🔒 Premium required. ${link}`);
      return;
    }
    await message.channel.sendTyping();
    const locale = await preferredLocale({ userId: message.author.id, guildId: message.guildId, discordLocale: message.guild?.preferredLocale });
    const context = await buildThreadContext(message.channel);
    const prompt = context
      ? `Using the conversation context below, answer the user's latest message. Resolve pronouns like "it" to the appropriate subject from context.\n\nContext:\n${context}\n\nLatest message: ${cleaned}`
      : cleaned;
    const response = await getOpenAIResponse(prompt, 300, locale);
    await message.channel.send(response);
    return;
  }
  if (message.content.endsWith('?') && message.guildId !== null) {
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Yes").setStyle(ButtonStyle.Primary).setCustomId("yes_private_help"),
      new ButtonBuilder().setLabel("No").setStyle(ButtonStyle.Danger).setCustomId("no_private_help")
    );

    const reply = await message.reply({
      content: "Would you like me to help you with this question privately?",
      components: [buttonRow],
    });

    // No hard 60‑second timeout – keeps listening until the message is deleted
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button });

    collector.on('collect', async (interaction) => {
      // Only the original author can choose
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: 'Only the original author can choose.', ephemeral: true });
      }
      // Acknowledge immediately to avoid 3s timeout regardless of entitlement latency
      await interaction.deferUpdate().catch(() => {});
      if (interaction.customId === "yes_private_help") {
        // Premium check for user
        const ok = (await premium.hasUserEntitlement(interaction.user.id)) || premium.isWhitelistedGuild(interaction.guildId);
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await interaction.followUp({ content: `🔒 Premium required. ${link}`, ephemeral: true });
          return;
        }
        try {
          // Generate the private help message
          const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
          const response = await getOpenAIResponse(message.content, 300, locale);

          // Attempt to DM the user
          await interaction.user.send(response);

          // Confirmation
          await interaction.followUp({
            content: "I've sent you a private response.",
            ephemeral: true
          });
        } catch (err) {
          console.error("Failed to send DM:", err);
          await interaction.followUp({
            content: "⛔ I couldn’t send you a DM. Please check your privacy settings and try again.",
            ephemeral: true
          });
        }
      } else if (interaction.customId === "no_private_help") {
        // Premium check for user
        const ok = (await premium.hasUserEntitlement(interaction.user.id)) || premium.isWhitelistedGuild(interaction.guildId);
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await interaction.followUp({ content: `🔒 Premium required. ${link}`, ephemeral: true });
          return;
        }

        let thread;
        try {
          thread = await message.startThread({
            name: `Question – ${message.author.username}`,
            autoArchiveDuration: 1440 // 24 hours
          });
        } catch (err) {
          console.error("Failed to create thread for question:", err);
          await interaction.followUp({
            content: "⛔ I don’t have permission to create a thread here. I’ll reply in this channel instead.",
            ephemeral: true
          });
          try {
            await message.channel.sendTyping();
            const response = await getOpenAIResponse(message.content, 300);
            await message.reply(response);
          } catch (e) {
            console.error('Fallback answer failed:', e);
          }
          return;
        }

        await interaction.followUp({
          content: `I’ve answered in the thread <#${thread.id}>.`,
          ephemeral: true
        });

        try {
          await thread.sendTyping();
          const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
          const context = await buildThreadContext(thread);
          const prompt = context
            ? `Using the conversation context below, answer the user's latest message. Resolve pronouns like "it" to the appropriate subject from context.\n\nContext:\n${context}\n\nLatest message: ${message.content}`
            : message.content;
          const response = await getOpenAIResponse(prompt, 300, locale);
          await thread.send(response);
        } catch (err) {
          console.error("Failed to answer question in thread:", err);
          await thread.send("Sorry – something went wrong while generating my answer.");
        }
      }
    });
  }
};
