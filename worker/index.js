import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { getBangkokNow } from './lib/time.js';
import { HttpError } from './lib/validate.js';
import { createCatalogRoutes } from './routes/catalog.js';
import { createOrdersRoutes } from './routes/orders.js';
import { createPublicRoutes } from './routes/public.js';
import { createReportsRoutes } from './routes/reports.js';
import { createSettingsRoutes } from './routes/settings.js';

export const app = new Hono();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  })
);

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 512 * 1024,
    onError: (c) => c.json({ error: 'ขนาดข้อมูลใหญ่เกินกำหนด' }, 413),
  })
);

app.get('/api/health', (c) => c.json({ ok: true, time: getBangkokNow() }));

app.route('/api/public', createPublicRoutes());
app.route('/api', createCatalogRoutes());
app.route('/api', createOrdersRoutes());
app.route('/api', createReportsRoutes());
app.route('/api', createSettingsRoutes());

app.all('/api/*', (c) =>
  c.json({ error: 'ไม่พบ API endpoint ที่เรียกใช้งาน' }, 404)
);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }, 500);
});

export default app;
