// features/codeReview.js
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require("discord.js");
const { getOpenAIResponse } = require('./openaiService');
const { preferredLocale } = require('../i18n');
const premium = require('../premium');

const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`([^`]+)`/g;

function buildReviewPrompt(rawContent) {
  if (!rawContent) return null;

  const blockMatches = rawContent.match(CODE_BLOCK_REGEX);
  let snippets = [];

  if (blockMatches && blockMatches.length) {
    snippets = blockMatches.map(block => block.trim()).filter(Boolean);
  } else {
    const inlineMatches = [];
    let match;
    while ((match = INLINE_CODE_REGEX.exec(rawContent)) !== null) {
      const code = match[1]?.trim();
      if (code) inlineMatches.push(code);
    }
    if (inlineMatches.length) {
      snippets = inlineMatches.map(code => `\`\`\`\n${code}\n\`\`\``);
    }
  }

  if (!snippets.length) return null;

  let prompt = `Please review the following code snippet(s):\n\n${snippets.join('\n\n')}`;
  const context = rawContent
    .replace(CODE_BLOCK_REGEX, '')
    .replace(/`[^`]+`/g, '')
    .trim();
  if (context) {
    prompt += `\n\nAdditional context from the author:\n${context}`;
  }
  return prompt;
}

module.exports = async function handleCodeReview(message) {
  let reviewPrompt = null;

  // If we’re already in a thread, only respond when the bot is mentioned
  if (message.channel.isThread()) {
    if (!message.mentions.has(message.client.user)) return;

    const cleaned = message.content
      .replaceAll(`<@${message.client.user.id}>`, '')
      .trim();

    reviewPrompt = buildReviewPrompt(cleaned || message.content);
    if (!reviewPrompt) return;
  } else {
    reviewPrompt = buildReviewPrompt(message.content);
    if (!reviewPrompt) return;
  }

  if (message.guildId !== null) {
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Yes").setStyle(ButtonStyle.Primary).setCustomId("code_review_yes"),
      new ButtonBuilder().setLabel("No").setStyle(ButtonStyle.Danger).setCustomId("code_review_no")
    );

    const reply = await message.reply({
      content: "Would you like me to review this code?",
      components: [buttonRow],
    });

    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button });

    collector.on('collect', async (interaction) => {
      // Only the original author can confirm
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: 'Only the original author can choose.', ephemeral: true });
      }
      if (interaction.customId === "code_review_yes") {
        const ok = await premium.hasPremiumAccess({ userId: interaction.user.id, guildId: message.guildId });
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await interaction.reply({ content: `🔒 Premium required. ${link}`, ephemeral: true });
          return;
        }
        await interaction.reply("Code review is being sent to you via DM.");
        await message.channel.sendTyping();
        const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
        const response = await getOpenAIResponse(reviewPrompt, 1000, locale);
        await message.author.send(response);
      } else if (interaction.customId === "code_review_no") {
        const ok = await premium.hasPremiumAccess({ userId: interaction.user.id, guildId: message.guildId });
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await interaction.reply({ content: `🔒 Premium required. ${link}`, ephemeral: true });
          return;
        }

        // ── 1. If this message is ALREADY inside a thread ──────────────
        if (message.channel.isThread()) {
          await interaction.reply({
            content: 'I’ll post the review below.',
            ephemeral: true
          });

          try {
            await message.channel.sendTyping();
            const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
            const response = await getOpenAIResponse(reviewPrompt, 1000, locale);
            await message.channel.send(response);
          } catch (err) {
            console.error('Failed to send code review in thread:', err);
            await message.channel.send(
              'Sorry – something went wrong while generating the review.'
            );
          }
          return; // done – no nested thread needed
        }

        // ── 2. Otherwise create a fresh thread off the message ──────────
        await interaction.reply({
          content: 'Creating a thread for the review…',
          ephemeral: true
        });

        let thread;
        try {
          thread = await message.startThread({
            name: `Code review – ${message.author.username}`,
            autoArchiveDuration: 1440 // 24 hours
          });
        } catch (err) {
          console.error('Failed to create thread for code review:', err);
          await interaction.editReply('⛔ I don’t have permission to create a thread here. I’ll reply in this channel instead.');
          try {
            await message.channel.sendTyping();
            const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
            const response = await getOpenAIResponse(reviewPrompt, 1000, locale);
            await message.reply(response);
          } catch (e) {
            console.error('Fallback code review failed:', e);
          }
          return;
        }

        await interaction.editReply(
          `Okay – I’ll carry out the review in <#${thread.id}>.`
        );

        try {
          await thread.sendTyping();
          const locale = await preferredLocale({ userId: interaction.user.id, guildId: interaction.guildId, discordLocale: interaction.locale });
          const response = await getOpenAIResponse(reviewPrompt, 1000, locale);
          await thread.send(response);
        } catch (err) {
          console.error('Failed to send code review:', err);
          await thread.send(
            'Sorry – something went wrong while generating the review.'
          );
        }
      }
    });
  }
};
