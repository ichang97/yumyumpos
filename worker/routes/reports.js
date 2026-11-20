import { Hono } from 'hono';
import { queryAll, queryFirst } from '../lib/db.js';
import { getBangkokDate } from '../lib/time.js';
import { HttpError, requireDateString } from '../lib/validate.js';

export function createReportsRoutes() {
  const router = new Hono();

  router.get('/reports/summary', async (c) => {
    const today = getBangkokDate();
    const from = requireDateString(c.req.query('from'), today);
    const to = requireDateString(c.req.query('to'), today);

    if (from > to) {
      throw new HttpError(400, 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    }

    const [paidSummary, cancelledSummary, openSummary, topMenus, daily] = await Promise.all([
      queryFirst(
        c.env.DB,
        `SELECT
          ROUND(COALESCE(SUM(total_amount), 0), 2) AS total_sales,
          COUNT(id) AS order_count,
          ROUND(COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0), 2) AS cash_sales,
          ROUND(COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total_amount ELSE 0 END), 0), 2) AS transfer_sales,
          ROUND(COALESCE(SUM(CASE WHEN source = 'staff' THEN total_amount ELSE 0 END), 0), 2) AS staff_sales,
          ROUND(COALESCE(SUM(CASE WHEN source = 'qr' THEN total_amount ELSE 0 END), 0), 2) AS qr_sales,
          SUM(CASE WHEN source = 'staff' THEN 1 ELSE 0 END) AS staff_order_count,
          SUM(CASE WHEN source = 'qr' THEN 1 ELSE 0 END) AS qr_order_count,
          ROUND(COALESCE(SUM(discount_amount), 0), 2) AS total_discount
        FROM orders
        WHERE status = 'paid'
          AND substr(COALESCE(paid_at, created_at), 1, 10) BETWEEN ? AND ?`,
        [from, to]
      ),
      queryFirst(
        c.env.DB,
        `SELECT COUNT(id) AS cancelled_count
        FROM orders
        WHERE status = 'cancelled'
          AND substr(created_at, 1, 10) BETWEEN ? AND ?`,
        [from, to]
      ),
      queryFirst(
        c.env.DB,
        `SELECT
          COUNT(id) AS open_count,
          ROUND(COALESCE(SUM(total_amount), 0), 2) AS open_amount
        FROM orders
        WHERE status = 'open'`
      ),
      queryAll(
        c.env.DB,
        `SELECT
          oi.menu_name,
          SUM(oi.quantity) AS total_qty,
          ROUND(SUM(oi.line_total), 2) AS total_revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'paid'
          AND substr(COALESCE(o.paid_at, o.created_at), 1, 10) BETWEEN ? AND ?
        GROUP BY oi.menu_name
        ORDER BY total_qty DESC, total_revenue DESC
        LIMIT 10`,
        [from, to]
      ),
      queryAll(
        c.env.DB,
        `SELECT
          substr(COALESCE(paid_at, created_at), 1, 10) AS sale_date,
          COUNT(id) AS order_count,
          ROUND(COALESCE(SUM(total_amount), 0), 2) AS total_sales,
          ROUND(COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0), 2) AS cash_sales,
          ROUND(COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total_amount ELSE 0 END), 0), 2) AS transfer_sales
        FROM orders
        WHERE status = 'paid'
          AND substr(COALESCE(paid_at, created_at), 1, 10) BETWEEN ? AND ?
        GROUP BY sale_date
        ORDER BY sale_date DESC`,
        [from, to]
      ),
    ]);

    return c.json({
      range: { from, to },
      summary: {
        ...paidSummary,
        staff_order_count: paidSummary?.staff_order_count || 0,
        qr_order_count: paidSummary?.qr_order_count || 0,
        cancelled_count: cancelledSummary?.cancelled_count || 0,
        open_count: openSummary?.open_count || 0,
        open_amount: openSummary?.open_amount || 0,
      },
      top_menus: topMenus,
      daily,
    });
  });

  return router;
}
