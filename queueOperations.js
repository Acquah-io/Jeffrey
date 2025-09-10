const { getQueue, addStudent, removeStudent, studentActiveQueue, listQueues, listBlacklisted, createQueue, updateQueue, shuffleQueue, clearQueue, activeQueue, blacklistUser, unblacklistUser, isUserBlacklisted, setupStaffQueueChannel, setupStudentQueueChannel, buildBlacklistSelector, buildDeleteSelector, buildStaffQueueSelector } = require('./queueManager');
/**
 * When staff click “Delete User”, show a dropdown of current queue members.
 */
async function handleDeleteUserButton(interaction) {
  const { PermissionFlagsBits } = require('discord.js');
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }
  const serverId = interaction.guild.id;
  const queues   = await listQueues(serverId);
  const queueId  = activeQueue.get(serverId) ?? queues[0]?.id;
  const queueObj = queues.find(q => q.id === queueId);
  if (!queueObj) {
    return interaction.reply({ content: '❗ No queue selected.', ephemeral: true });
  }
  // Build selector of current members
  const delRow = await buildDeleteSelector(interaction.guild, queueObj.queue_name);
  await interaction.deferUpdate();
  // Append to message
  const rows = interaction.message.components.filter(r => !r.components.some(c => c.customId === 'delete-user-selector'));
  await interaction.message.edit({ components: [...rows, delRow] });
}

/**
 * Remove selected users from the queue.
 */
async function handleDeleteUserSelect(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const serverId = interaction.guild.id;
  const queues   = await listQueues(serverId);
  const queueId  = activeQueue.get(serverId) ?? queues[0]?.id;
  const queueObj = queues.find(q => q.id === queueId);
  if (!queueObj) {
    return interaction.editReply({ content: '❗ Queue not found.' });
  }
  const queueName = queueObj.queue_name;
  for (const uid of interaction.values) {
    await removeStudent(serverId, queueName, uid);
    studentActiveQueue.delete(`${serverId}:${uid}`);
  }
  // Refresh both panels
  await refreshPanels(interaction.guild);
  const mentions = interaction.values.map(id => `<@${id}>`).join(', ');
  await interaction.editReply({ content: `🗑️ Removed ${mentions} from **${queueName}**.` });
}
const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
        ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Refresh both the student and staff queue panels for the guild.
 * Runs the two panel builders in parallel so that the staff view
 * updates as quickly as the student view.
 */
async function refreshPanels(guild) {
  // DEBUG: comment out if the logs get too noisy.
  console.log(`[refreshPanels] Updating panels for ${guild.name} (${guild.id})`);

  const studentChannel = guild.channels.cache.find(
    ch => ch.name === 'student-queues'
  );
  const staffChannel = guild.channels.cache.find(
    ch => ch.name === 'staff-queues'
  );

  await Promise.all([
    studentChannel ? setupStudentQueueChannel(studentChannel) : Promise.resolve(),
    staffChannel ? setupStaffQueueChannel(staffChannel) : Promise.resolve()
  ]);
}

/**
 * Store the student's selected queue.
 */
async function handleStudentQueueSelect(interaction) {
  try {
    const selectedQueueId = interaction.values[0];
    const userKey = `${interaction.guild.id}:${interaction.user.id}`;
    studentActiveQueue.set(userKey, selectedQueueId);
    
    // Look up the human-readable queue name
    const queues = await listQueues(interaction.guild.id);
    const queueObj = queues.find(q => String(q.id) === selectedQueueId);
    const selectedQueueName = queueObj ? queueObj.queue_name : selectedQueueId;
    
    await interaction.reply({
      content: `✅ You have selected the queue **${selectedQueueName}**. Now click **Join** to enter or **Leave** to exit.`,
      ephemeral: true
    });
  } catch (error) {
    console.error("Error handling student queue select:", error);
    await interaction.reply({ content: "There was an error selecting the queue.", ephemeral: true });
  }
}

// Existing handlers...

