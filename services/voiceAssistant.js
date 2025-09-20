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
const { PassThrough, pipeline } = require('stream');
const { promisify } = require('util');
const OpenAI = require('openai');
const knowledge = require('./knowledge');
const { getRealtimeClient } = require('./openaiRealtime');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pipelineAsync = promisify(pipeline);

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const MAX_RESPONSE_CHARS = 900;
const SILENCE_LEVEL_THRESHOLD = Number(process.env.JEFFREY_MIN_SIGNAL_LEVEL || 200);
const MIN_TRANSCRIPT_CHARS = 5;
const MIN_ENGLISH_CONFIDENCE = Number(process.env.JEFFREY_MIN_ENGLISH_CONFIDENCE || 0.6);
const REWRITE_CONFIDENCE_THRESHOLD = Number(process.env.JEFFREY_REWRITE_CONFIDENCE || 0.35);

const DEBUG_VOICE = process.env.JEFFREY_DEBUG_VOICE === '1';

function debugVoice(...args) {
  if (DEBUG_VOICE) {
    console.log('[VoiceAssistant]', ...args);
  }
}

const assistantState = new Map(); // guildId -> { channelId, connection, tempDir, audioPlayer, queue, playing }
const processingUsers = new Set();

tmp.setGracefulCleanup();

async function computeSignalLevel(pcmPath) {
  try {
    const buffer = await fsp.readFile(pcmPath);
    if (!buffer || buffer.length < 4) return 0;
    let sum = 0;
    let samples = 0;
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      sum += Math.abs(sample);
      samples += 1;
    }
    if (!samples) return 0;
    return sum / samples;
  } catch (err) {
    console.error('Signal level computation failed:', err);
    return 0;
  }
}

function englishConfidence(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[^A-Za-z\s']/g, '');
  const ratio = cleaned.length / text.length;
  debugVoice('English confidence', { ratio, textSample: text.slice(0, 80) });
  return Number.isFinite(ratio) ? ratio : 0;
}

function isLikelyEnglish(text) {
  return englishConfidence(text) >= MIN_ENGLISH_CONFIDENCE;
}

async function ensureEnglishReply(text, { questionText, fallback }) {
  const safeFallback = fallback || 'Let me think about that and get back to you shortly.';
  const candidate = text && text.trim() ? text : safeFallback;
  if (isLikelyEnglish(candidate)) return candidate;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Rewrite the assistant reply in fluent English. Keep factual content, remove foreign language artefacts.' },
        { role: 'system', content: `Original reply: ${candidate}` },
        questionText ? { role: 'user', content: `User question: ${questionText}` } : null,
      ].filter(Boolean),
      max_tokens: 200,
    });
    const rewritten = completion?.choices?.[0]?.message?.content;
    if (rewritten && rewritten.trim()) {
      return rewritten.trim();
    }
  } catch (err) {
    console.error('ensureEnglishReply fallback failed:', err);
  }
  return safeFallback;
}

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
    language: 'en',
  });
  return response?.text?.trim();
}

function appendHistory(state, entry) {
  if (!state) return;
  if (!state.history) state.history = [];
  state.history.push(entry);
  if (state.history.length > 12) {
    state.history.splice(0, state.history.length - 12);
  }
}

function getHistoryMessages(state) {
  if (!state?.history?.length) return [];
  return state.history.slice(-6).map(entry => {
    if (entry.role === 'assistant') {
      return { role: 'assistant', content: entry.content };
    }
    const label = entry.name || 'User';
    return { role: 'user', content: `${label}: ${entry.content}` };
  });
}

function getHistorySearchSeed(state) {
  if (!state?.history?.length) return '';
  return state.history
    .slice(-6)
    .map(entry => `${entry.role === 'assistant' ? 'Jeffrey' : (entry.name || 'User')}: ${entry.content}`)
    .join(' ');
}

