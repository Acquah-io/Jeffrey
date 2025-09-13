require('dotenv').config();
const OpenAI = require('openai');

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('OPENAI_API_KEY is missing');
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey: key });
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 5,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Reply with PONG.' },
        { role: 'user', content: 'PING' }
      ],
    });
    const text = resp?.choices?.[0]?.message?.content?.trim() || '';
    console.log('OpenAI chat OK:', text || '(empty response)');
  } catch (e) {
    console.error('OpenAI check failed:', e.status || e.code || e.message);
    process.exit(1);
  }
}

main();

