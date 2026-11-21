import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const cost = Number(n);
    const blockSize = Number(r);
    const parallelization = Number(p);
    if (!Number.isInteger(cost) || cost < 16_384 || cost > 262_144 || !Number.isInteger(blockSize) || blockSize < 1 || blockSize > 32 || !Number.isInteger(parallelization) || parallelization < 1 || parallelization > 8) return false;
    const derived = await scrypt(String(password), Buffer.from(saltText, 'base64url'), 64, { N: cost, r: blockSize, p: parallelization });
    const expected = Buffer.from(hashText, 'base64url');
    return expected.length === derived.length && timingSafeEqual(expected, Buffer.from(derived));
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return cookies;
    try { cookies[key] = decodeURIComponent(value); } catch { /* Ignore malformed cookies. */ }
    return cookies;
  }, {});
}

export function serializeCookie(name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, `Max-Age=${Math.max(0, Math.floor(options.maxAge || 0))}`, 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clientIp(request, trustedProxy = false) {
  if (trustedProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}
