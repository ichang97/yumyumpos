export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function parseJsonBody(c) {
  try {
    const data = await c.req.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new HttpError(400, 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) {
      throw err;
    }
    throw new HttpError(400, 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
  }
}

export function requireString(value, label, maxLen = 120) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `กรุณาระบุ${label}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, `กรุณาระบุ${label}`);
  }
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `${label}ยาวเกินไป (สูงสุด ${maxLen} ตัวอักษร)`);
  }
  return trimmed;
}

export function optionalString(value, maxLen = 255) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'รูปแบบข้อความไม่ถูกต้อง');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `ข้อความยาวเกินไป (สูงสุด ${maxLen} ตัวอักษร)`);
  }
  return trimmed;
}

export function requirePrice(value, label) {
  const num = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(num)) {
    throw new HttpError(400, `กรุณาระบุ${label}เป็นตัวเลขที่ถูกต้อง`);
  }
  if (num < 0 || num > 1000000) {
    throw new HttpError(400, `${label}ต้องอยู่ระหว่าง 0 ถึง 1,000,000`);
  }
  return Math.round(num * 100) / 100;
}

export function requireInt(value, label, min = 0, max = 1000000) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new HttpError(400, `${label}ต้องเป็นจำนวนเต็มระหว่าง ${min} ถึง ${max}`);
  }
  return num;
}

export function toBoolInt(value, defaultValue = 1) {
  if (value === undefined || value === null) {
    return defaultValue ? 1 : 0;
  }
  return value ? 1 : 0;
}

export function requireDateString(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
  }
  return value;
}
