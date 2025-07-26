const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ensure table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    message TEXT NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    done BOOLEAN DEFAULT FALSE,
    sent BOOLEAN DEFAULT FALSE
  )
`).catch(err => console.error('Failed to init reminders table:', err));

async function addReminder(userId, guildId, message, remindAt) {
  await pool.query(
    `INSERT INTO reminders (user_id, guild_id, message, remind_at)
     VALUES ($1,$2,$3,$4)`,
    [userId, guildId, message, remindAt]
  );
}

async function listReminders(userId) {
  const { rows } = await pool.query(
    `SELECT id, message, remind_at FROM reminders
     WHERE user_id=$1 AND done=false
     ORDER BY remind_at`,
    [userId]
  );
  return rows;
}

async function markDone(id) {
  await pool.query(`UPDATE reminders SET done=true WHERE id=$1`, [id]);
}

async function markSent(id) {
  await pool.query(`UPDATE reminders SET sent=true WHERE id=$1`, [id]);
}

async function getDueReminders() {
  const { rows } = await pool.query(
    `SELECT id, user_id, message FROM reminders
     WHERE done=false AND sent=false AND remind_at <= NOW()`
  );
  return rows;
}

function startWatcher(client) {
  setInterval(async () => {
    try {
      const due = await getDueReminders();
      for (const r of due) {
        try {
          const user = await client.users.fetch(r.user_id);
          await user.send(`⏰ Reminder: ${r.message}`);
          await markSent(r.id);
        } catch (err) {
          console.error('Failed to send reminder DM:', err);
        }
      }
    } catch (err) {
      console.error('Reminder watcher error:', err);
    }
  }, 60000); // every minute
}

module.exports = { addReminder, listReminders, markDone, startWatcher };