async function handleBlacklistButton(interaction) {
  const { PermissionFlagsBits } = require('discord.js');
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }
  const serverId = interaction.guild.id;
  const queues = await listQueues(serverId);
  const queueId = activeQueue.get(serverId) ?? queues[0]?.id;
  if (!queueId) {
    return interaction.reply({ content: '❗ No queue selected.', ephemeral: true });
  }
  const blacklistRow = await buildBlacklistSelector(interaction.guild, queueId);
  // Remove any previous blacklist selector row, then append fresh one
  const existingRows = interaction.message.components.filter(row =>
    !row.components.some(comp => comp.customId === 'blacklist-selector')
  );
  // Acknowledge the button without sending a message
  await interaction.deferUpdate();
  // Edit the original message to include the new blacklist dropdown
  await interaction.message.edit({
    components: [...existingRows, blacklistRow]
  });
}

/**
 * Handle staff queue selection or creation.
 */
async function handleStaffQueueSelect(interaction) {
  const selected = interaction.values[0];
  if (selected === 'create-new') {
    const modal = new ModalBuilder()
      .setCustomId('create-queue-modal')
      .setTitle('Create New Queue');

    // Name field
    const nameInput = new TextInputBuilder()
      .setCustomId('new-queue-name')
      .setLabel('Queue name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    // ← NEW: Description field
    const descInput = new TextInputBuilder()
      .setCustomId('new-queue-description')
      .setLabel('Queue description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    // Add both fields to the modal
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descInput)
    );
  
    return interaction.showModal(modal);
  }
  // Staff selected an existing queue: activate it
  const queueId = parseInt(selected, 10);
  const queues = await listQueues(interaction.guild.id);
  const queueObj = queues.find(q => q.id === queueId);
  if (!queueObj) {
    return interaction.reply({ content: '❗ Queue not found.', ephemeral: true });
  }
  activeQueue.set(interaction.guild.id, queueId);
  // Rebuild the dropdown to mark the new queue as selected
  const newSelectorRow = buildStaffQueueSelector(queues, queueId);
  const controlRow = interaction.message.components[1];
  const createRow  = interaction.message.components.find(row =>
    row.components.some(c => c.customId === 'create-queue')
  ) || new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create-queue')
      .setLabel('Create Queue')
      .setStyle(ButtonStyle.Success)
  );

  const updatedComponents = [newSelectorRow, controlRow, createRow];
  // If blacklist menu was visible, rebuild that too
  if (interaction.message.components.some(row =>
      row.components.some(comp => comp.customId === 'blacklist-selector')
    )) {
    const blacklistRow = await buildBlacklistSelector(interaction.guild, queueId);
    updatedComponents.push(blacklistRow);
  }
  return interaction.update({ components: updatedComponents });
}

/**
 * Show a modal to create a new queue when the “Create Queue” button is pressed.
 */
