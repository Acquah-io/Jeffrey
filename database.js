// database.js

const { Client } = require('pg'); // PostgreSQL client library
const { config } = require('./config');

// In commands deploy or when explicitly skipped, don't open a DB connection.
const SKIP_DB = process.env.COMMANDS_DEPLOY === '1' || process.env.SKIP_DB_CONNECT === '1';

if (SKIP_DB) {
  console.log('Skipping PostgreSQL connection (commands deploy mode)');
  // Lightweight stub to prevent accidental use
  module.exports = {
    query: async () => { throw new Error('DB not available during commands deploy'); },
    end: async () => {},
    configured: false,
  };
} else {
  if (!config.databaseUrl) {
    console.warn('DATABASE_URL is not set. Database-backed features are disabled until it is provided.');
    module.exports = {
      query: async () => { throw new Error('Database is not configured. Set DATABASE_URL to enable database features.'); },
      end: async () => {},
      configured: false,
    };
    return;
  }

  // Create a new PostgreSQL client instance
  const client = new Client({
      connectionString: config.databaseUrl, // Use DATABASE_URL from environment variables
      ssl: config.requireDatabaseSSL ? { rejectUnauthorized: false } : false,
  });

  // Connect to the database
  client.connect()
      .then(() => console.log('Connected to PostgreSQL'))
      .catch(err => console.error('Database connection error:', err.message || err));

  // Export the client for use in other parts of your bot
  client.configured = true;
  module.exports = client;
}