async function buildAnswer(guild, questionText, { state, channel, userId } = {}) {
  const member = channel?.guild?.members?.cache?.get(userId);
  const speakerName = member?.displayName || member?.user?.username || 'User';
  const historyMessages = getHistoryMessages(state);
  const searchSeed = [getHistorySearchSeed(state), questionText].filter(Boolean).join(' ').slice(-400);

  const [knowledgeContext, chatContext, sessionContext] = await Promise.all([
    knowledge.fetchKnowledgeContext(guild.id, searchSeed || questionText, { limit: 3 }),
    knowledge.fetchGeneralChatContext(guild.id, searchSeed || questionText, { channelId: channel?.id }),
    knowledge.fetchSessionContext(guild.id, searchSeed || questionText, { limit: 3 })
  ]);

  const contextMessages = [];
  if (knowledgeContext) {
    contextMessages.push({ role: 'system', content: `Knowledge entries (summarise in English):\n${knowledgeContext}` });
  }
  if (chatContext) {
    contextMessages.push({ role: 'system', content: `Recent chat context (may include other languages; respond in English):\n${chatContext}` });
  }
  if (sessionContext) {
    contextMessages.push({ role: 'system', content: `Session archives (respond in English):\n${sessionContext}` });
  }

  const messages = [
    { role: 'system', content: 'You are Jeffrey, a helpful classroom assistant. Answer succinctly (max 150 words). Always reply in English, even if the user speaks another language. If context is incomplete, explain what is missing politely.' },
    ...contextMessages,
    ...historyMessages,
    { role: 'user', content: `${speakerName}: ${questionText}` }
  ];

  appendHistory(state, { role: 'user', content: questionText, name: speakerName, userId });

  const defaultReply = 'I’m not sure how to answer that right now, but I’ll keep learning!';
  let audioStream = null;
  let finalTextPromise;

  try {
    const realtime = getRealtimeClient(guild.id);
    const historyText = getHistorySearchSeed(state);
    const contextText = contextMessages.map(m => m.content).join('\n\n');
    const realtimePrompt = [
      'The user is speaking English. Resolve ambiguous phonetics as English words.',
      contextText ? `Context:\n${contextText}` : null,
      historyText ? `Recent conversation:\n${historyText}` : null,
      `${speakerName}: ${questionText}`
    ].filter(Boolean).join('\n\n');

    const { audioStream: stream, textPromise } = await realtime.sendUserMessage({
      text: realtimePrompt,
      clientState: {
        recent_history: state.history,
      },
    });

    audioStream = stream || null;
    finalTextPromise = textPromise
      .then(text => text || defaultReply)
      .then(async text => {
        const score = englishConfidence(text);
        debugVoice('Realtime reply confidence', score);
        if (score < REWRITE_CONFIDENCE_THRESHOLD) {
          return ensureEnglishReply(text, { questionText, fallback: defaultReply });
        }
        return text;
      })
      .catch(err => {
        console.error('Realtime text failed:', err);
        return defaultReply;
      })
      .then(text => {
        const trimmed = text.slice(0, MAX_RESPONSE_CHARS);
        appendHistory(state, { role: 'assistant', content: trimmed });
        return trimmed;
      });
  } catch (err) {
    console.error('Realtime response failed:', err);
    finalTextPromise = (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini',
          temperature: 0.4,
          messages,
          max_tokens: 250,
        });
        const text = completion?.choices?.[0]?.message?.content || defaultReply;
        const score = englishConfidence(text);
        debugVoice('Fallback reply confidence', score);
        const english = score < REWRITE_CONFIDENCE_THRESHOLD
          ? await ensureEnglishReply(text, { questionText, fallback: defaultReply })
          : text;
        const trimmed = english.slice(0, MAX_RESPONSE_CHARS);
        appendHistory(state, { role: 'assistant', content: trimmed });
        return trimmed;
      } catch (fallbackErr) {
        console.error('Fallback completion failed:', fallbackErr);
        appendHistory(state, { role: 'assistant', content: defaultReply });
        return defaultReply;
      }
    })();
    audioStream = null;
  }

  return { textPromise: finalTextPromise, audioStream, fallbackText: defaultReply };
}