async function handleCreateQueueButton(interaction) {
  const { PermissionFlagsBits } = require('discord.js');
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '⛔ Staff only.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId('create-queue-modal')
    .setTitle('Create New Queue');

  const nameInput = new TextInputBuilder()
    .setCustomId('new-queue-name')
    .setLabel('Queue name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const descInput = new TextInputBuilder()
    .setCustomId('new-queue-description')
    .setLabel('Queue description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(descInput)
  );

  await interaction.showModal(modal);
}

/**
 * Handle the modal submission for creating a new queue.
 */
async function handleCreateQueueModal(interaction) {
  const queueName = interaction.fields.getTextInputValue('new-queue-name').trim();
  if (!queueName) {
    return interaction.reply({ content: '❗ Queue name cannot be empty.', ephemeral: true });
  }
  const queueDescription = interaction.fields.getTextInputValue('new-queue-description').trim();
  try {
    // Persist the new queue with description
    await createQueue(interaction.guild.id, queueName, queueDescription);
    // Determine the new queue's ID and activate it
    const queues = await listQueues(interaction.guild.id);
    const queueObjNew = queues.find(q => q.queue_name === queueName);
    if (queueObjNew) {
      activeQueue.set(interaction.guild.id, queueObjNew.id);
    }
    await interaction.reply({ content: `✅ Queue **${queueName}** created and selected.`, ephemeral: true });
    // Refresh the staff panel
    const { setupStaffQueueChannel, setupStudentQueueChannel } = require('./queueManager');
    await setupStaffQueueChannel(interaction.channel);
    // Refresh the student panel so the new queue appears
    const studentChannel = interaction.guild.channels.cache.find(ch => ch.name === 'student-queues');
    if (studentChannel) {
      await setupStudentQueueChannel(studentChannel);
    }
  } catch (error) {
    console.error("Error creating new queue:", error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❗ There was an error creating the queue.', ephemeral: true });
    }
  }
}
/**
 * Adds a user to a queue.
 */
async function handleJoinQueue(interaction, user, guild) {

    // Prevent joining without selecting a queue
const userKey = `${guild.id}:${user.id}`;
const selectedQueueId = studentActiveQueue.get(userKey);
if (!selectedQueueId) {
  return interaction.reply({
    content: '❗ Please select a queue first using the dropdown menu.',
    ephemeral: true
  });
}
    console.log(`handleJoinQueue called for user ${user.id} in guild ${guild.id}`);
    // Look up the human-readable queue name
    const queues = await listQueues(guild.id);
    const queueObj = queues.find(q => String(q.id) === selectedQueueId);
    const queueName = queueObj ? queueObj.queue_name : selectedQueueId;
    // Check for blacklist
    const queueIdInt = parseInt(selectedQueueId, 10);
    const isBlocked = await isUserBlacklisted(guild.id, queueIdInt, user.id);
    if (isBlocked) {
      // Clear any existing selection so they must re-select
      const userKey = `${guild.id}:${user.id}`;
      studentActiveQueue.delete(userKey);

      return interaction.reply({
        content: `⛔ You have been blacklisted from **${queueName}** by staff and cannot join.`,
        ephemeral: true
      });
    }
    try {
        // Call the database function to add the student to the queue.
        await addStudent(guild.id, queueName, user.id);
        // Retrieve the updated queue from the database.
        const studentQueue = await getQueue(queueName, guild.id);
        console.log(`User ${user.id} added to queue '${queueName}'. Position: ${studentQueue.length}`);
        const replyText = `You have joined the queue **${queueName}**. Your position is ${studentQueue.length}.`;
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: replyText, ephemeral: true });
        } else {
            await interaction.followUp({ content: replyText, ephemeral: true });
        }
        // Refresh both the student and staff panels so the staff view stays up‑to‑date.
        await refreshPanels(guild);
    } catch (error) {
        console.error("Error handling join queue:", error);
        await interaction.reply({ content: "There was an error joining the queue.", ephemeral: true });
    }
}
/**
 * Handle selection from the blacklist menu.
 */
async function handleBlacklistSelect(interaction) {
  // Acknowledge interaction to avoid timeout and allow deferred reply
  await interaction.deferReply({ ephemeral: true });
  const serverId = interaction.guild.id;
  const queues = await listQueues(serverId);
  const queueId = activeQueue.get(serverId) ?? queues[0]?.id;
  if (!queueId) {
    return interaction.editReply({ content: '❗ Please select a queue first using the dropdown menu.' });
  }
  // Ensure activeQueue is set so subsequent operations know the selection
  activeQueue.set(serverId, queueId);
  // Resolve queue name for removal
  const queueObjSel = queues.find(q => q.id === queueId);
  const queueNameSel = queueObjSel ? queueObjSel.queue_name : null;
  // Fetch previously blacklisted users for this queue
  const prevEntries = await listBlacklisted(serverId, queueId);
  const prevIds = prevEntries.map(u => String(u.user_id));
  const selected = interaction.values;
  // Un-blacklist users that were previously black-listed but are now unticked
  for (const userId of prevIds) {
    if (!selected.includes(userId)) {
      await unblacklistUser(serverId, queueId, userId);
    }
  }
  
  // Ensure EVERY ticked user is in the blacklist table (INSERT is idempotent)
  for (const userId of selected) {
    await blacklistUser(serverId, queueId, userId);
    if (queueNameSel) await removeStudent(serverId, queueNameSel, userId);
    studentActiveQueue.delete(`${serverId}:${userId}`);
  }
  // Build a mention list of blacklisted users
  const mentions = selected.length
    ? selected.map(id => `<@${id}>`).join(', ')
    : 'No users';
  const { setupStaffQueueChannel, setupStudentQueueChannel } = require('./queueManager');
  // Refresh the staff panel first
  await setupStaffQueueChannel(interaction.channel);

  // Refresh the student panel so black-listed queues vanish before we respond
  const studentChannel = interaction.guild.channels.cache.find(ch => ch.name === 'student-queues');
  if (studentChannel) {
    await setupStudentQueueChannel(studentChannel);
  }

  await interaction.editReply({
    content: `✅ Blacklisted ${mentions} from queue **${queueNameSel}**.`
  });
}


/**
 * Removes a user from a queue.
 */
