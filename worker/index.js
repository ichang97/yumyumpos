import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { requireAccessAuth } from './lib/accessAuth.js';
import { getBangkokNow } from './lib/time.js';
import { HttpError } from './lib/validate.js';
import { createBackupRoutes } from './routes/backup.js';
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
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    xFrameOptions: 'DENY',
  })
);

app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const secFetchSite = (c.req.header('sec-fetch-site') || '').toLowerCase();
    if (secFetchSite === 'cross-site') {
      throw new HttpError(403, 'คำขอข้ามโดเมนไม่ได้รับอนุญาต');
    }

    const origin = c.req.header('origin');
    if (origin) {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin).origin;
      } catch {
        throw new HttpError(403, 'คำขอข้ามโดเมนไม่ได้รับอนุญาต');
      }
      if (parsedOrigin !== new URL(c.req.url).origin) {
        throw new HttpError(403, 'คำขอข้ามโดเมนไม่ได้รับอนุญาต');
      }
    }

    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      const contentType = (c.req.header('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        throw new HttpError(415, 'กรุณาส่งข้อมูลในรูปแบบ application/json');
      }
    }
  }
  await next();
});

app.use('/api/*', requireAccessAuth);

const defaultBodyLimit = bodyLimit({
  maxSize: 512 * 1024,
  onError: (c) => c.json({ error: 'ขนาดข้อมูลใหญ่เกินกำหนด' }, 413),
});

const backupRestoreBodyLimit = bodyLimit({
  maxSize: 5 * 1024 * 1024,
  onError: (c) => c.json({ error: 'ไฟล์สำรองข้อมูลมีขนาดใหญ่เกิน 5 MB' }, 413),
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/backup/restore' && c.req.method === 'POST') {
    return backupRestoreBodyLimit(c, next);
  }
  return defaultBodyLimit(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true, time: getBangkokNow() }));

app.get('/api/me', (c) => c.json({ user: c.get('authUser') }));

app.route('/api/public', createPublicRoutes());
app.route('/api', createBackupRoutes());
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
