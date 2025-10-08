const test = require('node:test');
const assert = require('node:assert/strict');

const { stashEnv, clearModule } = require('./test-helpers');

test('openaiService reports missing configuration without crashing', { concurrency: false }, async () => {
  const restoreKey = stashEnv('OPENAI_API_KEY');
  delete process.env.OPENAI_API_KEY;

  clearModule('../config');
  const configModule = require('../config');
  configModule.config.openAI.apiKey = '';
  process.env.OPENAI_API_KEY = '';
  clearModule('../features/openaiService');

  const openaiService = require('../features/openaiService');
  assert.strictEqual(openaiService.isConfigured(), false);
  await assert.rejects(
    () => openaiService.getOpenAIResponse('Hello'),
    /OPENAI_API_KEY is missing or invalid/
  );

  restoreKey();
  clearModule('../config');
  clearModule('../features/openaiService');
});
