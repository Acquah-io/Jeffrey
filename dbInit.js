// dbInit.js
// Ensures required Postgres tables and indexes exist.
const SQL = String.raw;

async function ensureSchema(client) {
  // public_messages with generated tsvector column + indexes
  await client.query(SQL`
    CREATE TABLE IF NOT EXISTS public_messages (
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      author_tag  TEXT NOT NULL,
      content     TEXT NOT NULL,
      ts          TIMESTAMPTZ NOT NULL,
      tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED
    );
  `);
  await client.query(SQL`CREATE INDEX IF NOT EXISTS idx_public_messages_ts           ON public_messages (ts);`);
  await client.query(SQL`CREATE INDEX IF NOT EXISTS idx_public_messages_guild_id    ON public_messages (guild_id);`);
  await client.query(SQL`CREATE INDEX IF NOT EXISTS idx_public_messages_channel_id  ON public_messages (channel_id);`);
  await client.query(SQL`CREATE INDEX IF NOT EXISTS idx_public_messages_tsv_gin     ON public_messages USING GIN (tsv);`);

  // queues table + unique (server_id, queue_name)
  await client.query(SQL`
    CREATE TABLE IF NOT EXISTS queues (
      id           BIGSERIAL PRIMARY KEY,
      server_id    TEXT NOT NULL,
      queue_name   TEXT NOT NULL,
      members      TEXT[] NOT NULL DEFAULT '{}',
      description  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (server_id, queue_name)
    );
  `);

  // blacklisted_users with composite PK
  await client.query(SQL`
    CREATE TABLE IF NOT EXISTS blacklisted_users (
      server_id  TEXT    NOT NULL,
      queue_id   BIGINT  NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      user_id    TEXT    NOT NULL,
      PRIMARY KEY (server_id, queue_id, user_id)
    );
  `);
}

module.exports = { ensureSchema };

