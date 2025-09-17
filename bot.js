const {
    Client, GatewayIntentBits, Partials, ChannelType, REST, Routes, EmbedBuilder, PermissionsBitField, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
require('dotenv').config();
// Log – and don't crash – if any promise is rejected without a catch
process.on('unhandledRejection', err => {
  console.error('Unhandled promise rejection:', err);
});
const { handleDmMessage } = require('./features/dmHistory');
const fs = require('fs');
const path = require('path');
const {
  handleJoinQueue,
  handleLeaveQueue,
  handleStudentQueueSelect,
  handleStaffQueueSelect,
  handleCreateQueueModal,
  handleEditQueue,
  handleEditQueueModal,
  handleShuffleQueue,
  handleClearQueue,
  handleBlacklistSelect,
  handleBlacklistButton,
  handleDeleteUserButton,
  handleDeleteUserSelect,
  handleCreateQueueButton
} = require('./queueOperations');
  
const { ACCESS_TOKEN_DISCORD, CLIENT_ID } = process.env;
const COMMAND_SCOPE = (process.env.COMMAND_SCOPE || 'guild').toLowerCase(); // 'guild' | 'global' | 'both'
const BACKFILL_ON_START = (process.env.BACKFILL_ON_START || 'false').toLowerCase() === 'true';

const ensureRolesForGuild = require('./ensureRoles.js');
const assignRolesToMember = require('./assignRoles.js');
// Alias channel helpers locally to avoid any potential name collisions in Node 22
const { getChannelByKey: getChKey, ensureChannelName: ensureChName } = require('./channels');
const handleCodeReview = require('./features/codeReview');
const handleDMResponse = require('./features/dmResponse');
const handleGeneralQuestion = require('./features/generalQuestion');
const createEventFeature = require('./features/createEvents');
const queueManager = require('./queueManager');
const studyTips = require('./features/studyTips');
const { setupStudentQueueChannel, setupStaffQueueChannel } = queueManager;
const { activeQueue } = queueManager;   // use the shared map from queueManager

const clientDB = require('./database');
const { ensureSchema } = require('./dbInit');
const premium = require('./premium');

/**
 * Backfill all past messages from a text channel into Postgres.
 */
async function backfillChannel(channel) {
  let lastId;
  while (true) {
    const options = { limit: 100, before: lastId };
    let messages;
    try {
      messages = await channel.messages.fetch(options);
    } catch (err) {
      // 50001 = Missing Access → skip this channel and carry on
      if (err.code === 50001) {
        console.warn(`Skipping ${channel.guild?.name ?? 'unknown'}#${channel.name} – missing access`);
        return;
      }
      throw err;                     // bubble up anything unexpected
    }
    if (!messages.size) break;
    for (const msg of messages.values()) {
      if (msg.author.bot) continue;
      await clientDB.query(
        `INSERT INTO public_messages
           (id, guild_id, channel_id, author_id, author_tag, content, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          msg.id,
          msg.guildId,
          msg.channelId,
          msg.author.id,
          msg.author.tag,
          msg.content.trim(),
          msg.createdAt
        ]
      );
    }
    lastId = messages.last().id;
    // Pause briefly to respect rate limits
    await new Promise(res => setTimeout(res, 500));
  }
}

/**
 * Loop through every text channel in the guild and backfill history.
 */
async function backfillGuildHistory(guild) {
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildText) {
      console.log(`Backfilling ${guild.name}#${channel.name}`);
      await backfillChannel(channel);
    }
  }
}

clientDB.query('SELECT NOW()')
    .then(async (res) => {
      console.log(`Database connected. Server time: ${res.rows[0].now}`);
      try {
        await ensureSchema(clientDB);
        console.log('Database schema ensured.');
      } catch (e) {
        console.error('Failed ensuring DB schema:', e);
      }
    })
    .catch(err => console.error('Database connection error:', err));

// Documentation channel messages
const { t, getGuildLocale, channelName } = require('./i18n');
async function staffMessageFor(guild) {
  const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
  const base = t(locale, 'docs.staff');
  const extra = `\n\n**AI Tips (Premium 🔒)**\n• Enable unique study tips: /study_tips set_ai mode:on.\n• Disable: /study_tips set_ai mode:off.`;
  return base + extra;
}
async function studentMessageFor(guild) {
  const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
  const base = t(locale, 'docs.student');
  const extra = `\n\n**Study tips**\nYour server may send periodic reminders. When Premium is enabled, these can include a short AI‑generated tip for motivation.`;
  return base + extra;
}

// Initialise the bot client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel],
});

// Map of command objects keyed by their name
client.commands = new Map();

// Load all slash commands
const commands = [];
const commandsPath = path.join(__dirname, 'features');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.data.name) {
        commands.push(command.data.toJSON());
        client.commands.set(command.data.name, command);
    }
}

async function refreshChannels(guild) {
    console.log(`Refreshing channels for ${guild.name}...`);
    // Re-ensure that the student and staff channels are set up with updated permissions and documentation
    await ensureStudentQueueChannel(guild);
    await ensureStaffQueueChannel(guild);
    await setupDocumentationChannels(guild);
    // Also ensure the Study Tips settings channel/panel exists
    try { await studyTips._helpers.ensureSettingsForGuild(guild); } catch (e) { console.warn('Failed to ensure study-tip-settings:', e.message); }
}

