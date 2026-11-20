import { Hono } from 'hono';
import {
  createCounterOrder,
  getOrderByTrackingToken,
  sanitizePublicOrder,
} from '../lib/orderService.js';
import { HttpError, optionalString, parseJsonBody } from '../lib/validate.js';
import { getCatalogData } from './catalog.js';
import { getPaymentQrImage, getPaymentSettings } from './settings.js';

export function createPublicRoutes() {
  const router = new Hono();

  router.get('/catalog', async (c) => {
    const data = await getCatalogData(c.env.DB);
    return c.json(data);
  });

  router.get('/payment-qr', async (c) => {
    const image = await getPaymentQrImage(c.env.DB);
    if (!image) {
      return c.json({ error: 'ยังไม่ได้อัปโหลดรูป QR ชำระเงิน' }, 404);
    }
    return new Response(image.bytes, {
      status: 200,
      headers: {
        'Content-Type': image.mimeType,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  });

  router.post('/orders', async (c) => {
    const body = await parseJsonBody(c);
    const customerName = optionalString(body.customer_name, 60);

    let preferredPaymentMethod = null;
    if (body.payment_method !== undefined && body.payment_method !== null && body.payment_method !== '') {
      if (body.payment_method !== 'cash' && body.payment_method !== 'transfer') {
        throw new HttpError(400, 'วิธีชำระเงินไม่ถูกต้อง');
      }
      const settings = await getPaymentSettings(c.env.DB);
      if (body.payment_method === 'cash' && !settings.enable_cash) {
        throw new HttpError(400, 'ร้านยังไม่เปิดรับชำระด้วยเงินสด');
      }
      if (body.payment_method === 'transfer' && !settings.enable_qr) {
        throw new HttpError(400, 'ร้านยังไม่เปิดรับชำระด้วยสแกน QR Code');
      }
      preferredPaymentMethod = body.payment_method;
    }

    const order = await createCounterOrder(c.env.DB, {
      orderType: body.order_type,
      source: 'qr',
      staffName: 'ลูกค้า QR',
      customerName,
      rawItems: body.items,
      payNow: false,
      preferredPaymentMethod,
      paymentBody: {},
      allowCustom: false,
      maxItems: 25,
      maxQtyPerItem: 20,
    });

    return c.json({ order: sanitizePublicOrder(order) }, 201);
  });

  router.get('/orders/:token', async (c) => {
    const token = String(c.req.param('token') || '').trim();
    if (token.length < 10 || token.length > 80) {
      throw new HttpError(400, 'รหัสติดตามคิวไม่ถูกต้อง');
    }

    const order = await getOrderByTrackingToken(c.env.DB, token);
    if (!order) {
      throw new HttpError(404, 'ไม่พบคิวอาหารนี้');
    }

    return c.json({ order: sanitizePublicOrder(order) });
  });

  return router;
}
