import { Hono } from 'hono';
import { execute, prepareStmt, queryAll, queryFirst } from '../lib/db.js';
import {
  ORDER_COLUMNS,
  computePaymentFields,
  createCounterOrder,
  getOrderById,
  hydrateOrders,
} from '../lib/orderService.js';
import { getBangkokDate, getBangkokNow } from '../lib/time.js';
import {
  HttpError,
  optionalString,
  parseJsonBody,
  requireDateString,
  requireInt,
  requireString,
} from '../lib/validate.js';

export function createOrdersRoutes() {
  const router = new Hono();

  router.get('/orders', async (c) => {
    const status = c.req.query('status') || 'all';
    if (!['open', 'paid', 'cancelled', 'all'].includes(status)) {
      throw new HttpError(400, 'สถานะออเดอร์ไม่ถูกต้อง');
    }

    const conditions = [];
    const params = [];

    if (status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    const dateParam = c.req.query('date');
    if (status !== 'open' && dateParam !== 'all') {
      const targetDate = requireDateString(dateParam, getBangkokDate());
      conditions.push('substr(created_at, 1, 10) = ?');
      params.push(targetDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await queryAll(
      c.env.DB,
      `SELECT ${ORDER_COLUMNS} FROM orders ${whereClause} ORDER BY id DESC`,
      params
    );

    const orders = await hydrateOrders(c.env.DB, rows);
    return c.json({ orders });
  });

  router.get('/kitchen', async (c) => {
    const rows = await queryAll(
      c.env.DB,
      `SELECT ${ORDER_COLUMNS}
      FROM orders
      WHERE kitchen_status IN ('pending', 'cooking', 'ready')
        AND status = 'paid'
      ORDER BY COALESCE(paid_at, created_at) ASC, id ASC`
    );

    const orders = await hydrateOrders(c.env.DB, rows);
    return c.json({ orders });
  });

  router.post('/orders/clear-all', async (c) => {
    const body = await parseJsonBody(c);
    if (body.confirm !== 'CLEAR_ALL') {
      throw new HttpError(400, 'กรุณายืนยันการล้างบิลและคิวทั้งหมด');
    }

    const countRow = await queryFirst(c.env.DB, 'SELECT COUNT(id) AS total FROM orders');

    await c.env.DB.batch([
      prepareStmt(c.env.DB, 'DELETE FROM order_item_options'),
      prepareStmt(c.env.DB, 'DELETE FROM order_items'),
      prepareStmt(c.env.DB, 'DELETE FROM orders'),
    ]);

    return c.json({
      cleared: true,
      deleted_orders: Number(countRow?.total || 0),
    });
  });

  router.get('/orders/:id', async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสออเดอร์', 1);
    const order = await getOrderById(c.env.DB, id);
    if (!order) {
      throw new HttpError(404, 'ไม่พบออเดอร์ที่ต้องการ');
    }
    return c.json({ order });
  });

  router.post('/orders', async (c) => {
    const body = await parseJsonBody(c);
    const staffName = requireString(body.staff_name, 'ชื่อพนักงาน', 80);
    const customerName = optionalString(body.customer_name, 60);
    const payNow = Boolean(body.pay_now);
    const preferredPaymentMethod =
      !payNow && (body.payment_method === 'cash' || body.payment_method === 'transfer')
        ? body.payment_method
        : null;

    const order = await createCounterOrder(c.env.DB, {
      orderType: body.order_type,
      source: 'staff',
      staffName,
      customerName,
      rawItems: body.items,
      payNow,
      preferredPaymentMethod,
      paymentBody: body,
      allowCustom: true,
      maxItems: 50,
      maxQtyPerItem: 999,
    });

    return c.json({ order }, 201);
  });

  router.patch('/orders/:id/kitchen-status', async (c) => {
    const orderId = requireInt(Number(c.req.param('id')), 'รหัสออเดอร์', 1);
    const body = await parseJsonBody(c);
    const nextStatus = body.kitchen_status;
    if (!['pending', 'cooking', 'ready', 'completed'].includes(nextStatus)) {
      throw new HttpError(400, 'สถานะครัวไม่ถูกต้อง');
    }

    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, status, kitchen_status, cooking_started_at, ready_at FROM orders WHERE id = ?',
      [orderId]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบออเดอร์');
    }
    if (existing.status === 'cancelled' || existing.kitchen_status === 'cancelled') {
      throw new HttpError(409, 'ไม่สามารถเปลี่ยนสถานะครัวของบิลที่ยกเลิกแล้วได้');
    }
    if (existing.status !== 'paid') {
      throw new HttpError(409, 'กรุณายืนยันการชำระเงินก่อนส่งคิวเข้าครัว');
    }

    const now = getBangkokNow();
    let cookingStartedAt = existing.cooking_started_at;
    let readyAt = existing.ready_at;
    let completedAt = null;

    if (nextStatus === 'pending') {
      readyAt = null;
      completedAt = null;
    } else if (nextStatus === 'cooking') {
      cookingStartedAt = existing.cooking_started_at || now;
      readyAt = null;
      completedAt = null;
    } else if (nextStatus === 'ready') {
      cookingStartedAt = existing.cooking_started_at || now;
      readyAt = existing.ready_at || now;
      completedAt = null;
    } else if (nextStatus === 'completed') {
      cookingStartedAt = existing.cooking_started_at || now;
      readyAt = existing.ready_at || now;
      completedAt = now;
    }

    await execute(
      c.env.DB,
      `UPDATE orders
      SET
        kitchen_status = ?,
        cooking_started_at = ?,
        ready_at = ?,
        completed_at = ?
      WHERE id = ?`,
      [nextStatus, cookingStartedAt, readyAt, completedAt, orderId]
    );

    const updated = await getOrderById(c.env.DB, orderId);
    return c.json({ order: updated });
  });

  router.post('/orders/:id/pay', async (c) => {
    const orderId = requireInt(Number(c.req.param('id')), 'รหัสออเดอร์', 1);
    const order = await queryFirst(
      c.env.DB,
      'SELECT id, status, subtotal FROM orders WHERE id = ?',
      [orderId]
    );
    if (!order) {
      throw new HttpError(404, 'ไม่พบออเดอร์');
    }
    if (order.status !== 'open') {
      throw new HttpError(409, 'บิลนี้ถูกชำระเงินหรือยกเลิกไปแล้ว');
    }

    const countRow = await queryFirst(
      c.env.DB,
      'SELECT COUNT(id) AS total FROM order_items WHERE order_id = ?',
      [orderId]
    );
    if (!countRow || countRow.total === 0) {
      throw new HttpError(400, 'ไม่สามารถชำระเงินบิลที่ไม่มีรายการอาหารได้');
    }

    const body = await parseJsonBody(c);
    const payment = computePaymentFields(order.subtotal, body);
    const paidAt = getBangkokNow();

    const meta = await execute(
      c.env.DB,
      `UPDATE orders
      SET
        status = 'paid',
        kitchen_status = 'pending',
        discount_amount = ?,
        total_amount = ?,
        payment_method = ?,
        received_amount = ?,
        change_amount = ?,
        paid_at = ?
      WHERE id = ? AND status = 'open'`,
      [
        payment.discountAmount,
        payment.totalAmount,
        payment.paymentMethod,
        payment.receivedAmount,
        payment.changeAmount,
        paidAt,
        orderId,
      ]
    );

    if (!meta.changes) {
      throw new HttpError(409, 'บิลนี้ถูกชำระเงินหรือยกเลิกไปแล้ว');
    }

    const updated = await getOrderById(c.env.DB, orderId);
    return c.json({ order: updated });
  });

  router.post('/orders/:id/cancel', async (c) => {
    const orderId = requireInt(Number(c.req.param('id')), 'รหัสออเดอร์', 1);
    const body = await parseJsonBody(c);
    const cancelReason = requireString(body.cancel_reason, 'เหตุผลการยกเลิก', 200);

    const order = await queryFirst(
      c.env.DB,
      'SELECT id, status FROM orders WHERE id = ?',
      [orderId]
    );
    if (!order) {
      throw new HttpError(404, 'ไม่พบออเดอร์');
    }
    if (order.status === 'cancelled') {
      throw new HttpError(409, 'บิลนี้ถูกยกเลิกไปแล้ว');
    }

    const meta = await execute(
      c.env.DB,
      "UPDATE orders SET status = 'cancelled', kitchen_status = 'cancelled', cancel_reason = ? WHERE id = ? AND status != 'cancelled'",
      [cancelReason, orderId]
    );
    if (!meta.changes) {
      throw new HttpError(409, 'บิลนี้ถูกยกเลิกไปแล้ว');
    }

    const updated = await getOrderById(c.env.DB, orderId);
    return c.json({ order: updated });
  });

  return router;
}
