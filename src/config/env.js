const path = require('node:path');
require('dotenv').config();

const root = path.resolve(__dirname, '../..');
const displayTimezone = process.env.DISPLAY_TIMEZONE || 'UTC';
const { normalizePublicBaseUrl } = require('../utils/scan-url');
const publicBaseUrl = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
try { new Intl.DateTimeFormat('en', { timeZone: displayTimezone }); }
catch { throw new Error('DISPLAY_TIMEZONE must be a valid IANA timezone'); }
module.exports = {
  root,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-session-secret-change-me',
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/assessment.sqlite'),
  publicBaseUrl,
  trustedProxyCidrs: (process.env.TRUST_PROXY_CIDRS || '').split(',').map(value => value.trim()).filter(Boolean),
  displayTimezone,
  landingMessage: process.env.LANDING_MESSAGE || 'This QR code is part of an authorized security awareness assessment. Please follow your organization’s guidance before scanning unexpected codes.',
  retentionDays: Math.max(1, Number(process.env.RETENTION_DAYS || 365)),
};
