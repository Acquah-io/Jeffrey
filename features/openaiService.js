// features/openaiService.js
const { config } = require('../config');

let openai = null;
try {
  if (config.openAI.apiKey) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: config.openAI.apiKey });
  } else {
    console.warn('OPENAI_API_KEY is not set. AI-powered features will remain disabled until it is provided.');
  }
} catch (err) {
  console.error('Failed to initialise OpenAI client:', err.message || err);
  openai = null;
}

function ensureClient() {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is missing or invalid. Set it to enable AI-powered responses.');
  }
}

module.exports.getOpenAIResponse = async (userMessage, maxTokens = 1000, locale = 'en-US') => {
  ensureClient();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [
      { role: "system", content: `You are a general, friendly assistant who is knowledgeable about code. Be concise and clear. Respond in English only, regardless of the user's language or locale.` },
      { role: "user", content: userMessage }
    ]
  });
  return completion.choices[0].message.content;
};

module.exports.isConfigured = () => Boolean(openai);
