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

### Optional feature toggles

- `JEFFREY_AUTO_SETUP_ROLES=false` — keep Jeffrey from auto-creating the **Staff** and **Students** roles. Create them manually if you still want queue permissions.
- `JEFFREY_AUTO_ASSIGN_STUDENTS=false` — disable automatic assignment of the **Students** role to every member. Recommended for public App Directory installs.
- `JEFFREY_PREMIUM_DEV_MODE=1` — bypass Premium entitlement checks for local development only. Leave unset in production so `/smart_search` and other AI-powered tools stay paywalled.

## Heroku deployment

Heroku reads the `Procfile` and runs `npm start` continuously. Set the same environment variables in the Heroku dashboard and the bot will stay online as long as the dyno is running.

## App Directory + Payments

- App Directory: Prepare your listing (description, icon, categories, commands, support, privacy policy, terms) in the Discord Developer Portal. Grant the bot only the permissions it needs (view/send messages, manage channels, optional manage roles) instead of Administrator. Configure your Premium SKUs (`PREMIUM_SKU_USER` / `PREMIUM_SKU_GUILD`) before launch—AI commands stay locked otherwise.
- Payments (Premium Apps): Premium is required for AI features only; queues and events are free.
  - Env vars:
    - `PREMIUM_SKU_USER` (recommended): comma-separated SKU IDs for user‑level Premium (unlocks AI features: code review, Q&A, history).

Command registration: The bot registers slash commands from the `features/` directory on startup. The optional `deploy-commands.js` script now reads from `features/` too, so both paths stay in sync.
    - `PREMIUM_PURCHASE_URL` (optional): link shown when prompting users to subscribe.
  - Behavior: AI commands stay disabled until Jeffrey sees an active entitlement (or you toggle `JEFFREY_PREMIUM_DEV_MODE=1` for local testing). With SKUs configured, the bot checks user/guild entitlements and replies with a subscribe prompt when access is missing.

See `docs/app-directory-listing.md` for ready-to-use listing copy and permissions rationale.

## Database housekeeping

As of the removal of the `/language` command and per‑user/per‑guild language preferences, the following tables are no longer used and can be safely dropped if they exist:

- `user_settings`
- `guild_settings`

Run the cleanup script locally or in your deploy environment:

```
npm run db:drop-unused
```

It connects using `DATABASE_URL` and drops those tables with `IF EXISTS` safeguards.

## Slash command scope (avoid duplicates)

If you see each command twice in a guild, it usually means you registered both globally and per‑guild. Configure the scope with `COMMAND_SCOPE`:

- `COMMAND_SCOPE=guild` (default): Register per‑guild only (fast updates, no duplication).
- `COMMAND_SCOPE=global`: Register globally only (slower propagation).
- `COMMAND_SCOPE=both`: Register both (not recommended; can appear duplicated).

To clear out old commands:

- Purge guild commands: set `GUILD_ID` in `.env` and run `npm run commands:purge`.
- Purge global commands: unset `GUILD_ID` and run `npm run commands:purge`.

Deploy commands explicitly if needed with `npm run commands:deploy` (respects `GUILD_ID`).
