const db = require('../database');
const SQL = String.raw;

async function createSession({ guildId, channelId, recorderId, topic, meta = {} }) {
  const { rows } = await db.query(SQL`
    INSERT INTO voice_sessions (guild_id, channel_id, recorder_id, topic, meta)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *
  `, [guildId, channelId, recorderId, topic || null, JSON.stringify(meta)]);
  return rows[0];
}

async function updateSession(sessionId, payload) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (key === 'meta') {
      fields.push(`meta = $${idx}::jsonb`);
      values.push(typeof value === 'string' ? value : JSON.stringify(value));
    } else {
      fields.push(`${key} = $${idx}`);
      values.push(value);
    }
    idx += 1;
  }
  if (!fields.length) return null;
  values.push(sessionId);
  const { rows } = await db.query(`
    UPDATE voice_sessions
       SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING *
  `, values);
  return rows[0] || null;
}

async function closeSession(sessionId, { summary, transcript, meta, endedAt = new Date() } = {}) {
  return updateSession(sessionId, {
    summary: summary ?? null,
    transcript: transcript ?? null,
    meta: meta || undefined,
    ended_at: endedAt,
  });
}

async function recordParticipantJoin({ sessionId, userId, joinedAt = new Date() }) {
  await db.query(SQL`
    INSERT INTO voice_session_participants (session_id, user_id, joined_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET joined_at = LEAST(voice_session_participants.joined_at, EXCLUDED.joined_at)
  `, [sessionId, userId, joinedAt]);
}

async function recordParticipantLeave({ sessionId, userId, leftAt = new Date() }) {
  await db.query(SQL`
    UPDATE voice_session_participants
       SET left_at = $3
     WHERE session_id = $1 AND user_id = $2
  `, [sessionId, userId, leftAt]);
}

async function listSessions(guildId, { limit = 10, offset = 0 } = {}) {
  const { rows } = await db.query(SQL`
    SELECT *
      FROM voice_sessions
     WHERE guild_id = $1
     ORDER BY started_at DESC
     LIMIT $2 OFFSET $3
  `, [guildId, limit, offset]);
  return rows;
}

async function getSession(sessionId) {
  const { rows } = await db.query(SQL`
    SELECT * FROM voice_sessions WHERE id = $1
  `, [sessionId]);
  return rows[0] || null;
}

async function getLatestSessionForChannel(guildId, channelId) {
  const { rows } = await db.query(SQL`
    SELECT *
      FROM voice_sessions
     WHERE guild_id = $1
       AND channel_id = $2
     ORDER BY started_at DESC
     LIMIT 1
  `, [guildId, channelId]);
  return rows[0] || null;
}

async function recordDelivery({ sessionId, userId, deliveredBy }) {
  await db.query(SQL`
    INSERT INTO voice_session_deliveries (session_id, user_id, delivered_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET delivered_at = NOW(), delivered_by = $3
  `, [sessionId, userId, deliveredBy || null]);
}

async function getDeliveries(sessionId) {
  const { rows } = await db.query(SQL`
    SELECT * FROM voice_session_deliveries WHERE session_id = $1
  `, [sessionId]);
  return rows;
}

async function storeKnowledgeSnippet({ sessionId, guildId, title, summary, content }) {
  await db.query(SQL`
    INSERT INTO knowledge_snippets (guild_id, source, source_id, title, summary, content)
    VALUES ($1, 'voice_session', $2, $3, $4, $5)
    ON CONFLICT (source, source_id) DO UPDATE
      SET summary = EXCLUDED.summary,
          content = EXCLUDED.content,
          title   = EXCLUDED.title
  `, [guildId, sessionId, title || null, summary || null, content]);
}

async function searchKnowledge(guildId, query, { limit = 5 } = {}) {
  const { rows } = await db.query(SQL`
    SELECT id, title, summary, content, created_at
      FROM knowledge_snippets
     WHERE guild_id = $1
       AND tsv @@ plainto_tsquery('english', $2)
     ORDER BY created_at DESC
     LIMIT $3
  `, [guildId, query, limit]);
  return rows;
}

module.exports = {
  createSession,
  updateSession,
  closeSession,
  recordParticipantJoin,
  recordParticipantLeave,
  listSessions,
  getSession,
  getLatestSessionForChannel,
  recordDelivery,
  getDeliveries,
  storeKnowledgeSnippet,
  searchKnowledge,
};
