require('dotenv').config();

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSY = new Set(['0', 'false', 'no', 'off', 'disabled']);

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalised = String(value).trim().toLowerCase();
  if (TRUTHY.has(normalised)) return true;
  if (FALSY.has(normalised)) return false;
  return defaultValue;
}

const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  requireDatabaseSSL: parseBoolean(process.env.DATABASE_SSL_REQUIRED, true),
  openAI: {
    apiKey: process.env.OPENAI_API_KEY || '',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-latest',
  },
  features: {
    autoCreateCoreRoles: parseBoolean(process.env.JEFFREY_AUTO_SETUP_ROLES, true),
    autoAssignStudents: parseBoolean(process.env.JEFFREY_AUTO_ASSIGN_STUDENTS, true),
  },
  premium: {
    devMode: parseBoolean(process.env.JEFFREY_PREMIUM_DEV_MODE, false),
  },
};

module.exports = {
  config,
  parseBoolean,
};
