const {
  joinVoiceChannel,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  StreamType
} = require('@discordjs/voice');
const { ChannelType } = require('discord.js');
const prism = require('prism-media');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const tmp = require('tmp');
const { pipeline, PassThrough } = require('stream');
const { promisify } = require('util');
const OpenAI = require('openai');
const summaries = require('./classSummaries');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pipelineAsync = promisify(pipeline);

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const MAX_RESPONSE_CHARS = 900;

const assistantState = new Map(); // guildId -> { channelId, connection, tempDir, audioPlayer, queue, playing }
const processingUsers = new Set();

tmp.setGracefulCleanup();

function targetChannelName() {
  return (process.env.JEFFREY_ASSISTANT_CHANNEL_NAME || 'Ask Jeffrey').toLowerCase();
}

async function pcmToWav(pcmPath, wavPath) {
  const stat = await fsp.stat(pcmPath);
  const dataSize = stat.size;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  const byteRate = SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * (BIT_DEPTH / 8), 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const reader = fs.createReadStream(pcmPath);
  const writer = fs.createWriteStream(wavPath);
  writer.write(header);
  await pipelineAsync(reader, writer);
  return wavPath;
}

async function transcribeAudio(wavPath) {
  const stream = fs.createReadStream(wavPath);
  const response = await openai.audio.transcriptions.create({
    file: stream,
    model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
    response_format: 'json',
  });
  return response?.text?.trim();
}

async function buildAnswer(guild, questionText) {
  const snippets = await summaries.searchKnowledge(guild.id, questionText, { limit: 3 }).catch(() => []);
  const context = snippets.map((snip, idx) => {
    const when = snip.created_at ? `<t:${Math.floor(new Date(snip.created_at).getTime() / 1000)}:f>` : 'Unknown date';
    return `Snippet ${idx + 1} (${when}) – ${snip.title || 'Untitled'}\n${snip.summary || snip.content.slice(0, 240)}`;
  }).join('\n\n');

  const messages = [
    { role: 'system', content: 'You are Jeffrey, a helpful classroom assistant. Answer succinctly (max 150 words) using the supplied knowledge snippets when relevant. If information is missing, say so politely.' },
    context ? { role: 'system', content: `Knowledge snippets:\n${context}` } : null,
    { role: 'user', content: questionText }
  ].filter(Boolean);

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini',
    temperature: 0.4,
    messages,
    max_tokens: 250,
  });

  const answer = completion?.choices?.[0]?.message?.content || 'I’m not sure how to answer that right now, but I’ll keep learning!';
  return answer.slice(0, MAX_RESPONSE_CHARS);
}

function ensureState(guildId) {
  if (!assistantState.has(guildId)) {
    assistantState.set(guildId, {});
  }
  return assistantState.get(guildId);
}

function ensureAudioPlayer(state) {
  if (!state.audioPlayer) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });
    player.on('error', err => console.error('Voice assistant audio error:', err));
    player.on(AudioPlayerStatus.Idle, () => {
      if (state.queue && state.queue.length) {
        playNext(state).catch(err => console.error('Voice assistant queue error:', err));
      } else {
        state.playing = false;
      }
    });
    state.audioPlayer = player;
  }
  return state.audioPlayer;
}

async function playNext(state) {
  if (!state.queue || !state.queue.length) {
    state.playing = false;
    return;
  }
  const text = state.queue.shift();
  try {
    const speech = await openai.audio.speech.create({
      model: process.env.JEFFREY_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.JEFFREY_TTS_VOICE || 'alloy',
      input: text,
      format: 'ogg'
    });
    const arrayBuffer = await speech.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const stream = new PassThrough();
    stream.end(buffer);
    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    state.playing = true;
    state.audioPlayer.play(resource);
  } catch (err) {
    console.error('Failed to synthesise assistant speech:', err);
    state.playing = false;
    if (state.queue.length) {
      await playNext(state);
    }
  }
}

async function enqueueSpeech(state, text) {
  if (!text) return;
  if (!state.queue) state.queue = [];
  state.queue.push(text);
  if (!state.playing) {
    await playNext(state);
  }
}

