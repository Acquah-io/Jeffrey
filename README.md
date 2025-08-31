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
3. Optional: set `BACKFILL_ON_START=true` to backfill historical channel messages into Postgres on startup (can be slow and rate‑limited on large servers). Leave it unset/false in production unless you explicitly want a full import.
4. Start the bot with `npm start`.

The bot reads the `OPENAI_API_KEY` environment variable for OpenAI access.

## Heroku deployment

Heroku reads the `Procfile` and runs `npm start` continuously. Set the same environment variables in the Heroku dashboard and the bot will stay online as long as the dyno is running.

## App Directory + Payments

- App Directory: Prepare your listing (description, icon, categories, commands, support server, privacy policy, terms) in the Discord Developer Portal. Keep requested permissions minimal; Administrator is simplest but consider narrowing to only what’s needed for listing.
- Payments (Premium Apps): Premium is required for AI features only; queues and events are free.
  - Env vars:
    - `PREMIUM_SKU_USER` (recommended): comma-separated SKU IDs for user‑level Premium (unlocks AI features: code review, Q&A, history).
    - `PREMIUM_PURCHASE_URL` (optional): link shown when prompting users to subscribe.
  - Behavior: If `PREMIUM_SKU_USER` is unset, all features run free (dev mode). When set, the bot checks user entitlements before invoking OpenAI features and replies with a friendly subscribe prompt if missing.

See `docs/app-directory-listing.md` for ready-to-use listing copy and permissions rationale.
