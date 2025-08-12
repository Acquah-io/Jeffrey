-- Full‑text search support for public_messages
-- Option A: Generated column (PostgreSQL 12+)

ALTER TABLE public_messages
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_public_messages_tsv
  ON public_messages USING GIN (tsv);