async function handleLeaveQueue(interaction, user, guild) {
  // Acknowledge the interaction immediately to avoid timeout
  await interaction.deferReply({ ephemeral: true });

  // Determine selected queue; if none, remove user from all queues
  const userKey = `${guild.id}:${user.id}`;
  const selectedQueueId = studentActiveQueue.get(userKey);
  if (!selectedQueueId) {
    // No active selection – remove the user from all queues
    const queues = await listQueues(guild.id);
    for (const q of queues) {
      await removeStudent(guild.id, q.queue_name, user.id);
    }
    // Refresh both panels
    await refreshPanels(guild);
    return interaction.editReply({
      content: '✅ You have been removed from all queues you were in.'
    });
  }

  // Look up the human-readable queue name
  const queues = await listQueues(guild.id);
  const queueObj = queues.find(q => String(q.id) === selectedQueueId);
  const queueName = queueObj ? queueObj.queue_name : selectedQueueId;

  try {
    // Remove the student from the selected queue
    await removeStudent(guild.id, queueName, user.id);

    const replyText = `You have left the queue **${queueName}**.`;

    // Clear the stored selection so they must re-select next time
    studentActiveQueue.delete(userKey);

    // Refresh the student panel to reflect removal
    const studentChannel = guild.channels.cache.find(ch => ch.name === 'student-queues');
    if (studentChannel) {
      await setupStudentQueueChannel(studentChannel);
    }

    // Also refresh the staff panel so it no longer shows the user
    const staffChannel = guild.channels.cache.find(ch => ch.name === 'staff-queues');
    if (staffChannel) {
      await setupStaffQueueChannel(staffChannel);
    }

    // Send confirmation after updating panel
    await interaction.editReply({ content: replyText });
  } catch (error) {
    console.error("Error handling leave queue:", error);
    await interaction.editReply({ content: "There was an error leaving the queue." });
  }
}

/**
 * Displays the user's position in all queues.
 */
/**
 * Displays the user's position in queues by querying the database.
 */
// async function handleViewPositions(interaction, user, guild) {
//     try {
//         // Retrieve the student queue from the database.
//         const studentQueue = await getQueue('studentQueue', guild.id);
//         let response = 'Your positions in queues:\n';

//         if (studentQueue && studentQueue.length > 0) {
//             const studentPosition = studentQueue.indexOf(user.id);
//             if (studentPosition !== -1) {
//                 response += `- Student Queue: Position ${studentPosition + 1}\n`;
//             } else {
//                 response += `- Student Queue: You are not in the queue.\n`;
//             }
//         } else {
//             response += '- Student Queue is currently empty.\n';
//         }

//         // Future enhancements: add additional queues here if needed.

//         await interaction.reply({ content: response, ephemeral: true });
//     } catch (error) {
//         console.error("Error in handleViewPositions:", error);
//         await interaction.reply({ content: "There was an error retrieving your positions.", ephemeral: true });
//     }
// }

/**
 * Displays the current state of all queues.
 */
// async function handleShowQueues(interaction, guild) {
//     try {
//         // Find the channel where the pinned queue message should be updated.
//         const studentChannel = guild.channels.cache.find(channel => channel.name === 'student-queues');
//         if (!studentChannel) {
//             throw new Error('Student queue channel not found.');
//         }

//         // Retrieve the updated student queue from your database.
//         const studentQueue = await getQueue('studentQueue', guild.id);
//         let queueDescription = 'Queue is currently empty.';
//         if (studentQueue && studentQueue.length > 0) {
//             queueDescription = studentQueue
//                 .map((userId, index) => `${index + 1}. <@${userId}>`)
//                 .join('\n');
//         }

//         // Create the updated embed that shows the current queue.
//         const updatedEmbed = new EmbedBuilder()
//             .setTitle('Queue Options for Students')
//             .setDescription(`Use these buttons to interact with the queues.\n\n**Current Queue:**\n${queueDescription}`)
//             .setColor('#0000FF'); // Example blue color

//         // Fetch the pinned messages in the student channel.
//         const pinnedMessages = await studentChannel.messages.fetchPinned();
//         // Find the pinned message with the title "Queue Options for Students".
//         const existingMessage = pinnedMessages.find(
//             msg => msg.embeds.length && msg.embeds[0].title === 'Queue Options for Students'
//         );

