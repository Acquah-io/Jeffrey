const db = require('../database');

const MAX_SNIPPET_LENGTH = 360;

function sanitizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, limit = MAX_SNIPPET_LENGTH) {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

function discordTimestamp(date) {
  if (!date) return 'Unknown date';
  const seconds = Math.floor(new Date(date).getTime() / 1000);
  if (!Number.isFinite(seconds)) return 'Unknown date';
  return `<t:${seconds}:f>`;
}

function formatMessageRow(row) {
  const content = truncate(sanitizeText(row.content));
  if (!content) return null;
  const tsLabel = discordTimestamp(row.ts);
  return `${row.author_tag} in <#${row.channel_id}> at ${tsLabel}: ${content}`;
}

function normaliseSearch(query) {
  return sanitizeText(query).replace(/[^\w\s'-]/g, ' ').trim();
}

async function fetchGeneralChatContext(guildId, query, { channelId, recentLimit = 6, searchLimit = 5, recentHours = 12 } = {}) {
  if (!guildId) return '';
  const sections = [];
  const seen = new Set();

  const collect = (rows, label) => {
    if (!rows?.length) return;
    const ordered = rows
      .filter(row => row && !seen.has(row.id) && sanitizeText(row.content))
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (!ordered.length) return;
    ordered.forEach(row => seen.add(row.id));
    const lines = ordered
      .map(row => formatMessageRow(row))
      .filter(Boolean);
    if (lines.length) {
      sections.push(`${label}:\n${lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`);
    }
  };

  try {
    if (channelId) {
      const recentCutoff = new Date(Date.now() - recentHours * 60 * 60 * 1000);
      const recent = await db.query(
        `SELECT id, author_tag, content, ts, channel_id
           FROM public_messages
          WHERE guild_id = $1 AND channel_id = $2 AND ts >= $3
          ORDER BY ts DESC
          LIMIT $4`,
        [guildId, channelId, recentCutoff, recentLimit]
      );
      collect(recent.rows, 'Recent channel messages');
    }

    const searchTerms = normaliseSearch(query);
    if (searchTerms && searchTerms.length >= 3) {
      const matches = await db.query(
        `SELECT id, author_tag, content, ts, channel_id
           FROM public_messages
          WHERE guild_id = $1
            AND tsv @@ plainto_tsquery('english', $2)
          ORDER BY ts DESC
          LIMIT $3`,
        [guildId, searchTerms, searchLimit]
      );
      collect(matches.rows, 'Relevant general chat messages');
    }

    if (!sections.length) {
      const fallback = await db.query(
        `SELECT id, author_tag, content, ts, channel_id
           FROM public_messages
          WHERE guild_id = $1
          ORDER BY ts DESC
          LIMIT $2`,
        [guildId, Math.max(recentLimit, searchLimit)]
      );
      collect(fallback.rows, 'Recent guild messages');
    }
  } catch (err) {
    console.warn('fetchGeneralChatContext failed:', err.message);
  }

  return sections.join('\n\n');
}

async function augmentPrompt({ guildId, basePrompt, searchText, channelId }) {
  const chatContext = await fetchGeneralChatContext(guildId, searchText || basePrompt, {
    channelId,
  });

  if (!chatContext) return `Respond in English only. ${basePrompt}`;

  return `Respond in English only. Use the context below when it helps answer the request. If the context is insufficient, explain what additional information is needed before answering.\n\nGeneral chat context:\n${chatContext}\n\nUser question/context:\n${basePrompt}`;
}

module.exports = {
  fetchGeneralChatContext,
  augmentPrompt,
};