// Post-install permission health check with a re‑invite button
async function checkGuildPermissions(guild) {
  try {
    const me = guild.members.me;
    if (!me) return;
    if (me.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    const needed = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.CreatePrivateThreads,
    ]);
    const missing = [];
    for (const [name, flag] of Object.entries(PermissionsBitField.Flags)) {
      if (!needed.has(flag)) continue;
      if (!me.permissions.has(flag)) missing.push(name);
    }
    if (!missing.length) return;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${needed.bitfield}&scope=bot%20applications.commands`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Fix Permissions').setURL(inviteUrl),
      new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId('run-setup-again').setLabel('Run setup again')
    );
    const content = `I’m missing some permissions and may not work correctly.\nMissing: ${missing.join(', ')}\nUse “Fix Permissions” to grant access, then click “Run setup again”.`;
    let target = guild.systemChannel;
    if (!target) {
      target = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages));
    }
    if (target) await target.send({ content, components: [row] }).catch(() => {});
  } catch (err) {
    console.error('Permission health‑check failed:', err);
  }
}

/**
 * Sets up the documentation channels (staff-docs and student-docs) under a "Jeffrey Documentation" category.
 */
async function setupDocumentationChannels(guild) {
    try {
        console.log(`Setting up documentation channels for ${guild.name}...`);
        const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
        let category = getChKey(guild, 'category_docs', ChannelType.GuildCategory);

        // Create the category if it doesn’t exist
        if (!category) {
            console.log('Creating "Jeffrey Documentation" category...');
            category = await guild.channels.create({
                name: channelName(locale, 'category_docs'),
                type: ChannelType.GuildCategory,
            });
        } else { await ensureChName(guild, category, 'category_docs'); }

        // Create the staff-docs channel if it doesn’t exist
        let staffChannel = getChKey(guild, 'channel_staff_docs', ChannelType.GuildText);
        if (!staffChannel) {
            console.log('Creating staff-docs channel...');
            const staffRole = guild.roles.cache.find(role => role.name === 'Staff');
            staffChannel = await guild.channels.create({
                name: channelName(locale, 'channel_staff_docs'),
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
                    ...(staffRole ? [{ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
                ],
            });
        } else { await ensureChName(guild, staffChannel, 'channel_staff_docs'); }

        // Ensure bot overwrite exists for staff-docs
        try {
          const botId = client.user.id;
          if (!staffChannel.permissionOverwrites.cache.has(botId)) {
            await staffChannel.permissionOverwrites.edit(botId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ManageChannels: true,
            });
          }
        } catch (_) {}

        // Create the student-docs channel if it doesn’t exist
        let studentChannel = getChKey(guild, 'channel_student_docs', ChannelType.GuildText);
        if (!studentChannel) {
            console.log('Creating student-docs channel...');
            const studentRole = guild.roles.cache.find(role => role.name === 'Students');
            const staffRole = guild.roles.cache.find(role => role.name === 'Staff');
            studentChannel = await guild.channels.create({
                name: channelName(locale, 'channel_student_docs'),
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
                    ...(studentRole ? [{ id: studentRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
                    ...(staffRole   ? [{ id: staffRole.id,   allow: [PermissionFlagsBits.ViewChannel] }] : []),
                ],
            });
        } else { await ensureChName(guild, studentChannel, 'channel_student_docs'); }

        // Ensure bot overwrite exists for student-docs
        try {
          const botId = client.user.id;
          if (!studentChannel.permissionOverwrites.cache.has(botId)) {
            await studentChannel.permissionOverwrites.edit(botId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ManageChannels: true,
            });
          }
        } catch (_) {}

        // Post or update documentation messages with pinned behavior
        await updateDocumentationMessage(guild, 'channel_staff_docs', await staffMessageFor(guild));
        await updateDocumentationMessage(guild, 'channel_student_docs', await studentMessageFor(guild));

        console.log(`Documentation channels setup complete for ${guild.name}.`);
    } catch (error) {
        console.error(`Error setting up documentation channels for ${guild.name}:`, error);
    }
}

/**
 * Clears old messages in a given doc channel and sends updated doc text.
 */
async function updateDocumentationMessage(guild, channelKey, content) {
    const channel = getChKey(guild, channelKey, ChannelType.GuildText);
    if (!channel) return;

    try {
        // Fetch pinned messages in the channel
        const pinnedMessages = await channel.messages.fetchPinned();
        // If content exceeds Discord's 2000‑char limit, split into chunks and pin the first
        const MAX = 1900;
        const needsSplit = content.length > MAX;
        const chunks = needsSplit
          ? (() => {
              const paras = content.split(/\n\n/);
              const out = [];
              let cur = '';
              for (const p of paras) {
                if ((cur + (cur ? '\n\n' : '') + p).length > MAX) {
                  if (cur) out.push(cur);
                  cur = p;
                } else {
                  cur = cur ? cur + '\n\n' + p : p;
                }
              }
              if (cur) out.push(cur);
              return out;
            })()
          : [content];
        const firstChunk = chunks[0];
        const existingMessage = pinnedMessages.find(msg => msg.content === firstChunk);

        if (existingMessage) {
            // Update the existing pinned message if content differs (first chunk only)
            if (existingMessage.content !== firstChunk) {
                await existingMessage.edit(firstChunk);
                console.log(`Updated pinned message in ${channelKey} for ${guild.name}.`);
            } else {
                console.log(`Pinned message in ${channelKey} is already up to date for ${guild.name}.`);
            }
        } else {
            // Send a new message and pin it if no matching message exists
            const message = await channel.send(firstChunk);
            await message.pin();
            console.log(`Pinned new documentation message in ${channelKey} for ${guild.name}.`);

            // Unpin old messages (if any)
            for (const msg of pinnedMessages.values()) {
                if (msg.id !== message.id) {
                    await msg.unpin();
                    console.log(`Unpinned outdated message in ${channelKey} for ${guild.name}.`);
                }
            }
            // Send any remaining chunks as normal messages under the panel
            if (chunks.length > 1) {
              for (let i = 1; i < chunks.length; i++) {
                await channel.send(chunks[i]);
              }
            }
        }
    } catch (err) {
        console.error(`Failed to update messages in ${channelKey} for ${guild.name}:`, err);
    }
}

/**
 * When the bot comes online, register slash commands, then ensure
 * roles, documentation channels, and queue channels for every guild.
 */
client.once('ready', async () => {
    console.log(`The AI bot is online as ${client.user.tag}`);

    // Register commands globally
    const rest = new REST({ version: '10' }).setToken(ACCESS_TOKEN_DISCORD);
    try {
        if (COMMAND_SCOPE === 'global' || COMMAND_SCOPE === 'both') {
          console.log('Registering application (/) commands globally...');
          await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
          console.log('Successfully registered application (/) commands globally.');
        } else {
          console.log('Skipping global registration (COMMAND_SCOPE!=global/both).');
        }

        if (COMMAND_SCOPE === 'guild' || COMMAND_SCOPE === 'both') {
          // Register per‑guild for instant availability
          for (const [gid, guild] of client.guilds.cache) {
            try {
              await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body: commands });
              console.log(`Registered guild commands for ${guild.name} (${gid}).`);
            } catch (e) {
              console.warn(`Guild command registration failed for ${gid}:`, e?.status || e?.code || e);
            }
          }
        } else {
          console.log('Skipping per‑guild registration (COMMAND_SCOPE=global).');
        }
        /* ---------- Auto‑generated invite link ---------- */
        // Define the permissions your bot absolutely needs. 
        // Adjust this list if you add/remove features later.
        const requiredPerms = new PermissionsBitField([
          PermissionsBitField.Flags.Administrator,          // NEW – ensures bot sees every channel
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageRoles,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.AddReactions
        ]);

        const inviteUrl =
          `https://discord.com/api/oauth2/authorize` +
          `?client_id=${CLIENT_ID}` +
          `&permissions=${requiredPerms.bitfield}` +
          `&scope=bot%20applications.commands`;

        console.log('\n=== Invite Jeffrey to your server ===');
        console.log(inviteUrl);
        console.log('====================================\n');
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // ─── Study‑tips scheduler loop ─────────────────────────────────────────
    try {
      await require('./features/studyTips')._helpers.ensureTable();
      setInterval(async () => {
        try {
          const due = (await clientDB.query(
            `SELECT * FROM study_tips WHERE enabled=true AND next_send_at IS NOT NULL AND next_send_at <= NOW()`
          )).rows;
          for (const row of due) {
            const guild = client.guilds.cache.get(row.guild_id);
            if (!guild) continue;
            let channel = row.target_channel_id ? guild.channels.cache.get(row.target_channel_id) : null;
            if (!channel) channel = require('./channels').getChannelByKey(guild, 'channel_student_docs', ChannelType.GuildText) || guild.systemChannel;
            if (!channel) continue;
            let content = '⏰ Study time! Take 25 minutes to focus on your studies. When you’re done, take a 5‑minute break.';
            try {
              if (row.ai_enabled && process.env.OPENAI_API_KEY) {
                // Guild must be entitled (or whitelisted) to use AI tips
                const entitled = await premium.hasPremiumAccess({ guildId: guild.id });
                if (!entitled) throw new Error('premium-required');
                const { getGuildLocale } = require('./i18n');
                const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
                const { getOpenAIResponse } = require('./features/openaiService');
                const prompt = 'Create a unique, encouraging study tip or motivation for students starting a focused study block. 1–2 short sentences, friendly, no hashtags, no links. Vary topics (focus, breaks, recall, goal setting, mindset).';
                const tip = await getOpenAIResponse(prompt, 120, locale);
                content = `⏰ Study time! ${tip}`.slice(0, 1800);
              }
            } catch (e) {
              if (e && e.message === 'premium-required') {
                console.warn('AI tips skipped (premium required)');
              } else {
                console.warn('AI tip generation failed, using default:', e.message);
              }
            }
            await channel.send(content);

            const t = studyTips._helpers.parseHHMM(row.time_of_day) || { hour: 12, minute: 0 };
            // Compute next schedule from now using configured TZ and frequency
            const nextAt = studyTips._helpers.computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: row.timezone || 'UTC', plusDays: row.frequency_days - 1 });
            await clientDB.query('UPDATE study_tips SET last_sent_at=NOW(), next_send_at=$2 WHERE guild_id=$1', [row.guild_id, nextAt]);
          }
        } catch (e) {
          console.warn('study‑tips tick failed:', e.message);
        }
      }, 60 * 1000);
    } catch (e) {
      console.warn('Could not start study‑tips scheduler:', e.message);
    }

    // For each guild the bot is in, ensure roles and refresh channels
    for (const [_, guild] of client.guilds.cache) {
        await ensureRolesForGuild(guild);
        // Ensure the bot has Staff privileges (and never Students)
        try {
          const botMember   = guild.members.me;
          const staffRole   = guild.roles.cache.find(r => r.name === 'Staff');
          const studentRole = guild.roles.cache.find(r => r.name === 'Students');
          if (botMember) {
            if (studentRole && botMember.roles.cache.has(studentRole.id)) {
              await botMember.roles.remove(studentRole);
              console.log("Removed 'Students' role from bot.");
            }
            if (staffRole && !botMember.roles.cache.has(staffRole.id)) {
              await botMember.roles.add(staffRole);
              console.log("Assigned 'Staff' role to bot.");
            }
          }
        } catch (err) {
          console.error('Failed to enforce Staff role for bot:', err);
        }
        // Sync roles for all *human* members (skip bots) so they get the Students role if applicable
        const allMembers = await guild.members.fetch();
        for (const member of allMembers.values()) {
          if (member.user.bot) continue;
          await assignRolesToMember(member);
        }
        await refreshChannels(guild);
        await checkGuildPermissions(guild);
        // Backfill historical messages for this guild (optional)
        if (BACKFILL_ON_START) {
          console.log(`Starting backfill for ${guild.name}...`);
          await backfillGuildHistory(guild);
          console.log(`Backfill complete for ${guild.name}.`);
        } else {
          console.log(`Skipping backfill for ${guild.name} (BACKFILL_ON_START=false).`);
        }
    }
});

