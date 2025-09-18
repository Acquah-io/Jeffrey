const classSummaries = require('./classSummaries');

async function fetchKnowledgeContext(guildId, query, { limit = 3 } = {}) {
  if (!guildId || !query || query.length < 3) return '';
  try {
    const entries = await classSummaries.searchKnowledge(guildId, query, { limit });
    if (!entries.length) return '';
    return entries.map((entry, idx) => {
      const when = entry.created_at ? `<t:${Math.floor(new Date(entry.created_at).getTime() / 1000)}:f>` : 'Unknown date';
      const body = entry.summary || (entry.content ? entry.content.slice(0, 280) : '');
      return `Entry ${idx + 1} (${when}) – ${entry.title || 'Untitled'}\n${body}`;
    }).join('\n\n');
  } catch (err) {
    console.warn('fetchKnowledgeContext failed:', err.message);
    return '';
  }
}

async function augmentPrompt({ guildId, basePrompt, searchText, limit = 3 }) {
  const knowledge = await fetchKnowledgeContext(guildId, searchText || basePrompt, { limit });
  if (!knowledge) return basePrompt;
  return `Use the knowledge entries below when relevant. If they do not resolve the prompt, explain what additional information is needed before answering.\n\nKnowledge entries:\n${knowledge}\n\nUser question/context:\n${basePrompt}`;
}

module.exports = {
  fetchKnowledgeContext,
  augmentPrompt,
};
