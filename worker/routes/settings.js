import { Hono } from 'hono';
import { prepareStmt, queryAll, queryFirst } from '../lib/db.js';
import { getBangkokNow } from '../lib/time.js';
import { HttpError, optionalString, parseJsonBody } from '../lib/validate.js';

const SETTING_KEYS = ['enable_cash', 'enable_qr', 'promptpay_id', 'promptpay_name'];
const QR_IMAGE_KEY = 'qr_image_data';
const QR_IMAGE_MAX_LENGTH = 400000;
const QR_IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function parseQrImageDataUrl(raw) {
  if (typeof raw !== 'string') {
    throw new HttpError(400, 'รองรับเฉพาะไฟล์รูปภาพ PNG, JPG หรือ WebP เท่านั้น');
  }
  const trimmed = raw.trim();
  if (trimmed.length > QR_IMAGE_MAX_LENGTH) {
    throw new HttpError(400, 'ไฟล์รูป QR มีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ขนาดเล็กลง');
  }
  const match = QR_IMAGE_DATA_URL_RE.exec(trimmed);
  if (!match) {
    throw new HttpError(400, 'รองรับเฉพาะไฟล์รูปภาพ PNG, JPG หรือ WebP เท่านั้น');
  }

  const mimeType = match[1];
  let binaryStr;
  try {
    binaryStr = atob(match[2]);
  } catch {
    throw new HttpError(400, 'ไฟล์รูป QR ไม่ถูกต้องหรือเสียหาย');
  }

  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i += 1) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  if (bytes.length < 12) {
    throw new HttpError(400, 'ไฟล์รูป QR ไม่ถูกต้องหรือเสียหาย');
  }

  const validMagic =
    (mimeType === 'image/png' &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a) ||
    (mimeType === 'image/jpeg' &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (mimeType === 'image/webp' &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50);

  if (!validMagic) {
    throw new HttpError(400, 'ไฟล์รูป QR ไม่ถูกต้องหรือเสียหาย');
  }

  return { mimeType, bytes, dataUrl: trimmed };
}

export async function getPaymentQrImage(db) {
  const row = await queryFirst(
    db,
    'SELECT value, updated_at FROM shop_settings WHERE key = ?',
    [QR_IMAGE_KEY]
  );
  if (!row || !row.value) {
    return null;
  }
  try {
    const parsed = parseQrImageDataUrl(row.value);
    return {
      mimeType: parsed.mimeType,
      bytes: parsed.bytes,
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function getPaymentSettings(db) {
  const [rows, qrRow] = await Promise.all([
    queryAll(
      db,
      'SELECT key, value FROM shop_settings WHERE key IN (?, ?, ?, ?)',
      SETTING_KEYS
    ),
    queryFirst(
      db,
      'SELECT updated_at, LENGTH(value) AS size FROM shop_settings WHERE key = ?',
      [QR_IMAGE_KEY]
    ),
  ]);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const hasQrImage = Boolean(qrRow && Number(qrRow.size) > 0);

  return {
    enable_cash: map.get('enable_cash') !== '0',
    enable_qr: map.get('enable_qr') !== '0',
    promptpay_id: map.get('promptpay_id') || '',
    promptpay_name: map.get('promptpay_name') || '',
    has_qr_image: hasQrImage,
    qr_image_url: hasQrImage
      ? `/api/public/payment-qr?v=${encodeURIComponent(qrRow.updated_at)}`
      : '',
  };
}

export function createSettingsRoutes() {
  const router = new Hono();

  router.get('/settings/payment', async (c) => {
    const payment = await getPaymentSettings(c.env.DB);
    return c.json({ payment });
  });

  router.put('/settings/payment', async (c) => {
    const body = await parseJsonBody(c);
    const enableCash = Boolean(body.enable_cash);
    const enableQr = Boolean(body.enable_qr);
    if (!enableCash && !enableQr) {
      throw new HttpError(400, 'ต้องเปิดใช้งานวิธีชำระเงินอย่างน้อย 1 ช่องทาง');
    }

    const promptpayId = String(body.promptpay_id || '').replace(/\D/g, '');
    if (
      promptpayId &&
      !/^0\d{9}$/.test(promptpayId) &&
      !/^\d{13}$/.test(promptpayId) &&
      !/^\d{15}$/.test(promptpayId)
    ) {
      throw new HttpError(
        400,
        'หมายเลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก, เลขบัตร 13 หลัก หรือ e-Wallet 15 หลัก'
      );
    }

    const promptpayName = optionalString(body.promptpay_name, 80) || '';
    const now = getBangkokNow();

    const entries = [
      ['enable_cash', enableCash ? '1' : '0'],
      ['enable_qr', enableQr ? '1' : '0'],
      ['promptpay_id', promptpayId],
      ['promptpay_name', promptpayName],
    ];

    const stmts = entries.map(([key, value]) =>
      prepareStmt(
        c.env.DB,
        'INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [key, value, now]
      )
    );

    if (Object.prototype.hasOwnProperty.call(body, 'qr_image_data')) {
      if (body.qr_image_data === null || body.qr_image_data === '') {
        stmts.push(
          prepareStmt(c.env.DB, 'DELETE FROM shop_settings WHERE key = ?', [QR_IMAGE_KEY])
        );
      } else {
        const parsedQr = parseQrImageDataUrl(body.qr_image_data);
        stmts.push(
          prepareStmt(
            c.env.DB,
            'INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
            [QR_IMAGE_KEY, parsedQr.dataUrl, now]
          )
        );
      }
    }

    await c.env.DB.batch(stmts);

    const payment = await getPaymentSettings(c.env.DB);
    return c.json({ payment });
  });

  return router;
}