/**
 * On joining a new guild, automatically set up roles, docs, and queue channel.
 */
client.on('guildCreate', async (guild) => {
    console.log(`Bot added to a new server: ${guild.name}`);
    await ensureRolesForGuild(guild);
    await setupDocumentationChannels(guild);
    await ensureStudentQueueChannel(guild);
    await ensureStaffQueueChannel(guild);
    await checkGuildPermissions(guild);
    // Register commands for this guild immediately so slash commands are available at once
    try {
      if (COMMAND_SCOPE === 'guild' || COMMAND_SCOPE === 'both') {
        const rest = new REST({ version: '10' }).setToken(ACCESS_TOKEN_DISCORD);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), { body: commands });
        console.log(`Registered guild commands for ${guild.name} (${guild.id}).`);
      } else {
        console.log('COMMAND_SCOPE=global → skipping per‑guild registration on guildCreate');
      }
    } catch (e) {
      console.warn('Guild command registration failed:', e?.status || e?.code || e);
    }
});

/**
 * Assigns roles to new members.
 */
client.on('guildMemberAdd', async (member) => {
    console.log(`New member joined: ${member.user.tag}`);

    // If a bot joins, do NOT assign Students. For THIS bot ensure Staff role only.
    if (member.user.bot) {
        const staffRole   = member.guild.roles.cache.find(r => r.name === 'Staff');
        const studentRole = member.guild.roles.cache.find(r => r.name === 'Students');

        if (studentRole && member.roles.cache.has(studentRole.id)) {
            try {
                await member.roles.remove(studentRole);
                console.log(`Removed 'Students' role from bot ${member.user.tag}`);
            } catch (err) {
                console.error(`Failed to remove 'Students' from bot ${member.user.tag}:`, err);
            }
        }
        if (staffRole && !member.roles.cache.has(staffRole.id)) {
            try {
                await member.roles.add(staffRole);
                console.log(`Assigned 'Staff' role to bot ${member.user.tag}`);
            } catch (err) {
                console.error(`Failed to assign 'Staff' to bot ${member.user.tag}:`, err);
            }
        }
        return; // Done handling bots
    }

    await assignRolesToMember(member);

    // Fetch the Students role from the guild
    const studentRole = member.guild.roles.cache.find(role => role.name === 'Students');

    // If the studentRole exists and the member doesn't already have it, assign it
    if (studentRole && !member.roles.cache.has(studentRole.id)) {
        try {
            await member.roles.add(studentRole);
            console.log(`Assigned 'Students' role to ${member.user.tag}`);
        } catch (err) {
            console.error(`Failed to assign 'Students' role to ${member.user.tag}:`, err);
        }
    }

    // Now ensure that if the member is a student, the student channels are created/updated
    if (studentRole && member.roles.cache.has(studentRole.id)) {
        await ensureStudentQueueChannel(member.guild);
        await updateDocumentationMessage(member.guild, 'channel_student_docs', await studentMessageFor(member.guild));
    }
});

