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

## Heroku deployment

Heroku reads the `Procfile` and runs `npm start` continuously. Set the same environment variables in the Heroku dashboard and the bot will stay online as long as the dyno is running.

## Study tips

A dedicated `#study-tip-settings` channel lets staff control how often tips are sent.
The pinned panel provides dropdown menus for the hour, minute, frequency and tip count. New tips are generated with ChatGPT and are delivered to every student via DM.
