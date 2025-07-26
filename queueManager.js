const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

/* ─── In‑memory maps ─────────────────────────────────────────── */
const activeQueue         = new Map(); // guildId -> queue_name chosen by staff
const studentActiveQueue  = new Map(); // key `${guildId}:${userId}` -> queue_name

/* ══════════════════════════════════════════════════════════════ */
/*  UI‑builder helpers                                           */
/* ══════════════════════════════════════════════════════════════ */

/** Build the staff dropdown listing all queues. */
function buildStaffQueueSelector(queues, selectedQueueId) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('staff-queue-selector')
        .setPlaceholder('Select Queue')
        .setMinValues(1)
        .setMaxValues(1);

    queues.forEach(q =>
        menu.addOptions({
            label: `${q.queue_name} (${q.count})`,
            value: String(q.id),
            default: String(q.id) === String(selectedQueueId)
        })
    );

    menu.addOptions({ label: '➕  Create new queue', value: 'create-new' });
    return new ActionRowBuilder().addComponents(menu);
}

/** Dropdown listing every non‑black‑listed user. */
async function buildBlacklistSelector(guild, queueId) {
    // Determine which users are already blacklisted for this queue
    const blRows = await listBlacklisted(guild.id, queueId);
    const blacklistedIds = blRows.map(u => String(u.user_id));

    const members  = await guild.members.fetch({ withPresences: false });
    const menu     = new StringSelectMenuBuilder()
        .setCustomId('blacklist-selector')
        .setPlaceholder('Blacklist users…')
        .setMinValues(0);

    let added = 0;
    for (const m of members.values()) {
        if (added >= 25) break;              // Discord max 25 options
        if (m.user.bot) continue;
        const userId = m.user.id;
        const isBlack = blacklistedIds.includes(userId);
        menu.addOptions({
            label: m.user.username,
            value: userId,
            default: isBlack
        });
        added++;
    }
    // Allow selecting up to the number of available options
    menu.setMaxValues(added);
    return new ActionRowBuilder().addComponents(menu);
}

/** Dropdown listing **current members** of the selected queue so staff can delete them. */
async function buildDeleteSelector(guild, queueName) {
    const members = await getQueue(queueName, guild.id);           // array of user IDs
    const menu    = new StringSelectMenuBuilder()
        .setCustomId('delete-user-selector')
        .setPlaceholder('Choose user(s) to remove…')
        .setMinValues(1)
        .setMaxValues(Math.min(25, members.length));

    for (const uid of members.slice(0, 25)) {
        const member = await guild.members.fetch(uid).catch(() => null);
        if (member) {
            menu.addOptions({ label: member.user.username, value: uid });
        }
    }
    return new ActionRowBuilder().addComponents(menu);
}


/** Student dropdown of queues they can join (filtered by blacklist). */
async function buildStudentQueueSelector(guild, userId) {
    const queues = await listQueues(guild.id);
    const menu   = new StringSelectMenuBuilder()
        .setCustomId('student-queue-selector')
        .setPlaceholder('Choose a queue');

    for (const q of queues) {
        const blocked = await isUserBlacklisted(guild.id, q.id, userId);
        if (!blocked) menu.addOptions({ label: `${q.queue_name} (${q.count})`, value: String(q.id) });
    }
    if (!menu.options.length)
        menu.addOptions({ label: 'No queues available', value: 'none', default: true }).setDisabled(true);

    return new ActionRowBuilder().addComponents(menu);
}

/* ══════════════════════════════════════════════════════════════ */
/*  Panel builders                                                */
/* ══════════════════════════════════════════════════════════════ */

