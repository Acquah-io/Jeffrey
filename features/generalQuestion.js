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

function buildChoiceRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Yes").setStyle(ButtonStyle.Primary).setCustomId("yes_private_help").setDisabled(disabled),
    new ButtonBuilder().setLabel("No").setStyle(ButtonStyle.Danger).setCustomId("no_private_help").setDisabled(disabled)
  );
}

module.exports = async function handleGeneralQuestion(message) {
  const guildId = message.guildId;
  const authorId = message.author.id;
  const premiumLink = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';

  async function ensurePremium({ userId = authorId } = {}) {
    return await premium.hasPremiumAccess({ userId, guildId });
  }

  async function answerInThread({ notifySuccess, notifyFailure } = {}) {
    let thread;
    try {
      thread = await message.startThread({
        name: `Question – ${message.author.username}`,
        autoArchiveDuration: 1440 // 24 hours
      });
    } catch (err) {
      console.error("Failed to create thread for question:", err);
      const notify = notifyFailure || (async (text) => { await message.reply(text); });
      await notify("⛔ I don’t have permission to create a thread here. I’ll reply in this channel instead.");
      try {
        await message.channel.sendTyping();
        const locale = await preferredLocale({ userId: authorId, guildId, discordLocale: message.guild?.preferredLocale });
        const response = await getOpenAIResponse(message.content, 300, locale);
        await message.reply(response);
      } catch (fallbackErr) {
        console.error('Fallback answer failed:', fallbackErr);
      }
      return;
    }

    const notify = notifySuccess || (async (text) => { await message.reply(text); });
    await notify(`I’ve answered in the thread <#${thread.id}>.`);

    try {
      await thread.sendTyping();
      const locale = await preferredLocale({ userId: authorId, guildId, discordLocale: message.guild?.preferredLocale });
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

  // If we're already in a thread, only reply when the bot is mentioned
  if (message.channel.isThread()) {
    if (!message.mentions.has(message.client.user)) return;

    const cleaned = message.content
      .replaceAll(`<@${message.client.user.id}>`, '')
      .trim();

    if (!cleaned.length) return;

    const ok = await ensurePremium();
    if (!ok) {
      await message.channel.send(`🔒 Premium required. ${premiumLink}`);
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

  if (message.content.endsWith('?') && guildId !== null) {
    const buttonRow = buildChoiceRow();
    const disabledRow = buildChoiceRow(true);

    try {
      const dmPrompt = await message.author.send({
        content: "Would you like me to help you with this question privately?",
        components: [buttonRow],
      });

      try {
        await message.reply("I’ve sent you a DM so you can choose how you’d like me to help.");
      } catch (_) {}

      const collector = dmPrompt.createMessageComponentCollector({ componentType: ComponentType.Button, time: 10 * 60 * 1000 });

      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== authorId) {
          await interaction.reply({ content: 'Only the original author can choose.' });
          return;
        }

        const entitled = await ensurePremium({ userId: interaction.user.id });
        if (!entitled) {
          await interaction.reply({ content: `🔒 Premium required. ${premiumLink}` });
          return;
        }

        collector.stop('handled');

        if (interaction.customId === "yes_private_help") {
          await interaction.update({
            content: "Great! I’ll send the answer privately.",
            components: [disabledRow],
          });
          try {
            const locale = await preferredLocale({ userId: interaction.user.id, guildId, discordLocale: interaction.locale || message.guild?.preferredLocale });
            const response = await getOpenAIResponse(message.content, 300, locale);
            await interaction.user.send(response);
            await interaction.followUp({ content: "I've sent you a private response." });
          } catch (err) {
            console.error("Failed to send private response:", err);
            await interaction.followUp({
              content: "⛔ I couldn’t send you a DM. Please check your privacy settings and try again.",
            });
          }
        } else if (interaction.customId === "no_private_help") {
          await interaction.update({
            content: "Okay! I’ll answer in the server thread.",
            components: [disabledRow],
          });

          await answerInThread({
            notifySuccess: async (text) => { await interaction.followUp({ content: text }); },
            notifyFailure: async (text) => { await interaction.followUp({ content: text }); },
          });
        }
      });

      collector.on('end', async (_collected, reason) => {
        if (reason !== 'handled') {
          try { await dmPrompt.edit({ components: [disabledRow] }); } catch (_) {}
        }
      });
    } catch (err) {
      console.error('Failed to DM private-choice prompt:', err);
      const entitled = await ensurePremium();
      if (!entitled) {
        await message.reply(`🔒 Premium required. ${premiumLink}`);
        return;
      }
      await answerInThread({
        notifySuccess: async (text) => { await message.reply(text); },
        notifyFailure: async (text) => { await message.reply(text); },
      });
    }
  }
};
