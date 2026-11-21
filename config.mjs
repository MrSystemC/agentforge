import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const env = process.env;

function integer(name, fallback, minimum, maximum) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) return fallback;
  return value;
}

function list(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

const nodeEnv = env.NODE_ENV || 'development';
const authMode = env.AUTH_MODE || (nodeEnv === 'production' ? 'required' : 'off');
const sessionSecret = env.SESSION_SECRET || '';
const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = String(env.ADMIN_PASSWORD || '');

if (nodeEnv === 'production' && authMode === 'required' && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production');
}
if (nodeEnv === 'production' && authMode === 'required' && (!adminEmail || adminPassword.length < 12)) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD with at least 12 characters are required in production');
}

export const config = Object.freeze({
  root,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: integer('PORT', 4173, 1, 65535),
  host: env.HOST || '0.0.0.0',
  dataFile: env.AGENTFORGE_DATA_FILE || join(root, 'data', 'agentforge.json'),
  authMode,
  sessionSecret: sessionSecret || 'development-only-agentforge-session-secret',
  sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 60 * 60 * 12, 300, 60 * 60 * 24 * 30),
  cookieName: env.SESSION_COOKIE_NAME || 'agentforge_session',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production',
  trustedProxy: env.TRUSTED_PROXY === 'true',
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  maxBodyBytes: integer('MAX_BODY_BYTES', 2_000_000, 10_000, 20_000_000),
  rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
  rateLimitMax: integer('RATE_LIMIT_MAX', 240, 10, 10_000),
  openaiUrl: env.OPENAI_URL || 'https://api.openai.com/v1',
  openaiKey: String(env.OPENAI_API_KEY || '').trim(),
  openaiModel: env.OPENAI_MODEL || 'gpt-6.2-astra',
  adminEmail,
  adminPassword,
  logLevel: env.LOG_LEVEL || 'info'
});

export function dataDirectory() {
  return dirname(config.dataFile);
}