/**
 * Ensures the 'student-queues' channel exists, visible only to Students.
 */
async function ensureStudentQueueChannel(guild) {
    try {
        // Check if the 'student-queues' channel exists
        let studentQueueChannel = getChKey(guild, 'channel_student_queues', ChannelType.GuildText);

        // Find the Students role and ensure it exists
        let studentRole = guild.roles.cache.find(role => role.name.toLowerCase() === 'students');
        if (!studentRole) {
            console.log(`Students role not found in ${guild.name}. Creating it...`);
            studentRole = await guild.roles.create({
                name: 'Students',
                permissions: []
            });
        }

        // If the channel doesn't exist, create it with the appropriate permission overwrites
        if (!studentQueueChannel) {
            console.log(`Creating "student-queues" channel in ${guild.name}...`);
            const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
            studentQueueChannel = await guild.channels.create({
                name: channelName(locale, 'channel_student_queues'),
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
                    ...(studentRole
                        ? [
                              {
                                  id: studentRole.id,
                                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                              },
                          ]
                        : []),
                ],
            });
            console.log(`Created "student-queues" channel in ${guild.name} (${studentQueueChannel.id})`);
        } else {
            await ensureChName(guild, studentQueueChannel, 'channel_student_queues');
            // If the channel exists, ensure its permission overwrites include the Students role
            if (studentRole) {
                const hasStudentOverwrite = studentQueueChannel.permissionOverwrites.cache.has(studentRole.id);
                if (!hasStudentOverwrite) {
                    await studentQueueChannel.permissionOverwrites.edit(studentRole, {
                      ViewChannel: true,
                      SendMessages: true,
                    });
                    console.log(`Updated "student-queues" channel permissions to include Students role in ${guild.name}.`);
                }
            }
        }

        // Guarantee the bot can always see / edit the channel
        const botId = client.user.id;
        if (!studentQueueChannel.permissionOverwrites.cache.has(botId)) {
            await studentQueueChannel.permissionOverwrites.edit(botId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ManageChannels: true,
            });
        }

        // Post or update the channel with the student queue message
        await queueManager.setupStudentQueueChannel(studentQueueChannel);
            return studentQueueChannel;
    } catch (error) {
        console.error(`Failed to ensure "student-queues" channel for ${guild.name}:`, error);
    }
}

