// features/dmHistory.js
const { OpenAI } = require("openai");
const clientDB = require("../database");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Send history snippets + the user’s original prompt to GPT‑4o and reply.
 * @param {Message} msg        original Discord message (for reply)
 * @param {string} snippets    newline‑separated history lines
 * @param {string} userPrompt  original DM text
 */
async function respondWithLLM(msg, snippets, userPrompt) {
  const answer = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are Jeffrey, an assistant who answers using the provided Discord history. " +
          "If the history does not answer the question, say you couldn’t find anything."
      },
      { role: "system", content: `History:\n${snippets}` },
      { role: "user", content: userPrompt }
    ]
  });
  return msg.reply(answer.choices[0].message.content);
}

/* ---------- helpers ---------- */
const EXPLICIT_HISTORY =
  /^(who asked|who sent|when .*asked|show me .*answers?|what (?:was|were) (?:mentioned|discussed|talked about|the discussion)|what did we (?:talk|chat) about|who said|what was the last message|how many messages|between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}|in the last \d+ (?:hours?|days?))/i;
  const normaliseUser = (s) => s.replace(/[<@!>]/g, "").toLowerCase().trim();

function parseWhoAsked(txt) {
  const lower = txt.toLowerCase();
  const d = lower.match(/on (\d{4}-\d{2}-\d{2})/);
  let terms = lower
    .replace(/who asked( the question)?/i, "")
    .replace(/on \d{4}-\d{2}-\d{2}.*/, "")
    .trim();
  return { terms, date: d ? d[1] : null };
}


async function needsHistory(query) {
  if (EXPLICIT_HISTORY.test(query)) return true;
  const probe = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Reply YES if this message requires searching past Discord messages; otherwise NO.",
      },
      { role: "user", content: query },
    ],
  });
  return probe.choices[0].message.content.trim().startsWith("YES");
}

/**
 * Latest message in the guild.
 */
async function lastMessage(msg) {
    const gid = msg.client.guilds.cache.first().id;
    const row = (
      await clientDB.query(
        `SELECT author_tag, content, to_char(ts,'YYYY-MM-DD HH24:MI') ts
           FROM public_messages
          WHERE guild_id=$1
          ORDER BY ts DESC
          LIMIT 1`,
        [gid]
      )
    ).rows[0];
    if (!row) return msg.reply('No messages recorded yet.');
    return msg.reply(`The last message was by **${row.author_tag}** at ${row.ts}:\n> ${row.content}`);
  }
  
/**
 * Who most recently said a keyword.
 */
async function whoSaidTerm(msg, term, originalPrompt) {
  const gid = msg.client.guilds.cache.first().id;
  const row = (
    await clientDB.query(
      `SELECT author_tag, channel_id, id, to_char(ts,'YYYY-MM-DD HH24:MI') ts
         FROM public_messages
        WHERE guild_id=$1
          AND tsv @@ plainto_tsquery('english',$2)
        ORDER BY ts DESC LIMIT 1`,
      [gid, term]
    )
  ).rows[0];
  if (!row) return msg.reply(`No one mentioned "${term}".`);

  const link = `https://discord.com/channels/${gid}/${row.channel_id}/${row.id}`;
  const snippet = `${row.author_tag} (${row.ts}) [Jump](${link}): ${term}`;
  return respondWithLLM(msg, snippet, originalPrompt);
}
  
/**
 * Most recent message by a user (any content).
 */
async function lastMessageByUser(msg, userRaw, originalPrompt) {
  const gid = msg.client.guilds.cache.first().id;
  const tag = normaliseUser(userRaw);
  const row = (
    await clientDB.query(
      `SELECT content, channel_id, id, to_char(ts,'YYYY-MM-DD HH24:MI') ts
         FROM public_messages
        WHERE guild_id=$1 AND lower(author_tag) LIKE $2
        ORDER BY ts DESC LIMIT 1`,
      [gid, `%${tag}%`]
    )
  ).rows[0];
  if (!row) return msg.reply(`No messages from **${userRaw}** found.`);

  const link = `https://discord.com/channels/${gid}/${row.channel_id}/${row.id}`;
  const snippet = `${userRaw} (${row.ts}) [Jump](${link}): ${row.content}`;
  return respondWithLLM(msg, snippet, originalPrompt);
}

// ----------- relative-date helper -----------
const chrono = require("chrono-node");

/**
 * Parse "between YYYY-MM-DD and YYYY-MM-DD" → {start,end}
 */
