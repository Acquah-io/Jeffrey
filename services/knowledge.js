const chrono = require('chrono-node');
const db = require('../database');
const classSummaries = require('./classSummaries');

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

function extractDateRange(text) {
  if (!text) return null;

  const absolute = text.match(/between (\d{4}-\d{2}-\d{2}) and (\d{4}-\d{2}-\d{2})/i);
  if (absolute) {
    const start = new Date(`${absolute[1]}T00:00:00Z`);
    const end = new Date(`${absolute[2]}T23:59:59Z`);
    return { start, end };
  }

  const parsed = chrono.parse(text)[0];
  if (!parsed || !parsed.start) return null;

  const start = parsed.start.date();
  start.setHours(0, 0, 0, 0);
  const end = parsed.end ? parsed.end.date() : new Date(start);
  if (!parsed.end) end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function fetchKnowledgeContext(guildId, query, { limit = 3 } = {}) {
  if (!guildId || !query || query.length < 3) return '';
  try {
    const entries = await classSummaries.searchKnowledge(guildId, query, { limit });
    if (!entries.length) return '';
    return entries.map((entry, idx) => {
      const when = discordTimestamp(entry.created_at);
      const bodySource = sanitizeText(entry.summary) || sanitizeText(entry.content);
      const body = truncate(bodySource, MAX_SNIPPET_LENGTH);
      return `Entry ${idx + 1} (${when}) – ${entry.title || 'Untitled'}\n${body}`;
    }).join('\n\n');
  } catch (err) {
    console.warn('fetchKnowledgeContext failed:', err.message);
    return '';
  }
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

async function fetchSessionContext(guildId, query, { limit = 3 } = {}) {
  if (!guildId || !query) return '';
  const pieces = [];
  const seen = new Set();

  const addSession = (session) => {
    if (!session || session.guild_id !== guildId || seen.has(session.id)) return;
    seen.add(session.id);
    const startedAt = session.started_at || session.ended_at;
    const headerTs = discordTimestamp(startedAt);
    const header = `Session ${session.id} (${session.topic || 'Untitled'}) – ${headerTs}`;
    const summary = truncate(sanitizeText(session.summary));
    const transcriptPreview = truncate(sanitizeText(session.transcript), 280);
    const lines = [header];
    if (summary) lines.push(`Summary: ${summary}`);
    if (transcriptPreview) {
      lines.push(`Transcript excerpt: ${transcriptPreview}`);
    }
    pieces.push(lines.join('\n'));
  };

  try {
    const idMatch = query.match(/session\s*#?(\d+)/i);
    if (idMatch) {
      const session = await classSummaries.getSession(Number(idMatch[1]));
      addSession(session);
    }

    const range = extractDateRange(query);
    if (range?.start && range?.end) {
      const sessions = await classSummaries.listSessionsInRange(guildId, {
        start: range.start,
        end: range.end,
        limit,
      });
      sessions.forEach(addSession);
    }
  } catch (err) {
    console.warn('fetchSessionContext failed:', err.message);
  }

  return pieces.join('\n\n');
}

async function augmentPrompt({ guildId, basePrompt, searchText, limit = 3, channelId }) {
  const contexts = [];

  const knowledge = await fetchKnowledgeContext(guildId, searchText || basePrompt, { limit });
  if (knowledge) {
    contexts.push(`Knowledge entries:\n${knowledge}`);
  }

  const chatContext = await fetchGeneralChatContext(guildId, searchText || basePrompt, {
    channelId,
  });
  if (chatContext) {
    contexts.push(`General chat context:\n${chatContext}`);
  }

  const sessionContext = await fetchSessionContext(guildId, searchText || basePrompt, { limit });
  if (sessionContext) {
    contexts.push(`Session archives:\n${sessionContext}`);
  }

  if (!contexts.length) return `Respond in English only. ${basePrompt}`;

  return `Respond in English only. Use the context below when it helps answer the request. If the context is insufficient, explain what additional information is needed before answering.\n\n${contexts.join('\n\n')}\n\nUser question/context:\n${basePrompt}`;
}

module.exports = {
  fetchKnowledgeContext,
  fetchGeneralChatContext,
  fetchSessionContext,
  augmentPrompt,
};
