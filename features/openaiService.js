// features/openaiService.js
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports.getOpenAIResponse = async (userMessage, maxTokens = 1000, locale = 'en-US') => {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [
      { role: "system", content: `You are a general, friendly assistant who is knowledgeable about code. Be concise and clear. Respond in ${locale}.` },
      { role: "user", content: userMessage }
    ]
  });
  return completion.choices[0].message.content;
};