/**
 * Ensures the 'staff-queues' channel exists, visible only to Staff.
 */
async function ensureStaffQueueChannel(guild) {
    try {
        // Check if the 'staff-queues' channel exists
        let staffQueueChannel = getChKey(guild, 'channel_staff_queues', ChannelType.GuildText);

        // Find the Staff role
        const staffRole = guild.roles.cache.find(role => role.name === 'Staff');

        // If the channel doesn't exist, create it
        if (!staffQueueChannel) {
            console.log(`Creating "staff-queues" channel in ${guild.name}...`);
            const locale = await getGuildLocale(guild.id, guild.preferredLocale || 'en-US');
            staffQueueChannel = await guild.channels.create({
                name: channelName(locale, 'channel_staff_queues'),
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] },
                    ...(staffRole
                        ? [
                              {
                                  id: staffRole.id,
                                  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                              },
                          ]
                        : []),
                ],
            });
            console.log(`Created "staff-queues" channel in ${guild.name} (${staffQueueChannel.id})`);
        } else { await ensureChName(guild, staffQueueChannel, 'channel_staff_queues'); }

        // Make sure the bot’s overwrite is present
        const botId = client.user.id;
        if (!staffQueueChannel.permissionOverwrites.cache.has(botId)) {
            await staffQueueChannel.permissionOverwrites.edit(botId, {
              ViewChannel: true,
              SendMessages: true,
              ManageMessages: true,
              ManageChannels: true,
            });
        }

        // Post or update the channel with the staff queue message
        await queueManager.setupStaffQueueChannel(staffQueueChannel);
            return staffQueueChannel;
    } catch (error) {
        console.error(`Failed to ensure "staff-queues" channel for ${guild.name}:`, error);
    }
}

/**
 * Handle the /history slash-command by turning the sub-command + options
 * into the natural-language question strings already understood by
 * handleDmMessage(), then piping it through that parser.
 */
