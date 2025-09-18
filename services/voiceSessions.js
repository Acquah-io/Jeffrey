const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus, EndBehaviorType } = require('@discordjs/voice');
const { Collection, PermissionsBitField, ChannelType } = require('discord.js');
const prism = require('prism-media');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const tmp = require('tmp');
const { pipeline } = require('stream');
const { promisify } = require('util');
const OpenAI = require('openai');
const summaries = require('./classSummaries');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pipelineAsync = promisify(pipeline);

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BIT_DEPTH = 16;

const activeSessions = new Collection(); // guildId -> session

tmp.setGracefulCleanup();

function ensureMemberCanManage(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

async function pcmToWav(pcmPath, wavPath, { sampleRate = SAMPLE_RATE, channels = CHANNELS, bitDepth = BIT_DEPTH } = {}) {
  const stat = await fsp.stat(pcmPath);
  const dataSize = stat.size;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  header.writeUInt32LE(byteRate, 28);
  const blockAlign = channels * (bitDepth / 8);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const reader = fs.createReadStream(pcmPath);
  const writer = fs.createWriteStream(wavPath);
  writer.write(header);
  await pipelineAsync(reader, writer);
  return wavPath;
}

function createRecorder(channel, sessionRow) {
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  const recordings = new Map();

  function getRecording(userId) {
    if (!recordings.has(userId)) {
      const filePath = path.join(tempDir.name, `${userId}.pcm`);
      recordings.set(userId, {
        filePath,
        streams: new Set(),
      });
    }
    return recordings.get(userId);
  }

  connection.receiver.speaking.on('start', (userId) => {
    if (userId === channel.client.user.id) return;
    const rec = getRecording(userId);
    const opusStream = connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 500,
      },
    });
    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });
    const writeStream = fs.createWriteStream(rec.filePath, { flags: 'a' });
    rec.streams.add(writeStream);
    pipeline(opusStream, decoder, writeStream, (err) => {
      rec.streams.delete(writeStream);
      if (err) {
        console.error('Recorder pipeline error:', err);
      }
      writeStream.destroy();
    });
  });

  return {
    connection,
    sessionRow,
    tempDir,
    recordings,
    async destroy() {
      connection.receiver.speaking.removeAllListeners();
      connection.destroy();
      for (const rec of recordings.values()) {
        for (const ws of rec.streams) {
          try { ws.end(); } catch (_) {}
        }
      }
      try { tempDir.removeCallback(); } catch (_) {}
    }
  };
}

async function transcribeRecordings(guild, recorder) {
  const results = [];
  for (const [userId, rec] of recorder.recordings.entries()) {
    try {
      await Promise.all(Array.from(rec.streams.values()).map(stream => new Promise(resolve => stream.once('finish', resolve))));
    } catch (_) {}

    const stats = await fsp.stat(rec.filePath).catch(() => null);
    if (!stats || stats.size === 0) continue;

    const wavPath = path.join(recorder.tempDir.name, `${userId}.wav`);
    await pcmToWav(rec.filePath, wavPath, { sampleRate: SAMPLE_RATE, channels: CHANNELS });

    const username = guild.members.cache.get(userId)?.displayName || `User ${userId}`;
    const fileStream = fs.createReadStream(wavPath);
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
        response_format: 'verbose_json',
      });
      if (transcription?.text) {
        results.push({ userId, username, text: transcription.text.trim() });
      }
    } catch (err) {
      console.error('Transcription failed for', userId, err); }
  }
  return results;
}

async function generateSummary(transcripts, { topic, date }) {
  if (!transcripts.length) return { summary: null, combined: '' };
  const combined = transcripts
    .map(t => `${t.username}: ${t.text}`)
    .join('\n');
  const prompt = [
    topic ? `Class topic: ${topic}` : null,
    date ? `Class date: ${date.toISOString()}` : null,
    'Transcript:',
    combined,
    '\n\nPlease provide a concise summary (under 250 words) highlighting key points, decisions, action items, and questions raised. Include bullet points and mention specific dates or names when present.'
  ].filter(Boolean).join('\n');

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You are an assistant that writes concise meeting summaries for students.' },
      { role: 'user', content: prompt }
    ]
  });

  const summary = completion?.choices?.[0]?.message?.content || null;
  return { summary, combined };
}