/** Pin / refresh the student panel. */
async function setupStudentQueueChannel(studentChannel, userPreviewId = null) {
    try {
        const queues = await listQueues(studentChannel.guild.id);
        // Build a description of every queue and its members
        let embedDescription;
        if (!queues.length) {
          embedDescription = 'No queues yet.';
        } else {
          const parts = [];
          for (const q of queues) {
            const members = await getQueue(q.queue_name, studentChannel.guild.id);
            const lines = members.length
              ? members.map((u, i) => `${i + 1}. <@${u}>`).join('\n')
              : 'Queue is currently empty.';
              parts.push(
                   `**${q.queue_name}**\n` +
                   `${q.description || '_No description provided._'}\n` +
                   `${lines}`            );
          }
          embedDescription = parts.join('\n\n');
        }

        const embed = new EmbedBuilder()
          .setTitle('Queue Options for Students')
          .setDescription(`Use the menu below to pick a queue, then click **Join** or **Leave**.\n\n${embedDescription}`)
          .setColor('#00b0ff');

        const selectorRow = await buildStudentQueueSelector(
            studentChannel.guild,
            userPreviewId ?? studentChannel.guild.ownerId
        );

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('join-student').setLabel('Join').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('leave-student').setLabel('Leave').setStyle(ButtonStyle.Danger)
        );

        const pinned = await studentChannel.messages.fetchPinned();
        let msg      = pinned.find(m => m.embeds[0]?.title === 'Queue Options for Students');

        msg
          ? await msg.edit({ embeds: [embed], components: [selectorRow, buttons] })
          : await (await studentChannel.send({ embeds: [embed], components: [selectorRow, buttons] })).pin();
    } catch (err) {
        console.error(`Failed to set up student-queues channel (${studentChannel.id}):`, err);
    }
}

/** Pin / refresh the staff panel. */
async function setupStaffQueueChannel(staffChannel, includeBlacklist = false) {
    console.log('DEBUG staff channel:', staffChannel?.id);
    // Show buffering embed while we rebuild
    const bufferingEmbed = new EmbedBuilder()
      .setTitle('Queue Management for Staff')
      .setDescription('Updating queue display... :arrows_counterclockwise:')
      .setColor('#ffcc00');
    const pinnedMsgs = await staffChannel.messages.fetchPinned();
    let bufferMsg = pinnedMsgs.find(m => m.embeds[0]?.title === 'Queue Management for Staff');
    if (bufferMsg) {
      await bufferMsg.edit({ embeds: [bufferingEmbed] });
    } else {
      bufferMsg = await (await staffChannel.send({ embeds: [bufferingEmbed] })).pin();
    }
    // Simulate loading
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
        const queues = await listQueues(staffChannel.guild.id);
        const selectedId = activeQueue.get(staffChannel.guild.id) ?? queues[0]?.id;

        // Build a description of every queue and its members
        let embedDescription;
        if (!queues.length) {
          embedDescription = 'No queues yet.';
        } else {
          const parts = [];
          for (const q of queues) {
            const members = await getQueue(q.queue_name, staffChannel.guild.id);
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
        const embed = new EmbedBuilder()
          .setTitle('Queue Management for Staff')
          .setDescription(embedDescription)
          .setColor('#ffcc00');

        const selectorRow = buildStaffQueueSelector(queues, selectedId);
        const controlRow  = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('shuffle-queue').setLabel('Shuffle queue').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('clear-queue').setLabel('Clear queue').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('queue-blacklist').setLabel('Blacklist Users').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('queue-delete-user').setLabel('Delete User').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('edit-queue').setLabel('Edit queue').setStyle(ButtonStyle.Secondary)
        );
        // Row with single “Create Queue” button
        const createRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('create-queue')
            .setLabel('Create Queue')
            .setStyle(ButtonStyle.Success)
        );
        let blacklistRow;
        if (includeBlacklist) {
          blacklistRow = await buildBlacklistSelector(staffChannel.guild, selectedId);
        }

        const fallback = selectedId;

        const pinnedAfter = await staffChannel.messages.fetchPinned();
        let finalMsg = pinnedAfter.find(m => m.embeds[0]?.title === 'Queue Management for Staff');
        const components = [selectorRow, controlRow, createRow];
        if (includeBlacklist) components.push(blacklistRow);
        if (finalMsg) {
          await finalMsg.edit({ embeds: [embed], components });
        } else {
          await (await staffChannel.send({ embeds: [embed], components })).pin();
        }
        const allPins = await staffChannel.messages.fetchPinned();
        for (const msg of allPins.values()) {
            if (
                msg.id !== finalMsg.id &&
                msg.embeds[0]?.title === 'Queue Management for Staff'
            ) {
                await msg.unpin().catch(() => null);
            }
        }
    } catch (err) {
        console.error(`Failed to set up staff-queues channel (${staffChannel.id}):`, err);
    }
}

/* ══════════════════════════════════════════════════════════════ */
/*  Database helpers                                              */
/* ══════════════════════════════════════════════════════════════ */