//         if (existingMessage) {
//             // Update the pinned message with the new embed.
//             await existingMessage.edit({ embeds: [updatedEmbed] });
//         } else {
//             // If the pinned message is not found, send a new message and pin it.
//             const newMessage = await studentChannel.send({ embeds: [updatedEmbed] });
//             await newMessage.pin();
//         }
        
//         // Acknowledge the interaction without sending any extra message.
//         await interaction.deferUpdate();
//     } catch (error) {
//         console.error('Error updating queue display:', error);
//         // Optionally, handle the error as needed:
//         if (!interaction.replied && !interaction.deferred) {
//             await interaction.reply({ content: 'Error updating queue display.', ephemeral: true });
//         } else {
//             await interaction.followUp({ content: 'Error updating queue display.', ephemeral: true });
//         }
//     }
// }

/**
 * Clear the active queue and persist in the database.
 */
async function handleClearQueue(interaction) {
  const serverId = interaction.guild.id;
  const queueId = activeQueue.get(serverId);
  if (!queueId) {
    return interaction.reply({ content: '❗ Please select a queue first using the dropdown menu.', ephemeral: true });
  }
  const queuesList = await listQueues(serverId);
  const queueObj = queuesList.find(q => q.id === queueId);
  if (!queueObj) {
    return interaction.reply({ content: '❗ Queue not found.', ephemeral: true });
  }
  const queueName = queueObj.queue_name;
  // Clear in database
  await clearQueue(serverId, queueName);
  await interaction.reply({ content: `✅ Queue **${queueName}** has been cleared.`, ephemeral: true });
  // Refresh staff panel
  const { setupStaffQueueChannel, setupStudentQueueChannel } = require('./queueManager');
  await setupStaffQueueChannel(interaction.channel);
  // Refresh student panel
  const studentChannel = interaction.guild.channels.cache.find(ch => ch.name === 'student-queues');
  if (studentChannel) {
    await setupStudentQueueChannel(studentChannel);
  }
}

/**
 * Shuffle the active queue and refresh both panels.
 */
async function handleShuffleQueue(interaction) {
  const { guild } = interaction;
  const serverId  = guild.id;

  // 1️⃣  ACKNOWLEDGE IMMEDIATELY so the button remains clickable
  await interaction.deferUpdate();

  const queueId = activeQueue.get(serverId);
  if (!queueId) {
    return interaction.followUp({
      content: '❗ Please select a queue first using the dropdown menu.',
      ephemeral: true
    });
  }

  // Resolve the queue’s name
  const queues    = await listQueues(serverId);
  const queueObj  = queues.find(q => String(q.id) === String(queueId));
  if (!queueObj) {
    return interaction.followUp({ content: '❗ Queue not found.', ephemeral: true });
  }
  const queueName = queueObj.queue_name;

  try {
    // 2️⃣  Shuffle in the database
    await shuffleQueue(serverId, queueName);

    // 3️⃣  One-shot panel refresh (student + staff)
    await refreshPanels(guild);

    // 4️⃣  Ephemeral confirmation
    await interaction.followUp({
      content: `✅ Queue **${queueName}** has been shuffled.`,
      ephemeral: true
    });
  } catch (err) {
    console.error('Error shuffling queue:', err);
    await interaction.followUp({
      content: '❗ There was an error shuffling the queue.',
      ephemeral: true
    });
  }
}

/**
 * Updates the pinned message in the student-queues channel with the current queue.
 */
