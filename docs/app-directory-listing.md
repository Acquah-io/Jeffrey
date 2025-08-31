# Jeffrey — App Directory Listing Draft

## Short Description
AI-powered Discord assistant for code review, Q&A, and chat history search. Queues and event tools included for free.

## Long Description
Jeffrey helps your community learn and ship faster:

- Code Review: Paste code and get concise, actionable feedback in DMs or a thread.
- Q&A Assistant: Ask questions and get helpful, friendly answers using state‑of‑the‑art AI.
- Chat History Search: Ask natural‑language questions about past conversations (e.g., “what did we discuss in #help last Friday?”) backed by your server’s message history.
- Free Queues: Built‑in student/staff queue panels with blacklist, shuffle, clear, and edit tools.
- Events: Simple event creation and viewing.

Premium features use AI and require a subscription (see Pricing). Core utilities like queues and events remain free for everyone.

## Commands
- `/smart_search` — Natural‑language queries over chat history (Premium).
- `/viewevents` — Show upcoming events.
- `/createevent` — Create an event (Staff only).
- `/help` — Overview of features and tips.

Message-based features:
- Code Review prompts when you post code in backticks (Premium).
- Q&A helper offers DM/thread support when you ask a question ending with “?” (Premium).

## Permissions Rationale
- View Channels, Read Message History, Send Messages — required to read/write channels and respond.
- Manage Roles/Channels — used to create “Students/Staff” roles and manage queue channels and pinned panels.
- Add Reactions, Embed Links, Attach Files — for richer responses.
Note: Administrator simplifies setup, but you can grant finer-grained permissions to the bot role if preferred.

## Data Handling
Jeffrey stores minimal message metadata (author, channel, timestamp, content) in your database to power history queries. No data is shared with third parties beyond the chosen AI provider for Premium responses.

Privacy Policy: https://yourdomain.example/privacy
Terms of Service: https://yourdomain.example/terms
Support Server: https://discord.gg/your-support-invite
Website: https://yourdomain.example

## Pricing
- Free: Queues, events, help.
- Premium (User): AI features — Code Review, Q&A assistant, and History Search.

## Setup
1. Invite Jeffrey using the provided link.
2. The bot will create “Students” and “Staff” roles and set up queue and docs channels automatically.
3. Configure database connection and (optionally) enable history backfill.
4. Subscribe to unlock Premium features.