function ensureState(guildId) {
  if (!assistantState.has(guildId)) {
    assistantState.set(guildId, { history: [] });
  }
  const state = assistantState.get(guildId);
  if (!state.history) state.history = [];
  return state;
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
  const item = state.queue.shift();
  const payload = typeof item === 'string'
    ? { textPromise: Promise.resolve(item), fallbackText: item }
    : (item || {});
  const audioStream = payload.audioStream;
  const fallbackText = payload.fallbackText || 'Let me think about that and get back to you shortly.';
  const textPromise = payload.textPromise || Promise.resolve(fallbackText);
  try {
    let opusStream;
    if (audioStream) {
      audioStream.on('error', err => console.error('Realtime audio stream error:', err));
      const ffmpeg = new prism.FFmpeg({
        args: ['-analyzeduration', '0', '-loglevel', '0', '-i', 'pipe:0', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS)]
      });
      ffmpeg.on('error', err => console.error('FFmpeg stream error:', err));
      const pcm = audioStream.pipe(ffmpeg);
      const opus = new prism.opus.Encoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
      opusStream = pcm.pipe(opus);
    } else {
      const finalText = await textPromise.catch(() => fallbackText);
      const ttsInput = finalText || fallbackText;
      const speech = await openai.audio.speech.create({
        model: process.env.JEFFREY_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.JEFFREY_TTS_VOICE || 'alloy',
        input: ttsInput,
        format: 'ogg'
      });
      const arrayBuffer = await speech.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const source = new PassThrough();
      source.end(buffer);
      const ffmpeg = new prism.FFmpeg({
        args: ['-analyzeduration', '0', '-loglevel', '0', '-i', 'pipe:0', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS)]
      });
      ffmpeg.on('error', err => console.error('FFmpeg TTS error:', err));
      const pcm = source.pipe(ffmpeg);
      const opus = new prism.opus.Encoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
      opusStream = pcm.pipe(opus);
    }
    const resource = createAudioResource(opusStream, { inputType: StreamType.Opus });
    state.playing = true;
    state.audioPlayer.play(resource);
  } catch (err) {
    console.error('Failed to synthesise assistant speech:', err);
    state.playing = false;
    try {
      const finalText = await textPromise.catch(() => fallbackText);
      if (finalText) {
        await enqueueSpeech(state, {
          textPromise: Promise.resolve(finalText),
          audioStream: null,
          fallbackText: finalText,
        });
        return;
      }
    } catch (innerErr) {
      console.error('Fallback speech after failure also failed:', innerErr);
      if (state.queue.length) {
        await playNext(state);
      }
    }
    return;
  }
}

async function enqueueSpeech(state, payload) {
  if (!payload) return;
  if (!state.queue) state.queue = [];
  state.queue.push(payload);
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
      const signalLevel = await computeSignalLevel(pcmPath);
      debugVoice('Signal level', signalLevel, 'threshold', SILENCE_LEVEL_THRESHOLD);
      if (signalLevel < SILENCE_LEVEL_THRESHOLD) {
        dir.removeCallback();
        processingUsers.delete(`${channel.guild.id}:${userId}`);
        return;
      }

      const wavPath = path.join(dir.name, `${Date.now()}-${userId}.wav`);
      await pcmToWav(pcmPath, wavPath);
      const transcript = await transcribeAudio(wavPath);
      if (!transcript || transcript.length < MIN_TRANSCRIPT_CHARS) {
        dir.removeCallback();
        processingUsers.delete(`${channel.guild.id}:${userId}`);
        return;
      }

      debugVoice('Transcript received', transcript.slice(0, 120));
      if (!isLikelyEnglish(transcript)) {
        debugVoice('Transcript rejected (non-English)');
        const msg = 'I only understand spoken English right now. Could you please repeat that in English?';
        const state = ensureState(channel.guild.id);
        const member = channel.guild.members.cache.get(userId);
        const speakerName = member?.displayName || member?.user?.username || 'User';
        appendHistory(state, { role: 'user', content: transcript.slice(0, MAX_RESPONSE_CHARS), name: speakerName, userId });
        appendHistory(state, { role: 'assistant', content: msg });
        await enqueueSpeech(state, {
          textPromise: Promise.resolve(msg),
          audioStream: null,
          fallbackText: msg,
        });
        dir.removeCallback();
        processingUsers.delete(`${channel.guild.id}:${userId}`);
        return;
      }

      const state = ensureState(channel.guild.id);
      const answer = await buildAnswer(channel.guild, transcript, {
        state,
        channel,
        userId,
      }).catch(err2 => {
        console.error('Assistant answer failed:', err2);
        const msg = 'I ran into a problem while trying to answer that. Could you try again?';
        appendHistory(state, { role: 'assistant', content: msg });
        return { textPromise: Promise.resolve(msg), audioStream: null, fallbackText: msg };
      });
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
