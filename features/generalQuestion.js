// features/generalQuestion.js
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require("discord.js");
const { getOpenAIResponse } = require('./openaiService');
const premium = require('../premium');

module.exports = async function handleGeneralQuestion(message) {
  // If we're already in a thread, only reply when the bot is mentioned
  if (message.channel.isThread()) {
    if (!message.mentions.has(message.client.user)) return;

    const cleaned = message.content
      .replaceAll(`<@${message.client.user.id}>`, '')
      .trim();

    if (!cleaned.length) return;

    // Premium check for user
    const ok = await premium.hasUserEntitlement(message.author.id);
    if (!ok) {
      const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
      await message.channel.send(`🔒 Premium required. ${link}`);
      return;
    }
    await message.channel.sendTyping();
    const response = await getOpenAIResponse(cleaned, 300);
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
      if (interaction.customId === "yes_private_help") {
        // Premium check for user
        const ok = await premium.hasUserEntitlement(interaction.user.id);
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await interaction.followUp({ content: `🔒 Premium required. ${link}`, ephemeral: true });
          return;
        }
        // Acknowledge the button immediately to avoid timing out
        await interaction.deferUpdate();
        try {
          // Generate the private help message
          const response = await getOpenAIResponse(message.content, 300);

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
        // Acknowledge the button press straight away
        await interaction.deferUpdate();

        // Premium check for user
        const ok = await premium.hasUserEntitlement(interaction.user.id);
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
          return interaction.followUp({
            content: "⛔ I don’t have permission to create a thread here.",
            ephemeral: true
          });
        }

        await interaction.followUp({
          content: `I’ve answered in the thread <#${thread.id}>.`,
          ephemeral: true
        });

        try {
          await thread.sendTyping();
          const response = await getOpenAIResponse(message.content, 300);
          await thread.send(response);
        } catch (err) {
          console.error("Failed to answer question in thread:", err);
          await thread.send("Sorry – something went wrong while generating my answer.");
        }
      }
    });
  }
};
