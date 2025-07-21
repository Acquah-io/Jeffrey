// features/openaiService.js
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let log = [{ role: "system", content: "You are a general friendly assistant who is knowledgeable about code." }];

module.exports.getOpenAIResponse = async (userMessage, maxTokens = 1000) => {
  log.push({ role: "user", content: userMessage });
  // Keep only the most recent ~20 messages to avoid unbounded growth
  if (log.length > 20) log.shift();
  const completion = await openai.chat.completions.create({
    messages: log,
    model: "gpt-4o",
    max_tokens: maxTokens,
  });
  const response = completion.choices[0].message.content;
  log.push({ role: "system", content: response });
  if (log.length > 20) log.shift();
  return response;
};