function createRecordingPipeline(connection, userId, channel) {
  const dir = tmp.dirSync({ unsafeCleanup: true });
  const pcmPath = path.join(dir.name, `${Date.now()}-${userId}.pcm`);
  const opus = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
  });
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });
  const writer = fs.createWriteStream(pcmPath, { flags: 'a' });

  pipeline(opus, decoder, writer, async (err) => {
    try {
      writer.close();
    } catch (_) {}

    if (err) {
      console.error('Assistant pipeline error:', err);
      dir.removeCallback();
      processingUsers.delete(`${channel.guild.id}:${userId}`);
      return;
    }

    try {
      const stats = await fsp.stat(pcmPath);
      if (!stats || stats.size < 8000) {
        dir.removeCallback();
        processingUsers.delete(`${channel.guild.id}:${userId}`);
        return;
      }
      const wavPath = path.join(dir.name, `${Date.now()}-${userId}.wav`);
      await pcmToWav(pcmPath, wavPath);
      const transcript = await transcribeAudio(wavPath);
      if (!transcript || transcript.length < 5) {
        dir.removeCallback();
        processingUsers.delete(`${channel.guild.id}:${userId}`);
        return;
      }

      const answer = await buildAnswer(channel.guild, transcript).catch(err2 => {
        console.error('Assistant answer failed:', err2);
        return 'I ran into a problem while trying to answer that. Could you try again?';
      });
      const state = ensureState(channel.guild.id);
      await enqueueSpeech(state, answer);
    } catch (error) {
      console.error('Assistant processing error:', error);
    } finally {
      dir.removeCallback();
      processingUsers.delete(`${channel.guild.id}:${userId}`);
    }
  });
}

async function ensureConnection(channel) {
  const guildId = channel.guild.id;
  let state = ensureState(guildId);
  if (state.connection && state.channelId === channel.id) return state;

  if (state.connection) {
    try { state.connection.destroy(); } catch (_) {}
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  state.connection = connection;
  state.channelId = channel.id;
  assistantState.set(guildId, state);

  const player = ensureAudioPlayer(state);
  connection.subscribe(player);

  connection.receiver.speaking.on('start', (userId) => {
    const hash = `${guildId}:${userId}`;
    if (processingUsers.has(hash)) return;
    const member = channel.guild.members.cache.get(userId);
    if (!member || member.user.bot) return;
    processingUsers.add(hash);
    createRecordingPipeline(connection, userId, channel);
  });

  connection.receiver.speaking.on('end', (userId) => {
    // handled in pipeline cleanup
  });

  return state;
}

async function disconnect(guildId) {
  const state = assistantState.get(guildId);
  if (!state) return;
  try {
    state.connection?.destroy();
    state.audioPlayer?.stop(true);
  } catch (_) {}
  assistantState.delete(guildId);
}

async function ensureAssistantChannel(guild) {
  const name = targetChannelName();
  const desiredLabel = name.replace(/\b\w/g, (c) => c.toUpperCase());
  let channel = guild.channels.cache.find(ch => ch.type === ChannelType.GuildVoice && ch.name.toLowerCase() === name);
  if (!channel) {
    const legacy = guild.channels.cache.find(ch => ch.type === ChannelType.GuildVoice && /geoffrey/i.test(ch.name));
    if (legacy) {
      try { await legacy.setName(desiredLabel); } catch (_) {}
      channel = legacy;
    }
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: desiredLabel,
      type: ChannelType.GuildVoice,
      reason: 'Jeffrey voice assistant channel',
    });
  }
  return channel;
}

async function handleVoiceUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const name = targetChannelName();
  const newChannel = newState.channel;
  const oldChannel = oldState.channel;

  const joinedAssistant = newChannel && newChannel.type === ChannelType.GuildVoice && newChannel.name.toLowerCase() === name && !newState.member.user.bot;
  const leftAssistant = oldChannel && oldChannel.type === ChannelType.GuildVoice && oldChannel.name.toLowerCase() === name && (!newChannel || newChannel.id !== oldChannel.id);

  if (joinedAssistant) {
    await ensureConnection(newChannel);
  }

  if (leftAssistant && oldChannel) {
    const humans = oldChannel.members.filter(member => !member.user.bot);
    if (!humans.size) {
      await disconnect(guild.id);
    }
  }
}

module.exports = {
  ensureAssistantChannel,
  handleVoiceUpdate,
};