async function handleHistorySlash(interaction) {
    // Work out which guild’s history we should search.
    // • If the command is invoked inside a server channel we already have
    //   `interaction.guild`.
    // • If it’s invoked from a DM we attempt to find the *first* guild
    //   that both the user and the bot share.
    //   (That’s good enough for single‑server classrooms; for multiple
    //   mutual servers you may want to add a guild selector later.)
    let guild = interaction.guild;
    if (!guild) {
      for (const g of interaction.client.guilds.cache.values()) {
        try {
          await g.members.fetch(interaction.user.id); // throws if user not in guild
          guild = g;
          break;
        } catch (_) {
          /* not a mutual guild – keep looking */
        }
      }
      if (!guild) {
        return interaction.reply({
          content: '⛔ I couldn’t find a server we both belong to. Please invite me to the server and try again.',
          ephemeral: true,
        });
      }
    }
    const guildId = guild.id;

    // Premium Apps: require user entitlement, but allow test whitelist by guild
    try {
      const ok = await premium.hasPremiumAccess({ userId: interaction.user.id, guildId });
      if (!ok) {
        const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
        return interaction.reply({ content: `🔒 Premium required. ${link}`, ephemeral: true });
      }
    } catch (e) {
      // Fail closed to avoid accidental free access if entitlement check errors
      return interaction.reply({ content: '🔒 Premium required. Please try again later.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    let query;
  
    switch (sub) {
      case 'last_mentioned':
        query = `When was ${interaction.options.getString('term')} last mentioned?`;
        break;
      case 'keyword_between': {
        const term      = interaction.options.getString('term');
        const startStr  = interaction.options.getString('start');
        const endStr    = interaction.options.getString('end');

        // Basic YYYY‑MM‑DD check
        const startDate = new Date(startStr);
        const endDate   = new Date(endStr);
        if (isNaN(startDate) || isNaN(endDate)) {
          return interaction.reply({
            content: '⛔ Invalid date format. Please use YYYY‑MM‑DD.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          // Include the whole end day by adding 24h
          const { rows } = await clientDB.query(
            `SELECT author_tag, content, ts
               FROM public_messages
              WHERE guild_id = $1
                AND tsv @@ plainto_tsquery('english',$2)
                AND ts BETWEEN $3 AND $4
              ORDER BY ts`,
            [ guildId, term, startDate, new Date(endDate.getTime() + 24 * 60 * 60 * 1000) ]
          );

          const count = rows.length;
          let response =
            `${term} was mentioned **${count}** time(s) between ` +
            `${startStr} and ${endStr}.`;

          if (count > 0) {
            // Show up to the first 10 results
            const preview = rows.slice(0, 10).map(r =>
              `• **${r.author_tag}** at <t:${Math.floor(new Date(r.ts).getTime() / 1000)}:f> – ${r.content}`
            ).join('\n');

            // First / last
            const firstTs = rows[0].ts;
            const lastTs  = rows[rows.length - 1].ts;

            response += `\nFirst: <t:${Math.floor(new Date(firstTs).getTime() / 1000)}:f>`;
            response += `\nLast:  <t:${Math.floor(new Date(lastTs ).getTime() / 1000)}:f>`;
            response += `\n\n${preview}`;
            if (count > 10) response += `\n…and **${count - 10}** more.`;
          } else {
            response += `\n\n_No matching messages were found in that period._`;
          }

          await interaction.editReply({ content: response });
        } catch (err) {
          console.error('keyword_between query failed:', err);
          await interaction.editReply({
            content: 'Sorry, something went wrong fetching that history.',
          });
        }
        return; // handled – skip the generic dmHistory fallback
      }
      case 'channel_discussed_period': {
        // ── 1. Resolve which channel to search ──────────────────────────────
        let ch = interaction.options.getChannel('channel');
        if (!ch) {
          ch =
            guild.systemChannel ||
            guild.channels.cache.find(
              c => c.type === ChannelType.GuildText && c.name === 'general'
            ) ||
            guild.channels.cache.find(c => c.type === ChannelType.GuildText);
        }
        if (!ch) {
          return interaction.reply({
            content: '⛔ I couldn’t find a text channel to search in this server.',
            ephemeral: true,
          });
        }

        // ── 2. Work out time‑window based on period selector ────────────────
        // periodChoice: "yesterday", "today", "last week"
        // "last week" means the last 7×24h window, starting 00:00 seven days ago, up to now.
        const periodChoice = (interaction.options.getString('period') || 'last week').toLowerCase();
        const now       = new Date();
        let   startDate = new Date();
        let   endDate   = new Date();           // defaults to “now”

        switch (periodChoice) {
          case 'yesterday': {                   // 00:00 → 23:59 of the previous day
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);
            break;
          }
          case 'today': {                    // midnight today → now
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            // endDate stays as “now”
            break;
          }
          case 'last week': {                   // 7 * 24 hours up to “now”
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);     // midnight at start
            // endDate stays as “now”
            break;
          }
          default: {                            // fallback: last 7 days (not normalized to midnight)
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            break;
          }
        }

        await interaction.deferReply({ ephemeral: true });

        // ── 3. Fetch messages from Postgres ─────────────────────────────────
        try {
          const { rows } = await clientDB.query(
            `SELECT content
               FROM public_messages
              WHERE guild_id   = $1
                AND channel_id = $2
                AND ts BETWEEN $3 AND $4`,
            [guildId, ch.id, startDate, endDate]
          );

          if (!rows.length) {
            return interaction.editReply({
              content: `Nothing was posted in #${ch.name} during that period.`,
            });
          }

          // ── 4. Tiny summary: top 5 keywords (excluding stop‑words) ───────
          const stop = new Set([
            'the','and','a','an','to','of','in','it','is','for','on','that',
            'this','with','i','you','we','they','he','she','at','by','be',
            'was','were','are','from','as','but','or','if','so','not','have',
            'has','had','our','your','my','me'
          ]);
          const counts = {};
          for (const r of rows) {
            for (const word of r.content
              .toLowerCase()
              .replace(/[`*_~>|<@\d:,.\-?!()\[\]{}]/g, ' ')
              .split(/\s+/)
            ) {
              if (word.length < 3 || stop.has(word)) continue;
              counts[word] = (counts[word] || 0) + 1;
            }
          }

          const topics = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([w]) => w);

          // Helper to join words nicely: "a, b and c"
          const humanList = arr => {
            if (arr.length === 0) return '';
            if (arr.length === 1) return arr[0];
            if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
            return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
          };

          const summary =
            topics.length
              ? `During this period the conversation mainly revolved around **${humanList(topics)}**.`
              : 'Messages were too varied for a clear one‑sentence summary.';

          // ── 5. Craft the response ────────────────────────────────────────
          await interaction.editReply({
            content:
              `I found **${rows.length}** messages in <#${ch.id}> ` +
              `between <t:${Math.floor(startDate.getTime() / 1000)}:d> ` +
              `and <t:${Math.floor(endDate.getTime()   / 1000)}:d>.\n` +
              summary
          });
        } catch (err) {
          console.error('channel_discussed_period query failed:', err);
          await interaction.editReply({
            content: 'Sorry, something went wrong fetching that history.',
          });
        }
        return; // handled – skip the dmHistory fallback
      }
      default:
        return interaction.reply({ content: '⛔ Unknown history query.', ephemeral: true });
    }
  
    await interaction.deferReply({ ephemeral: true });
  
    // Lightweight stub satisfying dmHistory expectations
    const fakeMsg = {
      content: query,
      client: interaction.client,
      guildId, // hint the target guild for accurate DB queries
      reply: (content) => interaction.followUp({ content, ephemeral: true })
    };
  
    try {
      await handleDmMessage(fakeMsg);
    } catch (err) {
      console.error('History slash command failed:', err);
      await interaction.followUp({ content: 'Sorry, something went wrong.', ephemeral: true });
    }
  }


/**
 * Handle button interactions in the queue channel.
 */
client.on('interactionCreate', async (interaction) => {
    // (language autocomplete removed)

    // ─── Slash commands ────────────────────────────────
    if (interaction.isChatInputCommand()) {
        // /smart_search is implemented as a bespoke handler
        if (interaction.commandName === 'smart_search') {
            await handleHistorySlash(interaction);
            return;
        }

        // All other slash commands loaded from /features
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            await interaction.reply({ content: '⛔ Unknown command.', ephemeral: true });
            return;
        }

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(`Error running /${interaction.commandName}:`, err);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: 'Sorry, something went wrong.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Sorry, something went wrong.', ephemeral: true });
            }
        }
        return; // done with slash commands
    }

    if (interaction.isModalSubmit() && interaction.customId === 'create-queue-modal') {
        await handleCreateQueueModal(interaction);
        return;
    }
    // Handle event creation modal
    if (interaction.isModalSubmit() && interaction.customId === 'createEventModal') {
        try {
            await createEventFeature.handleModalSubmit(interaction);
        } catch (err) {
            console.error('Error handling createEventModal submission:', err);
            if (!interaction.replied) {
                await interaction.reply({ content: '❌ Failed to save the event.', ephemeral: true });
            }
        }
        return;
    }
    if (interaction.isModalSubmit() && interaction.customId?.startsWith('edit-queue-modal-')) {
        await handleEditQueueModal(interaction);
        return;
    }
    
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    // Let the generalQuestion collector handle these
    if (interaction.customId === 'yes_private_help' || interaction.customId === 'no_private_help') {
      return;
    }
    // Let the codeReview collector handle these
    if (interaction.customId === 'code_review_yes' || interaction.customId === 'code_review_no') {
      return;
    }

    console.log(`Button clicked: ${interaction.customId}`);

    // Skip queue handler for study‑tips buttons and modal submits
    if ((interaction.isButton() && interaction.customId.startsWith('study-')) || interaction.isModalSubmit()) {
      // handled in dedicated blocks below
    } else try {
        // // Defer the reply to avoid timeout errors and allow time to respond later
        // await interaction.deferReply({ ephemeral: true });

        switch (customId) {
            case 'run-setup-again': {
                try {
                  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                    await interaction.reply({ content: '⛔ Manage Server is required to run setup.', ephemeral: true });
                    break;
                  }
                  await interaction.deferReply({ ephemeral: true });
                  const warnings = [];
                  try { await ensureRolesForGuild(guild); } catch (e) { console.warn('ensureRolesForGuild:', e.message); warnings.push('roles'); }
                  try { await setupDocumentationChannels(guild); } catch (e) { console.warn('setupDocumentationChannels:', e.message); warnings.push('docs'); }
                  try { await ensureStudentQueueChannel(guild); } catch (e) { console.warn('ensureStudentQueueChannel:', e.message); warnings.push('student-queues'); }
                  try { await ensureStaffQueueChannel(guild); } catch (e) { console.warn('ensureStaffQueueChannel:', e.message); warnings.push('staff-queues'); }
                  try { await studyTips._helpers.ensureSettingsForGuild(guild); } catch (e) { console.warn('ensureSettingsForGuild:', e.message); warnings.push('study-tip-settings'); }
                  try { await checkGuildPermissions(guild); } catch (e) { console.warn('checkGuildPermissions:', e.message); warnings.push('permissions'); }
                  const msg = warnings.length
                    ? `✅ Setup finished with warnings: ${warnings.join(', ')}.`
                    : '✅ Setup complete.';
                  await interaction.editReply(msg);
                } catch (e) {
                  console.error('Run-setup-again failed:', e);
                  if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply('❌ Setup failed. Please check my permissions and try again.');
                  }
                }
                break;
          }
            /* ---------- Student selectors & buttons ---------- */
            case 'student-queue-selector':
                await handleStudentQueueSelect(interaction);
                break;
            case 'join-student':
                await handleJoinQueue(interaction, user, guild);
                break;
            case 'leave-student':
                await handleLeaveQueue(interaction, user, guild);
                break;
          
            /* ---------- Staff selectors & buttons ---------- */
            case 'staff-queue-selector':
                await handleStaffQueueSelect(interaction);
                break;
            case 'shuffle-queue':
                await handleShuffleQueue(interaction);
                break;
            case 'clear-queue':
                await handleClearQueue(interaction);
                break;
            case 'blacklist-selector':
                await handleBlacklistSelect(interaction);
                break;
// (Removed whitelist-selector case)
            case 'queue-blacklist':
                await handleBlacklistButton(interaction);
                break;
            case 'edit-queue':
                await handleEditQueue(interaction);
                break;
            case 'delete-user-selector':
                await handleDeleteUserSelect(interaction);
                break;
            case 'queue-delete-user':
                await handleDeleteUserButton(interaction);
                break;
            case 'create-queue':
                await handleCreateQueueButton(interaction);
                break;

          /* ---------- Fallback ---------- */
          default:
              await interaction.reply({ content: '⛔ Unknown interaction.', ephemeral: true });
              break;
          }
    } catch (error) {
        console.error('Error handling interaction:', error);

        // Only follow up if deferReply succeeded
        if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: 'An error occurred while processing your request.' });
        } else if (!interaction.replied) {
            await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        } else {
            // If already replied, optionally log or ignore
            console.warn('Could not send error message — interaction already replied.');
        }
    }

    // ─── Study‑tips buttons ───────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('study-')) {
      try {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
          await interaction.reply({ content: '⛔ Manage Server is required.', ephemeral: true }).catch(() => {});
          return;
        }
        const gid = interaction.guildId;
        const row = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [gid])).rows[0] || {};
        const helpers = studyTips._helpers;
        const t = helpers.parseHHMM(row.time_of_day || '12:00') || { hour: 12, minute: 0 };
        const tz = row.timezone || 'UTC';
        let updated = {};
        switch (interaction.customId) {
          case 'study-enable': {
            const nextAt = helpers.computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: tz });
            updated = { enabled: true, next_send_at: nextAt };
            break;
          }
          case 'study-disable': {
            updated = { enabled: false };
            break;
          }
          case 'study-more-often': {
            const freq = helpers.nextFrequency(row.frequency_days || 7);
            const nextAt = helpers.computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: tz });
            updated = { frequency_days: freq, next_send_at: nextAt };
            break;
          }
          case 'study-less-often': {
            const freq = helpers.prevFrequency(row.frequency_days || 7);
            const nextAt = helpers.computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: tz });
            updated = { frequency_days: freq, next_send_at: nextAt };
            break;
          }
          case 'study-set-time': {
            const modal = new ModalBuilder().setCustomId('study-time-modal').setTitle('Set study time');
            modal.addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hhmm').setLabel('Time (HH:MM 24h)').setStyle(TextInputStyle.Short).setValue(row.time_of_day || '12:00').setRequired(true)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tz').setLabel('Timezone (IANA, e.g., Europe/London)').setStyle(TextInputStyle.Short).setValue(row.timezone || 'UTC').setRequired(true))
            );
            await interaction.showModal(modal);
            return; // handled via modal submit
          }
        }
        if (Object.keys(updated).length) {
          const cols = Object.keys(updated);
          const vals = Object.values(updated);
          const setSql = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
          await clientDB.query(
            `INSERT INTO study_tips (guild_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
             ON CONFLICT (guild_id) DO UPDATE SET ${setSql}`,
            [gid, ...vals]
          );
        }
        // Update panel message if possible
        try {
          const cur = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [gid])).rows[0];
          const comp = require('./features/studyTips');
          const components = comp && comp._helpers && comp._helpers.panelComponents
            ? [comp._helpers.panelComponents(!!cur.enabled)]
            : interaction.message.components;
          const msg = require('./features/studyTips')._helpers.panelText(cur);
          await interaction.update({ content: msg, components });
        } catch (_) {}
        // No ephemeral follow‑up to avoid token timing causing "Unknown interaction"
      } catch (e) {
        console.error('study‑tips button failed:', e);
      }
      return;
    }

    // Modal submit: study time
    if (interaction.isModalSubmit() && interaction.customId === 'study-time-modal') {
      try {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
          return interaction.reply({ content: '⛔ Manage Server is required.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const hhmm = interaction.fields.getTextInputValue('hhmm');
        const tz = interaction.fields.getTextInputValue('tz');
        const helpers = studyTips._helpers;
        const t = helpers.parseHHMM(hhmm);
        if (!t) {
          return interaction.editReply({ content: '⛔ Invalid time. Use HH:MM 24h.' });
        }
        const nextAt = helpers.computeNextUTC({ hour: t.hour, minute: t.minute, timeZone: tz });
        await clientDB.query(
          `INSERT INTO study_tips (guild_id, time_of_day, timezone, next_send_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (guild_id) DO UPDATE SET time_of_day=$2, timezone=$3, next_send_at=$4`,
          [interaction.guildId, hhmm, tz, nextAt]
        );
        // Update the pinned panel via known settings channel if available
        try {
          const st = (await clientDB.query('SELECT * FROM study_tips WHERE guild_id=$1', [interaction.guildId])).rows[0];
          const comp = require('./features/studyTips');
          const ch = st.settings_channel_id ? interaction.client.channels.cache.get(st.settings_channel_id) : null;
          if (ch && ch.isTextBased()) {
            const pins = await ch.messages.fetchPinned();
            const panel = pins.find(m => m.author?.id === interaction.client.user.id && /Study Tip Settings/i.test(m.content));
            if (panel) {
              const components = comp && comp._helpers && comp._helpers.panelComponents
                ? [comp._helpers.panelComponents(!!st.enabled)]
                : panel.components;
              await panel.edit({ content: comp._helpers.panelText(st), components });
            }
          }
        } catch (_) {}
        await interaction.editReply({ content: `✅ Time set to ${hhmm} ${tz}. Next: <t:${Math.floor(nextAt.getTime()/1000)}:F>` });
      } catch (e) {
        console.error('study-time-modal failed:', e);
        if (!interaction.replied) {
          try { await interaction.editReply({ content: '❌ Failed to save. Please try again.' }); } catch (_) {}
        }
      }
      return;
    }
});

