import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryRateLimiter } from '../local/rateLimiter.js';
import { createLocalApp } from '../local/server.js';

async function fetchJson(localApp, urlPath, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }

  const req = new Request(`http://localhost:8787${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const res = await localApp.fetch(req);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

async function fetchRaw(localApp, urlPath, options = {}) {
  const req = new Request(`http://localhost:8787${urlPath}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
  });
  const res = await localApp.fetch(req);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function buildRequiredOptions(catalog, menu) {
  const groupsById = new Map(catalog.option_groups.map((g) => [g.id, g]));
  const optionIds = [];
  for (const groupId of menu.option_group_ids || []) {
    const group = groupsById.get(groupId);
    if (group && group.is_required && group.options.length > 0) {
      optionIds.push(group.options[0].id);
    }
  }
  return optionIds;
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yumyum-local-test-'));
  const dbPath = path.join(tempDir, 'pos.sqlite');
  const distDir = path.resolve(process.cwd(), 'dist/client');

  let appInstance = null;
  let reopenedApp = null;
  let nonAdminApp = null;
  let accessAuthApp = null;
  let proxyApp = null;

  try {
    appInstance = createLocalApp({
      dbPath,
      distDir,
      env: {
        LOCAL_AUTH_MODE: 'off',
        LOCAL_USER_EMAIL: 'owner@local.test',
        LOCAL_USER_ADMIN: 'true',
      },
    });

    const healthRes = await fetchJson(appInstance, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.data.ok, true);

    const meRes = await fetchJson(appInstance, '/api/me');
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.email, 'owner@local.test');
    assert.equal(meRes.data.user.is_admin, true);

    const catalogRes = await fetchJson(appInstance, '/api/catalog');
    assert.equal(catalogRes.status, 200);
    assert.equal(catalogRes.data.categories.length, 3);
    assert.equal(catalogRes.data.menus.length, 12);
    assert.equal(catalogRes.data.option_groups.length, 8);

    const firstMenu = catalogRes.data.menus[0];
    const requiredOptionIds = buildRequiredOptions(catalogRes.data, firstMenu);

    const createOrderRes = await fetchJson(appInstance, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'dine_in',
        staff_name: 'แคชเชียร์ทดสอบ',
        customer_name: 'คุณเอ',
        pay_now: false,
        items: [
          {
            menu_id: firstMenu.id,
            quantity: 2,
            option_ids: requiredOptionIds,
            note: 'ไม่ใส่ถั่วงอก',
          },
        ],
      },
    });
    assert.equal(createOrderRes.status, 201);
    const createdOrder = createOrderRes.data.order;
    assert.equal(createdOrder.status, 'open');
    assert.equal(createdOrder.queue_no, 1);

    const payRes = await fetchJson(appInstance, `/api/orders/${createdOrder.id}/pay`, {
      method: 'POST',
      body: {
        payment_method: 'cash',
        received_amount: createdOrder.total_amount + 50,
      },
    });
    assert.equal(payRes.status, 200);
    assert.equal(payRes.data.order.status, 'paid');
    assert.equal(payRes.data.order.kitchen_status, 'pending');

    for (const nextStatus of ['cooking', 'ready', 'completed']) {
      const kitchenRes = await fetchJson(
        appInstance,
        `/api/orders/${createdOrder.id}/kitchen-status`,
        {
          method: 'PATCH',
          body: { kitchen_status: nextStatus },
        }
      );
      assert.equal(kitchenRes.status, 200);
      assert.equal(kitchenRes.data.order.kitchen_status, nextStatus);
    }

    const reportRes = await fetchJson(appInstance, '/api/reports/summary');
    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.data.summary.order_count, 1);
    assert.equal(reportRes.data.summary.total_sales, createdOrder.total_amount);

    const exportRes = await fetchJson(appInstance, '/api/backup/export');
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.data.app, 'yumyum-pos');
    assert.equal(exportRes.data.data.orders.length, 1);

    const clearRes = await fetchJson(appInstance, '/api/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    });
    assert.equal(clearRes.status, 200);
    assert.equal(clearRes.data.cleared, true);

    const restoreRes = await fetchJson(appInstance, '/api/backup/restore', {
      method: 'POST',
      body: {
        confirm: 'RESTORE_BACKUP',
        backup: exportRes.data,
      },
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.data.restored, true);
    assert.equal(restoreRes.data.counts.orders, 1);

    const publicCatalogRes = await fetchJson(appInstance, '/api/public/catalog');
    assert.equal(publicCatalogRes.status, 200);
    assert.equal(publicCatalogRes.data.menus.length, 12);

    let lastPublicToken = '';
    for (let i = 0; i < 20; i += 1) {
      const pubOrderRes = await fetchJson(appInstance, '/api/public/orders', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.50' },
        body: {
          order_type: 'takeaway',
          customer_name: `ลูกค้า ${i + 1}`,
          items: [
            {
              menu_id: firstMenu.id,
              quantity: 1,
              option_ids: requiredOptionIds,
            },
          ],
        },
      });
      assert.equal(pubOrderRes.status, 201);
      lastPublicToken = pubOrderRes.data.order.tracking_token;
    }

    const rateLimitedRes = await fetchJson(appInstance, '/api/public/orders', {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.168.1.50' },
      body: {
        order_type: 'takeaway',
        items: [{ menu_id: firstMenu.id, quantity: 1, option_ids: requiredOptionIds }],
      },
    });
    assert.equal(rateLimitedRes.status, 429);

    const trackRes = await fetchJson(appInstance, `/api/public/orders/${lastPublicToken}`);
    assert.equal(trackRes.status, 200);
    assert.equal(trackRes.data.order.tracking_token, lastPublicToken);

    const indexRes = await fetchRaw(appInstance, '/');
    assert.equal(indexRes.status, 200);
    assert.ok((indexRes.headers.get('content-type') || '').includes('text/html'));
    assert.ok(indexRes.headers.get('content-security-policy'));

    const orderRouteRes = await fetchRaw(appInstance, '/order');
    assert.equal(orderRouteRes.status, 200);
    assert.ok((orderRouteRes.headers.get('content-type') || '').includes('text/html'));

    const blockedHeadersRes = await fetchRaw(appInstance, '/_headers');
    assert.equal(blockedHeadersRes.status, 404);

    const traversalRes = await fetchRaw(appInstance, '/../package.json');
    assert.equal(traversalRes.status, 404);

    const encodedTraversalRes = await fetchRaw(appInstance, '/%2e%2e%2fpackage.json');
    assert.equal(encodedTraversalRes.status, 404);

    const traversalNoExtRes = await fetchRaw(appInstance, '/%2e%2e%2fsecrets');
    assert.equal(traversalNoExtRes.status, 404);

    appInstance.close();
    appInstance = null;

    reopenedApp = createLocalApp({
      dbPath,
      distDir,
      env: { LOCAL_AUTH_MODE: 'off' },
    });
    const reopenedCatalog = await fetchJson(reopenedApp, '/api/catalog');
    assert.equal(reopenedCatalog.status, 200);
    assert.equal(reopenedCatalog.data.categories.length, 3);
    assert.equal(reopenedCatalog.data.menus.length, 12);
    const migrationCount = await reopenedApp.db
      .prepare('SELECT COUNT(id) AS total FROM d1_migrations')
      .first('total');
    assert.equal(migrationCount, 7);
    reopenedApp.close();
    reopenedApp = null;

    nonAdminApp = createLocalApp({
      dbPath,
      distDir,
      env: {
        LOCAL_AUTH_MODE: 'off',
        LOCAL_USER_EMAIL: 'staff@local.test',
        LOCAL_USER_ADMIN: 'false',
      },
    });
    const staffMeRes = await fetchJson(nonAdminApp, '/api/me');
    assert.equal(staffMeRes.status, 200);
    assert.equal(staffMeRes.data.user.is_admin, false);
    const forbiddenReportRes = await fetchJson(nonAdminApp, '/api/reports/summary');
    assert.equal(forbiddenReportRes.status, 403);
    nonAdminApp.close();
    nonAdminApp = null;

    accessAuthApp = createLocalApp({
      dbPath,
      distDir,
      env: {
        LOCAL_AUTH_MODE: 'off',
        ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
        ACCESS_AUD: 'test-aud-tag',
      },
    });
    const unauthMeRes = await fetchJson(accessAuthApp, '/api/me');
    assert.equal(unauthMeRes.status, 401);
    accessAuthApp.close();
    accessAuthApp = null;

    proxyApp = createLocalApp({
      dbPath,
      distDir,
      rateLimiter: createMemoryRateLimiter({ limit: 20, periodSeconds: 60 }),
      env: {
        LOCAL_AUTH_MODE: 'off',
        TRUST_PROXY: 'true',
      },
    });
    const proxyOkRes = await fetchJson(proxyApp, '/api/orders', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'pos.example.com',
        origin: 'https://pos.example.com',
      },
      body: {
        order_type: 'takeaway',
        staff_name: 'proxy-test',
        pay_now: false,
        items: [{ menu_id: firstMenu.id, quantity: 1, option_ids: requiredOptionIds }],
      },
    });
    assert.equal(proxyOkRes.status, 201);

    const proxyBadOriginRes = await fetchJson(proxyApp, '/api/orders', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'pos.example.com',
        origin: 'https://evil.example.com',
      },
      body: {
        order_type: 'takeaway',
        staff_name: 'proxy-test',
        pay_now: false,
        items: [{ menu_id: firstMenu.id, quantity: 1, option_ids: requiredOptionIds }],
      },
    });
    assert.equal(proxyBadOriginRes.status, 403);
    proxyApp.close();
    proxyApp = null;

    console.log('ALL LOCAL SQLITE RUNTIME VERIFICATIONS PASSED');
  } finally {
    appInstance?.close();
    reopenedApp?.close();
    nonAdminApp?.close();
    accessAuthApp?.close();
    proxyApp?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
