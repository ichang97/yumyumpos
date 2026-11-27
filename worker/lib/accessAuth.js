import { getCookie } from 'hono/cookie';
import { decode, verifyWithJwks } from 'hono/jwt';
import { HttpError } from './validate.js';

const JWKS_TTL_MS = 10 * 60 * 1000;

let cachedKeys = null;
let cachedJwksUrl = '';
let cachedAt = 0;

export function clearJwksCache() {
  cachedKeys = null;
  cachedJwksUrl = '';
  cachedAt = 0;
}

function getAdminEmailSet(rawEmails) {
  return new Set(
    String(rawEmails || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function fetchJwks(jwksUrl, forceRefresh = false) {
  if (!forceRefresh && cachedKeys && cachedJwksUrl === jwksUrl && Date.now() - cachedAt < JWKS_TTL_MS) {
    return cachedKeys;
  }

  const res = await fetch(jwksUrl);
  if (!res.ok) {
    throw new HttpError(401, 'ไม่สามารถตรวจสอบสิทธิ์การเข้าใช้งานได้');
  }

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data?.keys) || data.keys.length === 0) {
    throw new HttpError(401, 'ไม่สามารถตรวจสอบสิทธิ์การเข้าใช้งานได้');
  }

  cachedKeys = data.keys;
  cachedJwksUrl = jwksUrl;
  cachedAt = Date.now();
  return cachedKeys;
}

function isLocalhostRequest(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export async function requireAccessAuth(c, next) {
  if (c.req.path.startsWith('/api/public/')) {
    await next();
    return;
  }

  const headerToken = c.req.header('cf-access-jwt-assertion');
  const cookieToken = getCookie(c, 'CF_Authorization');
  const token = headerToken || cookieToken || '';

  if (!token && c.env?.DEV_BYPASS_EMAIL && isLocalhostRequest(c.req.url)) {
    const email = String(c.env.DEV_BYPASS_EMAIL).trim().toLowerCase();
    c.set('authUser', {
      email,
      is_admin: getAdminEmailSet(c.env?.ADMIN_EMAILS).has(email),
    });
    await next();
    return;
  }

  const teamDomain = String(c.env?.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  const expectedAud = String(c.env?.ACCESS_AUD || '').trim();

  if (
    !token &&
    !teamDomain &&
    !expectedAud &&
    String(c.env?.LOCAL_AUTH_MODE || '').toLowerCase() === 'off'
  ) {
    const email =
      String(c.env?.LOCAL_USER_EMAIL || 'local@yumyum.pos').trim().toLowerCase() ||
      'local@yumyum.pos';
    const adminSet = getAdminEmailSet(c.env?.ADMIN_EMAILS);
    const isAdmin =
      adminSet.size > 0
        ? adminSet.has(email)
        : String(c.env?.LOCAL_USER_ADMIN ?? 'true').toLowerCase() !== 'false';
    c.set('authUser', {
      email,
      is_admin: isAdmin,
    });
    await next();
    return;
  }

  if (!teamDomain || !expectedAud) {
    throw new HttpError(401, 'ระบบยืนยันตัวตนยังไม่ได้ตั้งค่าครบถ้วน');
  }

  if (!token) {
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบผ่าน Cloudflare Access');
  }

  let header;
  try {
    header = decode(token).header;
  } catch {
    throw new HttpError(401, 'โทเค็นยืนยันตัวตนไม่ถูกต้อง');
  }

  const jwksUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let keys = await fetchJwks(jwksUrl, false);
  if (header?.kid && !keys.some((k) => k.kid === header.kid)) {
    keys = await fetchJwks(jwksUrl, true);
  }

  let payload;
  try {
    payload = await verifyWithJwks(token, {
      keys,
      allowedAlgorithms: ['RS256'],
      verification: {
        aud: expectedAud,
        iss: teamDomain,
        exp: true,
        nbf: true,
        iat: true,
      },
    });
  } catch {
    throw new HttpError(401, 'สิทธิ์การใช้งานไม่ถูกต้องหรือหมดอายุ');
  }

  const email = String(payload?.email || '').trim().toLowerCase();
  if (!email) {
    throw new HttpError(401, 'ไม่พบอีเมลผู้ใช้งานในโทเค็น');
  }

  c.set('authUser', {
    email,
    is_admin: getAdminEmailSet(c.env?.ADMIN_EMAILS).has(email),
  });
  await next();
}

export async function requireAdmin(c, next) {
  const user = c.get('authUser');
  if (!user || !user.is_admin) {
    throw new HttpError(403, 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น');
  }
  await next();
}
