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

The bot reads the `OPENAI_API_KEY` environment variable for OpenAI access.

## Heroku deployment

Heroku reads the `Procfile` and runs `npm start` continuously. Set the same environment variables in the Heroku dashboard and the bot will stay online as long as the dyno is running.

## Polling

1. In the `#polls` channel, click **Create Poll**.
2. Fill out the modal with your question and comma‑separated options. Polls support up to 10 options.
3. A message will appear in `#general` with a select menu. Choose an option to cast your vote.
4. When a staff member presses **Close Poll**, the poll ends and the final results are shown.