async function startSession(channel, { topic, initiatedBy }) {
  if (!channel?.isVoiceBased()) throw new Error('Target channel must be a voice channel.');
  if (activeSessions.has(channel.guild.id)) {
    throw new Error('A session is already in progress for this guild.');
  }

  const sessionRow = await summaries.createSession({
    guildId: channel.guild.id,
    channelId: channel.id,
    recorderId: initiatedBy || null,
    topic: topic || null,
    meta: { started_by: initiatedBy || null }
  });

  const recorder = createRecorder(channel, sessionRow);
  const record = {
    recorder,
    session: sessionRow,
    participants: new Set(),
    channelId: channel.id,
  };
  activeSessions.set(channel.guild.id, record);

  for (const member of channel.members.values()) {
    if (member.user.bot) continue;
    record.participants.add(member.id);
    await summaries.recordParticipantJoin({ sessionId: sessionRow.id, userId: member.id });
  }
  return sessionRow;
}

async function stopSession(guild, { reason, endedBy } = {}) {
  const active = activeSessions.get(guild.id);
  if (!active) return null;

  activeSessions.delete(guild.id);

  const { recorder, session } = active;
  try {
    recorder.connection.destroy();
  } catch (_) {}

  const transcripts = await transcribeRecordings(guild, recorder);
  const { summary, combined } = await generateSummary(transcripts, {
    topic: session.topic,
    date: new Date(session.started_at || Date.now()),
  }).catch(err => {
    console.error('Summary generation failed:', err);
    return { summary: null, combined: transcripts.map(t => `${t.username}: ${t.text}`).join('\n') };
  });

  const updated = await summaries.closeSession(session.id, {
    summary,
    transcript: combined,
    meta: {
      ...(session.meta || {}),
      reason: reason || null,
      ended_by: endedBy || null,
    }
  });

  if (summary || combined) {
    await summaries.storeKnowledgeSnippet({
      sessionId: session.id,
      guildId: session.guild_id,
      title: session.topic || `Session ${session.id}`,
      summary,
      content: combined || summary || ''
    });
  }

  try { recorder.tempDir.removeCallback(); } catch (_) {}

  return { updated, transcripts, summary, combined };
}

function getActiveSession(guildId) {
  return activeSessions.get(guildId) || null;
}

async function handleVoiceUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const guildId = guild.id;
    const active = activeSessions.get(guildId);

    const trackedChannelId = active?.channelId;
    if (active && trackedChannelId) {
      const sessionId = active.session.id;
      const joined = newState.channelId === trackedChannelId && oldState.channelId !== trackedChannelId;
      const left = oldState.channelId === trackedChannelId && newState.channelId !== trackedChannelId;

      if (joined) {
        active.participants.add(newState.id);
        await summaries.recordParticipantJoin({ sessionId, userId: newState.id });
      }
      if (left) {
        active.participants.delete(oldState.id);
        await summaries.recordParticipantLeave({ sessionId, userId: oldState.id });
      }

      const channel = guild.channels.cache.get(trackedChannelId) || newState.channel || oldState.channel;
      if (channel) {
        const humans = channel.members.filter(member => !member.user.bot);
        if (!humans.size) {
          await stopSession(guild, { reason: 'channel-empty' });
          return;
        }
      }
    }

    if (!active && newState.channel && !newState.member.user.bot) {
      const autoName = (process.env.GEOFFREY_AUTO_RECORD_CHANNEL_NAME || '').toLowerCase();
      if (autoName && newState.channel.name.toLowerCase() === autoName) {
        await startSession(newState.channel, { initiatedBy: newState.id });
        const current = activeSessions.get(guildId);
        if (current) {
          current.participants.add(newState.id);
          await summaries.recordParticipantJoin({ sessionId: current.session.id, userId: newState.id });
        }
      }
    }
  } catch (err) {
    console.error('handleVoiceUpdate error:', err);
  }
}

module.exports = {
  startSession,
  stopSession,
  getActiveSession,
  handleVoiceUpdate,
  ensureMemberCanManage,
};
