const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType
} = require('discord.js');

const pollData = new Map(); // messageId -> { options, votes, generalChannelId, generalMessageId }

const numberEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

/**
 * Display a modal asking the user for poll details.
 * The modal uses the custom ID `create-poll`.
 */
async function handleCreatePollButton(interaction) {
  // Guard against Discord's 3s interaction timeout – if we're close, tell the user to click again
  try {
    const ageMs = Date.now() - interaction.createdTimestamp;
    if (ageMs > 2500) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⏱️ That took a bit too long. Please click **Create Poll** again.', flags: 64 });
      }
      return;
    }
  } catch (_) {}

  const modal = new ModalBuilder()
    .setCustomId('create-poll')
    .setTitle('Create Poll');

  const question = new TextInputBuilder()
    .setCustomId('poll-question')
    .setLabel('Poll question')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const options = new TextInputBuilder()
    .setCustomId('poll-options')
    .setLabel('Options (comma separated)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(question),
    new ActionRowBuilder().addComponents(options)
  );

  try {
    await interaction.showModal(modal);
  } catch (err) {
    // 40060 = double‑ack, 10062 = interaction token expired/invalid
    if (err.code === 10062) {
      console.warn('Create‑poll interaction expired before showModal could run. Ask user to click again.');
      try {
        // We cannot reply to the interaction anymore; keep it quiet for users.
        // Optionally, you could notify the user via a follow‑up channel message.
      } catch (_) {}
      return;
    }
    if (err.code !== 40060) {
      console.error('Failed to show poll modal:', err);
    }
    // Ignore 40060 so the client does not emit an unhandled error
  }
}


async function handleCreatePollSubmit(interaction) {
  try {
    const question = interaction.fields.getTextInputValue('poll-question').trim();
    let options = interaction.fields
      .getTextInputValue('poll-options')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Basic validation
    if (!question) {
      return interaction.reply({ content: '⛔ The poll must have a question.', flags: 64 });
    }
    if (options.length < 2) {
      return interaction.reply({ content: '⛔ Please provide at least two options, separated by commas.', flags: 64 });
    }

    // Discord reactions reliably support up to 10 number emojis
    if (options.length > numberEmojis.length) options = options.slice(0, numberEmojis.length);

    const lines = options.map((opt, i) => `${numberEmojis[i]} ${opt}`);
    const content = `**${question}**\n\n${lines.join('\n')}`;

    // Post the poll in the polls channel with a Close button
    const closeButtonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`close-poll:${Date.now()}`) // placeholder
        .setLabel('Close Poll')
        .setStyle(ButtonStyle.Secondary)
    );

    const pollMessage = await interaction.channel.send({ content, components: [closeButtonRow] });
    closeButtonRow.components[0].setCustomId(`close-poll:${pollMessage.id}`);
    await pollMessage.edit({ components: [closeButtonRow] });

    // Add numbered reactions for visibility in the polls channel
    for (let i = 0; i < options.length; i++) {
      try { await pollMessage.react(numberEmojis[i]); } catch (_) {}
    }

    // Also post a select menu in the general channel for students to vote
    let generalMessageId = null;
    let generalChannelId = null;
    const generalChannel = interaction.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === 'general'
    );
    if (generalChannel) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`vote-poll:${pollMessage.id}`)
        .setPlaceholder('Choose an option')
        .setMinValues(1)
        .setMaxValues(1);
      options.forEach((opt, i) => select.addOptions({ label: opt, value: String(i) }));
      const selectRow = new ActionRowBuilder().addComponents(select);
      const generalMsg = await generalChannel.send({ content, components: [selectRow] });
      generalMessageId = generalMsg.id;
      generalChannelId = generalChannel.id;
    }

    // Store poll info for later tallying
    pollData.set(pollMessage.id, {
      options,
      votes: new Map(),
      generalChannelId,
      generalMessageId
    });

    // Acknowledge the submitter ephemerally
    await interaction.reply({ content: `✅ Poll posted in <#${interaction.channel.id}>.`, flags: 64 });
  } catch (err) {
    console.error('Failed to handle create-poll modal submit:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Sorry, something went wrong creating the poll.', flags: 64 });
      }
    } catch (_) {}
  }
}

async function handleVoteSelectMenu(interaction) {
  const pollId = interaction.customId.split(':')[1];
  const data = pollData.get(pollId);
  if (!data) {
    await interaction.reply({ content: 'This poll is no longer active.', ephemeral: true });
    return;
  }
  const choice = interaction.values[0];
  data.votes.set(interaction.user.id, choice);
  await interaction.reply({ content: '✅ Vote recorded.', ephemeral: true });
}

async function handleClosePollButton(interaction) {
  const messageId = interaction.customId.split(':')[1];
  try {
    const pollMessage = await interaction.channel.messages.fetch(messageId);
    await pollMessage.edit({ components: [] });

    const data = pollData.get(messageId);
    let results;
    if (data) {
      const counts = Array(data.options.length).fill(0);
      for (const choice of data.votes.values()) {
        const idx = parseInt(choice, 10);
        if (!isNaN(idx) && counts[idx] !== undefined) counts[idx]++;
      }
      results = data.options.map((opt, i) => `${opt}: **${counts[i]}**`);

      if (data.generalChannelId && data.generalMessageId) {
        const ch = interaction.guild.channels.cache.get(data.generalChannelId);
        if (ch) {
          const msg = await ch.messages.fetch(data.generalMessageId).catch(() => null);
          if (msg) {
            await msg.edit({ components: [] });
          }
        }
      }
      pollData.delete(messageId);
    } else {
      const lines = pollMessage.content.split('\n').slice(1);
      results = [];
      for (let i = 0; i < lines.length && i < numberEmojis.length; i++) {
        const emoji = numberEmojis[i];
        const reaction = pollMessage.reactions.cache.get(emoji);
        if (!reaction) break;
        const count = Math.max(0, reaction.count - 1);
        const option = lines[i].replace(`${emoji} `, '').trim();
        results.push(`${option}: **${count}**`);
      }
    }

    await interaction.reply({ content: '✅ Poll closed.', flags: 64 });
    await interaction.channel.send({ content: `**Poll Results:**\n${results.join('\n')}` });
    if (data && data.generalChannelId && data.generalChannelId !== interaction.channel.id) {
      const ch = interaction.guild.channels.cache.get(data.generalChannelId);
      if (ch) {
        await ch.send({ content: `**Poll Results:**\n${results.join('\n')}` });
      }
    }
  } catch (err) {
    console.error('Failed to close poll:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Sorry, could not close poll.', flags: 64 });
    }
  }
}

module.exports = { handleCreatePollButton, handleCreatePollSubmit, handleClosePollButton, handleVoteSelectMenu };