async function updateQueueDisplay(guild) {
    try {
        // Locate the student queue channel by its name.
        const studentChannel = guild.channels.cache.find(channel => channel.name === 'student-queues');
        if (!studentChannel) {
            throw new Error('Student queue channel not found.');
        }

        // Define a buffering embed to simulate a loading animation.
        const bufferingEmbed = new EmbedBuilder()
            .setTitle('Queue Options for Students')
            .setDescription('Updating queue display... :arrows_counterclockwise:')
            .setColor('#0000FF'); // Example blue color

        // Fetch pinned messages in the channel.
        let pinnedMessages = await studentChannel.messages.fetchPinned();
        // Find the pinned message with the title "Queue Options for Students".
        let existingMessage = pinnedMessages.find(
            msg => msg.embeds.length && msg.embeds[0].title === 'Queue Options for Students'
        );

        // If there is an existing message, update it to show the buffering embed.
        if (existingMessage) {
            await existingMessage.edit({ embeds: [bufferingEmbed] });
        } else {
            // Otherwise, send and pin a new message with the buffering embed.
            const newMessage = await studentChannel.send({ embeds: [bufferingEmbed] });
            await newMessage.pin();
            existingMessage = newMessage;
        }

        // Wait 1.5 seconds to simulate a buffer animation.
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Build a description of every queue and its members
        const queues = await listQueues(guild.id);
        let embedDescription;
        if (!queues.length) {
          embedDescription = 'No queues yet.';
        } else {
          const parts = [];
          for (const q of queues) {
            const members = await getQueue(q.queue_name, guild.id);
            const lines = members.length
              ? members.map((u, i) => `${i + 1}. <@${u}>`).join('\n')
              : 'Queue is currently empty.';
            parts.push(
              `**${q.queue_name}**\n` +
              `${q.description || '_No description provided._'}\n` +
              `${lines}`
            );
          }
          embedDescription = parts.join('\n\n');
        }
        const updatedEmbed = new EmbedBuilder()
          .setTitle('Queue Options for Students')
          .setDescription(`Use these buttons to interact with the queues.\n\n${embedDescription}`)
          .setColor('#00b0ff');

        // Update the pinned message with the final embed.
        await existingMessage.edit({ embeds: [updatedEmbed] });
    } catch (error) {
        console.error('Error updating queue display:', error);
    }
}

/**
 * Show a modal to edit the selected queue.
 */
async function handleEditQueue(interaction) {
    const serverId = interaction.guild.id;
    const queueId  = activeQueue.get(serverId);
    if (!queueId) {
      return interaction.reply({ content: '❗ Please select a queue first using the dropdown menu.', ephemeral: true });
    }
    const queues = await listQueues(serverId);
    const queueObj = queues.find(q => String(q.id) === String(queueId));
    if (!queueObj) {
      return interaction.reply({ content: '❗ Queue not found.', ephemeral: true });
    }
  
    const modal = new ModalBuilder()
      .setCustomId(`edit-queue-modal-${queueId}`)
      .setTitle('Edit Queue');
  
    // Prefilled name
    const nameInput = new TextInputBuilder()
      .setCustomId('edit-queue-name')
      .setLabel('Queue name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(queueObj.queue_name);
  
    // Prefilled description
    const descInput = new TextInputBuilder()
      .setCustomId('edit-queue-description')
      .setLabel('Queue description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(queueObj.description || '');
  
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(descInput)
    );
  
    await interaction.showModal(modal);
  }

  /**
 * Handle submission of the Edit Queue modal.
 */
async function handleEditQueueModal(interaction) {
    // Extract the queueId from the customId suffix
    const parts   = interaction.customId.split('-');
    const queueId = parts[parts.length - 1];
    const newName = interaction.fields.getTextInputValue('edit-queue-name').trim();
    if (!newName) {
      return interaction.reply({ content: '❗ Queue name cannot be empty.', ephemeral: true });
    }
    const newDesc = interaction.fields.getTextInputValue('edit-queue-description').trim();
  
    try {
      await updateQueue(queueId, newName, newDesc);
      // Keep staff’s “active” queue pointed to the same ID
      activeQueue.set(interaction.guild.id, queueId);
      await interaction.reply({ content: `✅ Queue updated to **${newName}**.`, ephemeral: true });
  
      // Refresh both the staff and student panels
      const { setupStaffQueueChannel, setupStudentQueueChannel } = require('./queueManager');
      await setupStaffQueueChannel(interaction.channel);
      const studentChan = interaction.guild.channels.cache.find(ch => ch.name === 'student-queues');
      if (studentChan) await setupStudentQueueChannel(studentChan);
    } catch (error) {
      console.error("Error editing queue:", error);
      if (!interaction.replied) {
        await interaction.reply({ content: '❗ There was an error updating the queue.', ephemeral: true });
      }
    }
  }

// Export functions
module.exports = {
    handleJoinQueue,
    handleLeaveQueue,
    handleStudentQueueSelect,
    handleClearQueue,
    handleShuffleQueue,
    handleStaffQueueSelect,
    handleCreateQueueModal,
    handleEditQueue,
    handleEditQueueModal,
    handleBlacklistSelect,
    handleBlacklistButton,
    handleDeleteUserButton,
    handleDeleteUserSelect,
    handleCreateQueueButton
};