/** Add a user to default studentQueue (legacy wrapper). */
async function addStudent(serverId, queueName, userId) {
    await pool.query(`
       INSERT INTO queues (server_id, queue_name, members)
       VALUES ($1, $2, ARRAY[$3])
       ON CONFLICT (server_id, queue_name)
       DO UPDATE SET members = array_append(queues.members, $3)
       WHERE NOT ($3 = ANY(queues.members))
   `, [serverId, queueName, userId]);
}

async function removeStudent(serverId, queueName, userId) {
    await pool.query(`
       UPDATE queues
       SET members = array_remove(members, $1)
       WHERE server_id = $2 AND queue_name = $3
   `, [userId, serverId, queueName]);
}

async function shuffleQueue(serverId, queueName) {
    await pool.query(`
        UPDATE queues
        SET members = (SELECT array_agg(m ORDER BY random()) FROM unnest(members) AS m)
        WHERE server_id = $1 AND queue_name = $2
    `, [serverId, queueName]);
}

async function clearQueue(serverId, queueName) {
    await pool.query(`
        UPDATE queues
        SET members = '{}'
        WHERE server_id = $1 AND queue_name = $2
    `, [serverId, queueName]);
}

async function getQueue(queueName, serverId) {
    const { rows } = await pool.query(`
        SELECT members FROM queues
        WHERE server_id = $1 AND queue_name = $2
    `, [serverId, queueName]);
    return rows.length ? rows[0].members : [];
}

/** List all queues for a server (name + member count). */
async function listQueues(serverId) {
    const { rows } = await pool.query(`
        SELECT id, queue_name, description, COALESCE(array_length(members, 1), 0) AS count
        FROM queues
        WHERE server_id = $1
        ORDER BY queue_name
    `, [serverId]);
    return rows;
}

/**
 * Create a new queue with no members.
 */
async function createQueue(serverId, queueName, description) {  await pool.query(`
    INSERT INTO queues (server_id, queue_name, members, description)    
    VALUES ($1, $2, '{}', $3)
    ON CONFLICT (server_id, queue_name) DO NOTHING
  `, [serverId, queueName, description]);
}

/**
 * Update a queue’s name and description.
 */
async function updateQueue(queueId, newName, newDescription) {
    await pool.query(`
      UPDATE queues
      SET queue_name = $1, description = $2
      WHERE id = $3
    `, [newName, newDescription, queueId]);
  }

/* ===== Blacklist helpers (queue_id‑based) ==================== */

/**
 * Add a user to the blacklist for a given queue ID.
 */
async function blacklistUser(serverId, queueId, userId) {
    await pool.query(`
        INSERT INTO blacklisted_users (server_id, queue_id, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (server_id, queue_id, user_id) DO NOTHING
    `, [serverId, queueId, userId]);
}

/**
 * Remove a user from the blacklist (un-blacklist).
 */
async function unblacklistUser(serverId, queueId, userId) {
    await pool.query(`
        DELETE FROM blacklisted_users
        WHERE server_id = $1 AND queue_id = $2 AND user_id = $3
    `, [serverId, queueId, userId]);
  }


/**
 * Return true if user is black‑listed from the queue.
 */
async function isUserBlacklisted(serverId, queueId, userId) {
    const { rows } = await pool.query(`
        SELECT 1 FROM blacklisted_users
        WHERE server_id = $1 AND queue_id = $2 AND user_id = $3
    `, [serverId, queueId, userId]);
    return rows.length > 0;
}

/**
 * Get all black‑listed users for a queue.
 */
async function listBlacklisted(serverId, queueId) {
    const { rows } = await pool.query(`
        SELECT user_id FROM blacklisted_users
        WHERE server_id = $1 AND queue_id = $2
    `, [serverId, queueId]);
    return rows;  // [{ user_id }]
}

/* ══════════════════════════════════════════════════════════════ */
/*  Exports                                                      */
/* ══════════════════════════════════════════════════════════════ */

module.exports = {
    // state maps
    activeQueue,
    studentActiveQueue,

    // UI builders & panel setup
    buildStaffQueueSelector,
    buildStudentQueueSelector,
    buildBlacklistSelector,
    buildDeleteSelector,
    setupStudentQueueChannel,
    setupStaffQueueChannel,

    // DB helpers
    addStudent,
    removeStudent,
    shuffleQueue,
    clearQueue,
    getQueue,
    listQueues,
    createQueue,
    updateQueue,
    listBlacklisted,
    blacklistUser,
    unblacklistUser,
    isUserBlacklisted
};
