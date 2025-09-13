// database.js

const { Client } = require('pg'); // PostgreSQL client library
require('dotenv').config(); // Loads environment variables from a .env file

// In commands deploy or when explicitly skipped, don't open a DB connection.
const SKIP_DB = process.env.COMMANDS_DEPLOY === '1' || process.env.SKIP_DB_CONNECT === '1';

if (SKIP_DB) {
  console.log('Skipping PostgreSQL connection (commands deploy mode)');
  // Lightweight stub to prevent accidental use
  module.exports = {
    query: async () => { throw new Error('DB not available during commands deploy'); },
    end: async () => {},
  };
} else {
  // Create a new PostgreSQL client instance
  const client = new Client({
      connectionString: process.env.DATABASE_URL, // Use DATABASE_URL from environment variables
      ssl: {
          rejectUnauthorized: false, // Required for Heroku's PostgreSQL setup
      },
  });

  // Connect to the database
  client.connect()
      .then(() => console.log('Connected to PostgreSQL'))
      .catch(err => console.error('Database connection error:', err));

  // Export the client for use in other parts of your bot
  module.exports = client;
}
