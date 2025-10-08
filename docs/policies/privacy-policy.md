# Jeffrey Privacy Policy

_Last updated: January 5, 2025_

Thank you for using Jeffrey. This Privacy Policy explains what information the Jeffrey Discord bot (“Jeffrey”, “we”, “us”) collects, how that information is used, and the choices you have to control it. By inviting Jeffrey to your Discord server or interacting with the bot, you agree to the practices described here.

## Information We Collect

Jeffrey collects only the data required to deliver its features:

- **Message metadata** such as author ID, channel ID, message ID, timestamps, and message content when you opt into message history search or queue management.
- **Queue and event data** recorded through Jeffrey’s commands (for example, queue entries, event titles, and scheduled times).
- **Guild configuration** including IDs for roles, channels, and feature toggles necessary to operate the bot inside your server.
- **Premium entitlements** supplied by Discord to determine which members can access paid AI features.

Jeffrey does **not** collect direct messages between users unless they explicitly use Jeffrey in that context, nor do we gather personal information beyond what Discord provides to bots.

## How We Use Your Information

- To deliver core functionality such as queues, documentation channels, and automated study reminders.
- To power optional AI features (code review, question answering, study tips) by securely sending the relevant prompt to OpenAI’s API when the feature is enabled.
- To monitor health and diagnose issues (for example, logging feature errors).

We do not sell or rent your data. Data is only shared with:

- **OpenAI** when you enable AI features. Shared content is limited to the prompt and context needed to generate a response and is transmitted securely using your configured API key.
- **Hosting providers** you select (for example, Heroku). They process the data strictly under your control.

## Data Storage and Retention

- Message history and queue data are stored in your configured PostgreSQL database. You control the retention period and can delete the data at any time.
- Temporary OpenAI responses are cached only long enough to deliver them to the requesting user.
- Deleted messages or queue entries are removed from the database during routine clean-up jobs or when you run the provided maintenance scripts.

## Your Choices and Controls

- Disable message backfill (`BACKFILL_ON_START=false`) to prevent historical imports.
- Turn off AI features entirely by omitting `OPENAI_API_KEY` or disabling the relevant premium settings.
- Remove Jeffrey from your server to stop all future collection.
- Delete queue or history data directly from the PostgreSQL database.

## Security

Connections to your database use TLS when supported. Jeffrey only runs with the Discord permissions you grant and can be configured to avoid privileged actions such as automatic role management.

## Contact

If you have questions about this policy or would like to request data deletion, open a ticket at **https://github.com/charlesacquah-davis/Jeffrey/issues**.

---

We may update this policy to reflect changes to the bot or applicable law. We will revise the “Last updated” date and share notable changes in the project README.