/**
 * Handle message-based features (code review, DM response, general question).
 */

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // If DM channel, handle via natural‐language history lookup
    if (message.channel.type === ChannelType.DM) {
      // Premium Apps: require user entitlement for DM history
      try {
        const ok = await premium.hasPremiumAccess({ userId: message.author.id, client: message.client });
        if (!ok) {
          const link = process.env.PREMIUM_PURCHASE_URL || 'Please subscribe from the App Directory listing to use this feature.';
          await message.reply(`🔒 Premium required. ${link}`);
          return;
        }
      } catch (e) {
        await message.reply('🔒 Premium required. Please try again later.');
        return;
      }
      await handleDmMessage(message);
      return;
    }

    // Otherwise, existing guild‐message features
    await handleCodeReview(message);
    await handleDMResponse(message);
    await handleGeneralQuestion(message);

    /* ---------- Live message logging ---------- */
    try {
      if (message.guild && !message.author.bot) {
        await clientDB.query(
          `INSERT INTO public_messages
             (id, guild_id, channel_id, author_id, author_tag, content, ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO NOTHING`,
          [
            message.id,
            message.guildId,
            message.channelId,
            message.author.id,
            message.author.tag,
            message.content.trim(),
            message.createdAt
          ]
        );
      }
    } catch (err) {
      console.error('Live‑logging failed:', err);
    }
});

/**
 * Ensure student channels exist whenever a student comes online.
 */
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  try {
    // Only trigger when coming online from offline
    if ((!oldPresence || oldPresence.status === 'offline') && newPresence.status === 'online') {
      const member = newPresence.member;
      // Only for students
      if (member.roles.cache.some(role => role.name.toLowerCase() === 'students')) {
        // Re-create or ensure the student-queues channel and student-docs channel
        await ensureStudentQueueChannel(newPresence.guild);
        await updateDocumentationMessage(newPresence.guild, 'channel_student_docs', await studentMessageFor(newPresence.guild));
      }
    }
  } catch (err) {
    console.error('Error in presenceUpdate handler:', err);
  }
});


client.login(ACCESS_TOKEN_DISCORD);
