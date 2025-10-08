const test = require('node:test');
const assert = require('node:assert/strict');

const { stashEnv, clearModule } = require('./test-helpers');

test('voice assistant module exports stubs when realtime is disabled', { concurrency: false }, async () => {
  const restoreRealtime = stashEnv('JEFFREY_ENABLE_REALTIME');
  const restoreKey = stashEnv('OPENAI_API_KEY');

  process.env.JEFFREY_ENABLE_REALTIME = '0';
  delete process.env.OPENAI_API_KEY;

  clearModule('../config');
  const configModule = require('../config');
  configModule.config.features.enableRealtimeVoice = false;
  configModule.config.openAI.apiKey = '';
  process.env.OPENAI_API_KEY = '';
  clearModule('../services/voiceAssistant');

  const voiceAssistant = require('../services/voiceAssistant');
  assert.equal(typeof voiceAssistant.ensureAssistantChannel, 'function');
  assert.equal(typeof voiceAssistant.handleVoiceUpdate, 'function');
  const channel = await voiceAssistant.ensureAssistantChannel();
  assert.equal(channel, null);

  restoreRealtime();
  restoreKey();
  clearModule('../config');
  clearModule('../services/voiceAssistant');
});

test('voice assistant requires an OpenAI key when enabled', { concurrency: false }, async () => {
  const restoreRealtime = stashEnv('JEFFREY_ENABLE_REALTIME');
  const restoreKey = stashEnv('OPENAI_API_KEY');

  process.env.JEFFREY_ENABLE_REALTIME = '1';
  delete process.env.OPENAI_API_KEY;

  clearModule('../config');
  const configModule = require('../config');
  configModule.config.features.enableRealtimeVoice = true;
  configModule.config.openAI.apiKey = '';
  process.env.OPENAI_API_KEY = '';
  clearModule('../services/voiceAssistant');

  const voiceAssistant = require('../services/voiceAssistant');
  assert.equal(typeof voiceAssistant.ensureAssistantChannel, 'function');
  const channel = await voiceAssistant.ensureAssistantChannel();
  assert.equal(channel, null);

  restoreRealtime();
  restoreKey();
  clearModule('../config');
  clearModule('../services/voiceAssistant');
});