function parseAbsoluteRange(text) {
  const m = text.match(/between (\d{4}-\d{2}-\d{2}) and (\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  return { start: new Date(m[1] + 'T00:00:00Z'), end: new Date(m[2] + 'T23:59:59Z') };
}

/**
 * Convert "yesterday", "last Friday", "last week" → {start, end} Date objects.
 * For single-day phrases we set start = 00:00 and end = 23:59 of that day.
 * For "last week" we return the ISO week Mon-Sun preceding today.
 */
function parseDateRange(phrase) {
  // chrono returns an array of ParsedResult; take first
  const parsed = chrono.parse(phrase)[0];
  if (!parsed) return null;

  const startDate = parsed.start.date();
  let endDate = parsed.end ? parsed.end.date() : new Date(startDate);
  // If no explicit end, cover the whole day
  if (!parsed.end) endDate.setHours(23, 59, 59, 999);
  return { start: startDate, end: endDate };
}

/* ---------- retrieval ---------- */
const keywordSearch = async (gid, terms, n = 5) =>
  (
    await clientDB.query(
      `SELECT author_tag, content, ts
         FROM public_messages
        WHERE guild_id=$1 AND tsv @@ plainto_tsquery('english',$2)
        ORDER BY ts DESC LIMIT $3`,
      [gid, terms, n]
    )
  ).rows;

/* ---------- canned look-ups ---------- */
async function whoAsked(msg, raw) {
  const { terms, date } = parseWhoAsked(raw);
  if (!terms) return msg.reply("Which topic?");
  const gid = msg.client.guilds.cache.first().id;

  let sql = `SELECT author_tag, to_char(ts,'YYYY-MM-DD') d
               FROM public_messages
              WHERE guild_id=$1 AND tsv @@ plainto_tsquery('english',$2)`;
  const p = [gid, terms];
  if (date) {
    sql += " AND DATE(ts)=$3::date";
    p.push(date);
  }
  sql += " ORDER BY ts ASC LIMIT 1";
  const r = (await clientDB.query(sql, p)).rows[0];
  if (!r) return msg.reply("Couldn’t find that.");
  return msg.reply(`**${r.author_tag}** asked about "${terms}" on ${r.d}.`);
}

async function lastMention(msg, term) {
  const gid = msg.client.guilds.cache.first().id;
  const r = (
    await clientDB.query(
      `SELECT to_char(ts,'YYYY-MM-DD HH24:MI') t
         FROM public_messages
        WHERE guild_id=$1 AND tsv @@ plainto_tsquery('english',$2)
        ORDER BY ts DESC LIMIT 1`,
      [gid, term]
    )
  ).rows[0];
  if (!r) return msg.reply(`No one mentioned "${term}".`);
  return msg.reply(`Last mention of "${term}" was ${r.t}.`);
}

async function answerLookup(msg, terms) {
  const gid = msg.client.guilds.cache.first().id;
  const q = (
    await clientDB.query(
      `SELECT channel_id, ts FROM public_messages
        WHERE guild_id=$1 AND tsv @@ plainto_tsquery('english',$2)
        ORDER BY ts ASC LIMIT 1`,
      [gid, terms]
    )
  ).rows[0];
  if (!q) return msg.reply("Question not found.");
  const a = (
    await clientDB.query(
      `SELECT author_tag, content, to_char(ts,'YYYY-MM-DD HH24:MI') t
         FROM public_messages
        WHERE guild_id=$1 AND channel_id=$2 AND ts>$3
          AND author_tag NOT ILIKE '%Jeffrey%'
        ORDER BY ts ASC LIMIT 1`,
      [gid, q.channel_id, q.ts]
    )
  ).rows[0];
  if (!a) return msg.reply("No answer recorded.");
  return msg.reply(`**${a.author_tag}** answered at ${a.t}:\n> ${a.content}`);
}

async function lastQuestionBy(msg, userRaw) {
  const gid = msg.client.guilds.cache.first().id;
  const tag = normaliseUser(userRaw);
  const r = (
    await clientDB.query(
      `SELECT content, to_char(ts,'YYYY-MM-DD HH24:MI') t
         FROM public_messages
        WHERE guild_id=$1 AND lower(author_tag) LIKE $2
          AND content LIKE '%?'
        ORDER BY ts DESC LIMIT 1`,
      [gid, `%${tag}%`]
    )
  ).rows[0];
  if (!r) return msg.reply(`No question from **${userRaw}**.`);
  return msg.reply(`Their last question (${r.t}) was:\n> ${r.content}`);
}

async function msgsByUserOnDate(msg, userRaw, date) {
  const gid = msg.client.guilds.cache.first().id;
  const tag = normaliseUser(userRaw);
  const rows = (
    await clientDB.query(
      `SELECT content, to_char(ts,'HH24:MI') tm
         FROM public_messages
        WHERE guild_id=$1 AND lower(author_tag) LIKE $2 AND DATE(ts)=$3::date
        ORDER BY ts ASC LIMIT 3`,
      [gid, `%${tag}%`, date]
    )
  ).rows;
  if (!rows.length) return msg.reply(`No messages from ${userRaw} on ${date}.`);
  const out = rows.map((r) => `• ${r.tm} — ${r.content}`).join("\n");
  return msg.reply(`Messages from **${userRaw}** on ${date}:\n${out}`);
}

/**
 * Fetch up to five messages about a keyword within a date range.
 */
async function messagesInRange(msg, keyword, start, end) {
  const gid = msg.client.guilds.cache.first().id;
  const sql = `
    SELECT author_tag, content, to_char(ts,'YYYY-MM-DD HH24:MI') ts
      FROM public_messages
     WHERE guild_id = $1
       AND tsv @@ plainto_tsquery('english',$2)
       AND ts BETWEEN $3 AND $4
     ORDER BY ts ASC
     LIMIT 5;
  `;
  const { rows } = await clientDB.query(sql, [gid, keyword, start, end]);
  if (!rows.length) {
    return msg.reply(`No messages about "${keyword}" in that period.`);
  }
  const bullets = rows
    .map(r => `• ${r.ts} — **${r.author_tag}**: ${r.content}`)
    .join('\n');
  return msg.reply(
    `Here’s what we said about **${keyword}** between ${start
      .toISOString()
      .slice(0, 10)} and ${end.toISOString().slice(0, 10)}:\n${bullets}`
  );
}

/**
 * Return up to five messages (any topic) within a given date range.
 */
async function messagesInDateRange(msg, start, end) {
    const gid = msg.client.guilds.cache.first().id;
    const sql = `
      SELECT author_tag,
             content,
             to_char(ts,'YYYY-MM-DD HH24:MI') ts
        FROM public_messages
       WHERE guild_id = $1
         AND ts BETWEEN $2 AND $3
       ORDER BY ts ASC
       LIMIT 5;`;
    const { rows } = await clientDB.query(sql, [gid, start, end]);
    if (!rows.length) {
      return msg.reply('No messages found for that period.');
    }
    const bullets = rows
      .map(r => `• ${r.ts} — **${r.author_tag}**: ${r.content}`)
      .join('\n');
    return msg.reply(
      `Here’s what was discussed between ${start.toISOString().slice(0,10)} and ${end
        .toISOString()
        .slice(0,10)}:\n${bullets}`
    );
}

/**
 * Return a short summary (count + first/last mention) of a keyword in a date range.
 */
async function summaryOfKeyword(msg, keyword, start, end) {
  const gid = msg.client.guilds.cache.first().id;
  const sql = `
    WITH hits AS (
      SELECT author_tag, content, ts
        FROM public_messages
       WHERE guild_id=$1
         AND tsv @@ plainto_tsquery('english',$2)
         AND ts BETWEEN $3 AND $4
       ORDER BY ts
    )
    SELECT COUNT(*)                        AS total,
           MIN(ts)                         AS first_ts,
           MAX(ts)                         AS last_ts
      FROM hits;`;
  const { rows } = await clientDB.query(sql, [gid, keyword, start, end]);
  const { total, first_ts, last_ts } = rows[0];
  if (total === "0") {
    return msg.reply(`No mentions of **${keyword}** in that period.`);
  }
  return msg.reply(
    `**${keyword}** was mentioned **${total}** time(s) between ${start
      .toISOString()
      .slice(0,10)} and ${end.toISOString().slice(0,10)}.\nFirst: ${first_ts}\nLast: ${last_ts}`
  );
}

/**
 * Count messages by user in a date range.
 */
async function countUserMessages(msg, userRaw, start, end) {
  const gid = msg.client.guilds.cache.first().id;
  const tag = normaliseUser(userRaw);
  const { rows } = await clientDB.query(
    `SELECT COUNT(*) AS c
       FROM public_messages
      WHERE guild_id=$1
        AND lower(author_tag) LIKE $2
        AND ts BETWEEN $3 AND $4`,
    [gid, `%${tag}%`, start, end]
  );
  return msg.reply(`**${userRaw}** sent **${rows[0].c}** message(s) in that period.`);
}

/**
 * Messages in a specific channel within a date range (top 5).
 */
async function messagesInChannelRange(msg, channelName, start, end) {
  const gid = msg.client.guilds.cache.first().id;
  // Resolve channel → id mapping
  const guild = msg.client.guilds.cache.get(gid);
  const channel = guild.channels.cache.find(
    c => c.name.toLowerCase() === channelName.toLowerCase().replace('#','')
  );
  if (!channel) return msg.reply(`Channel **${channelName}** not found.`);
  const { rows } = await clientDB.query(
    `SELECT author_tag, content, to_char(ts,'YYYY-MM-DD HH24:MI') ts
       FROM public_messages
      WHERE guild_id=$1 AND channel_id=$2
        AND ts BETWEEN $3 AND $4
      ORDER BY ts ASC
      LIMIT 5`,
    [gid, channel.id, start, end]
  );
  if (!rows.length) return msg.reply('No messages found for that period in that channel.');
  const out = rows.map(r => `• ${r.ts} — **${r.author_tag}**: ${r.content}`).join('\n');
  return msg.reply(`Messages in **#${channelName}** between ${start.toISOString().slice(0,10)} and ${end.toISOString().slice(0,10)}:\n${out}`);
}

/* ---------- DM router ---------- */
async function handleDmMessage(msg) {
  const t = msg.content.trim();

  if (/^who asked/i.test(t)) return whoAsked(msg, t);
  const lm = t.match(/when was (.+) last mentioned/i);
  if (lm) return lastMention(msg, lm[1].trim());
  const ans = t.match(/what was the answer .*about (.+)/i);
  if (ans) return answerLookup(msg, ans[1].trim());
  const q = t.match(/what was the question ([\w@!<>&#]+) asked\??/i);
  if (q) return lastQuestionBy(msg, q[1]);
  const on = t.match(/what did ([\w@!<>&#]+) say on (\d{4}-\d{2}-\d{2})/i);
  if (on) return msgsByUserOnDate(msg, on[1], on[2]);

  // e.g. "what was mentioned yesterday", "what did we talk about last friday"
  const dayRange = t.match(
    /what (?:was|were) (?:mentioned|discussed|talked about)(?: in the chat)? (yesterday|last week|last month|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i
  );
  if (dayRange) {
    const phrase = dayRange[1];
    const range = parseDateRange(phrase);
    if (!range) return msg.reply("Sorry, I couldn't recognise that time period.");
    return messagesInDateRange(msg, range.start, range.end);
  }

  const topicRange = t.match(
    /(?:what (?:was|were)|what did we (?:talk|chat) about).* (?:about|on) (.+?) (yesterday|last week|last month|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i
  );
  if (topicRange) {
    const term = topicRange[1].trim();
    const phrase = topicRange[2];
    const range = parseDateRange(phrase);
    if (!range) return msg.reply("Sorry, I couldn't recognise that time period.");
    return messagesInRange(msg, term, range.start, range.end);
  }

  /* ---------- absolute date-range "between X and Y" ---------- */
  const absRange = parseAbsoluteRange(t);
  if (absRange && /about (.+?) between/i.test(t)) {
    const term = t.match(/about (.+?) between/i)[1].trim();
    return summaryOfKeyword(msg, term, absRange.start, absRange.end);
  }

  /* ---------- past N days/hours ---------- */
  const pastMatch = t.match(/how many messages has ([\w@!<>&#]+) sent in the last (\d+) (hour|hours|day|days)/i);
  if (pastMatch) {
    const user = pastMatch[1];
    const n = parseInt(pastMatch[2], 10);
    const unit = pastMatch[3].startsWith('hour') ? 'hours' : 'days';
    const end = new Date();
    const start = new Date();
    if (unit === 'hours') start.setHours(start.getHours() - n);
    else start.setDate(start.getDate() - n);
    return countUserMessages(msg, user, start, end);
  }

  /* ---------- channel‑specific queries ---------- */
  const chRange = t.match(/what was discussed in (#?\w+) (yesterday|last week|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i);
  if (chRange) {
    const chan = chRange[1];
    const phrase = chRange[2];
    const range = parseDateRange(phrase);
    if (!range) return msg.reply("Couldn't parse that time phrase.");
    return messagesInChannelRange(msg, chan, range.start, range.end);
  }

  /* ---------- last message overall ---------- */
  if (/what was the last message(?: in (?:the )?(?:public|general) chat)?\s*\??$/i.test(t)) {
    return lastMessage(msg);
  }

  // who said ...
  const whoSaid = t.match(/who said (.+)/i);
  if (whoSaid) {
    return whoSaidTerm(msg, whoSaid[1].trim(), t);
  }

  // what did <user> say (last message)
  const whatDidUserSay = t.match(/what did ([\w@!<>&#]+) say\??/i);
  if (whatDidUserSay) {
    return lastMessageByUser(msg, whatDidUserSay[1], t);
  }

  if (await needsHistory(t)) {
    const gid = msg.client.guilds.cache.first().id;
    const rows = await keywordSearch(gid, t, 5);
    if (!rows.length) return msg.reply("No relevant messages found.");
    const ctx = rows
      .map((r) => `${r.author_tag} (${r.ts.toISOString().slice(0, 16)}): ${r.content}`)
      .join("\n");
    const ans = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Use the history snippets to answer." },
        { role: "system", content: `History:\n${ctx}` },
        { role: "user", content: t },
      ],
    });
    return msg.reply(ans.choices[0].message.content);
  }

  // small talk
  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are Jeffrey, a helpful assistant." },
      { role: "user", content: t },
    ],
  });
  return msg.reply(chat.choices[0].message.content);
}

module.exports = { handleDmMessage };
