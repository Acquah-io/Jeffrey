# Jeffrey

A Discord bot that uses OpenAI and Postgres.

## Local setup

1. Run `npm install`.
2. Create a `.env` file in the project root with your tokens:
   - `ACCESS_TOKEN_DISCORD`
   - `CLIENT_ID`
   - `DATABASE_URL`
   - `GUILD_ID` (optional)
   - `OPENAI_API_KEY`
3. Start the bot with `npm start`.

Node.js **18 or higher** is required to run Jeffrey.

The bot reads the `OPENAI_API_KEY` environment variable for OpenAI access.

## Database: Full‑Text Search

The history features query `public_messages.tsv @@ plainto_tsquery('english', ...)`, which requires a `tsv` column of type `tsvector` and a GIN index. Apply the migration in `migrations/001_public_messages_fulltext.sql` to add a generated `tsv` column and index. If you already have the table, this migration is safe to run multiple times.

Expected table columns used by the bot:
- `id` (text, primary key) — Discord message ID
- `guild_id` (text)
- `channel_id` (text)
- `author_id` (text)
- `author_tag` (text)
- `content` (text)
- `ts` (timestamptz)
- `tsv` (tsvector, generated) — see migration

## Heroku deployment

Heroku reads the `Procfile` and runs `npm start` continuously. Set the same environment variables in the Heroku dashboard and the bot will stay online as long as the dyno is running.

## Study tips

A dedicated `#study-tip-settings` channel lets staff enable or disable weekly tips.
When enabled, every student receives a new tip via DM each Sunday at **12:00 UK time**.

## Security

- Do not commit your `.env` file. It is now ignored by `.gitignore`, but rotate any secrets that may have been previously committed.
