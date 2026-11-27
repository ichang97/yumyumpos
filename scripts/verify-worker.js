import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sign } from 'hono/jwt';
import { getPlatformProxy } from 'wrangler';
import {
  DEFAULT_SPEECH_RATE,
  buildOrderSpeechText,
  normalizeSpeechRate,
  pcmBase64ToWavBlob,
  resolveNextOrderToAnnounce,
} from '../src/utils/kitchenSpeech.js';
import { buildStationOrders, countActiveByStation } from '../src/utils/kitchenStation.js';
import { buildPromptPayPayload } from '../src/utils/promptpay.js';
import { app } from '../worker/index.js';
import { clearJwksCache } from '../worker/lib/accessAuth.js';

const verifyStateDir = path.resolve(process.cwd(), '.wrangler/verify-state');
const TEST_TEAM_DOMAIN = 'https://marklab.cloudflareaccess.com';
const TEST_AUD = 'd4359175dc935a7ae0f6a54c43c3572d348669b30f8ce45cb8ee4c805e4de1e8';
const TEST_ADMINS = 'admin@example.com';

let defaultAuthToken = '';

function cleanupState() {
  fs.rmSync(verifyStateDir, { recursive: true, force: true });
}

async function applySqlFile(db, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length > 0) {
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}

async function request(env, urlPath, options = {}) {
  const { token, noAuth, headers: rawHeaders, body: rawBody, ...restOptions } = options;
  const headers = { ...(rawHeaders || {}) };
  if (!urlPath.startsWith('/api/public/') && !noAuth && !headers['cf-access-jwt-assertion']) {
    const chosenToken = token !== undefined ? token : defaultAuthToken;
    if (chosenToken) {
      headers['cf-access-jwt-assertion'] = chosenToken;
    }
  }
  let body = rawBody;
  if (body !== undefined && typeof body !== 'string') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }
  const req = new Request(`http://localhost${urlPath}`, {
    ...restOptions,
    headers,
    body,
  });
  const res = await app.fetch(req, env);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function requestRaw(env, urlPath) {
  const req = new Request(`http://localhost${urlPath}`);
  const res = await app.fetch(req, env);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    headers: res.headers,
    bytes,
  };
}

function findOptionId(optionGroups, groupName, optionName) {
  const group = optionGroups.find((g) => g.name === groupName);
  assert.ok(group, `Missing option group: ${groupName}`);
  const option = group.options.find((o) => o.name === optionName);
  assert.ok(option, `Missing option: ${optionName} in ${groupName}`);
  return option.id;
}

async function main() {
  cleanupState();
  clearJwksCache();
  const proxy = await getPlatformProxy({
    configPath: path.resolve(process.cwd(), 'wrangler.jsonc'),
    persist: { path: verifyStateDir },
  });

  const originalFetch = globalThis.fetch;

  try {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const privateJwk = {
      ...(await crypto.subtle.exportKey('jwk', keyPair.privateKey)),
      kid: 'test-key-1',
      alg: 'RS256',
    };
    const publicJwk = {
      ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)),
      kid: 'test-key-1',
      alg: 'RS256',
      use: 'sig',
    };

    const geminiFetchCalls = [];
    const mockPcmBase64 = Buffer.from(new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0])).toString('base64');

    globalThis.fetch = async (input, init) => {
      const targetUrl = typeof input === 'string' ? input : input?.url || '';
      if (targetUrl === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (targetUrl.startsWith('https://generativelanguage.googleapis.com/v1beta/')) {
        const headerObj =
          init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : init?.headers || {};
        const apiKeyHeader = headerObj['x-goog-api-key'] || headerObj['X-Goog-Api-Key'] || '';
        const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
        geminiFetchCalls.push({
          url: targetUrl,
          method: init?.method || 'GET',
          apiKeyHeader,
          body: parsedBody,
        });

        if (apiKeyHeader === 'INVALID_GEMINI_KEY_VALUE') {
          return new Response(JSON.stringify({ error: { code: 400, message: 'API key invalid' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (targetUrl.includes('/v1beta/models?')) {
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: 'models/gemini-2.5-flash',
                  displayName: 'Gemini 2.5 Flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-2.5-flash-preview-tts',
                  displayName: 'Gemini 2.5 Flash TTS',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-2.5-pro-preview-tts',
                  displayName: 'Gemini 2.5 Pro TTS',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (targetUrl === 'https://generativelanguage.googleapis.com/v1beta/voices') {
          return new Response(
            JSON.stringify({
              voices: [
                {
                  name: 'voices/Kore',
                  displayName: 'Kore',
                  ssmlGender: 'FEMALE',
                  languageCodes: ['th-TH', 'en-US'],
                },
                {
                  name: 'voices/Puck',
                  displayName: 'Puck',
                  ssmlGender: 'MALE',
                  languageCodes: ['th-TH', 'en-US'],
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (targetUrl.endsWith(':generateContent')) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'audio/L16;codec=pcm;rate=24000',
                          data: mockPcmBase64,
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      }
      return originalFetch(input, init);
    };

    async function makeAccessJwt({
      email = 'admin@example.com',
      aud = TEST_AUD,
      iss = TEST_TEAM_DOMAIN,
      expOffsetSec = 3600,
    } = {}) {
      const nowSec = Math.floor(Date.now() / 1000);
      return sign(
        {
          email,
          aud: [aud],
          iss,
          iat: nowSec - 10,
          nbf: nowSec - 10,
          exp: nowSec + expOffsetSec,
        },
        privateJwk,
        'RS256'
      );
    }

    defaultAuthToken = await makeAccessJwt();

    const env = {
      ...proxy.env,
      ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
      ACCESS_AUD: TEST_AUD,
      ADMIN_EMAILS: TEST_ADMINS,
    };
    await applySqlFile(env.DB, path.resolve(process.cwd(), 'migrations/0001_init.sql'));
    await applySqlFile(env.DB, path.resolve(process.cwd(), 'migrations/0002_seed.sql'));
    await applySqlFile(
      env.DB,
      path.resolve(process.cwd(), 'migrations/0003_counter_queue_kanban.sql')
    );
    await applySqlFile(
      env.DB,
      path.resolve(process.cwd(), 'migrations/0004_shop_payment_settings.sql')
    );
    await applySqlFile(
      env.DB,
      path.resolve(process.cwd(), 'migrations/0005_kitchen_station_items.sql')
    );
    await applySqlFile(
      env.DB,
      path.resolve(process.cwd(), 'migrations/0006_atomic_daily_counters.sql')
    );
    await applySqlFile(
      env.DB,
      path.resolve(process.cwd(), 'migrations/0007_speech_settings.sql')
    );

    assert.equal(
      buildPromptPayPayload('0000000000'),
      '00020101021129370016A000000677010111011300660000000005802TH530376463048956'
    );
    const dynamicPp = buildPromptPayPayload('0812345678', 80);
    assert.ok(dynamicPp.includes('010212') && dynamicPp.includes('540580.00'));

    const initSettingsRes = await request(env, '/api/settings/payment');
    assert.equal(initSettingsRes.status, 200);
    assert.equal(initSettingsRes.data.payment.enable_cash, true);
    assert.equal(initSettingsRes.data.payment.enable_qr, true);

    assert.equal(
      (
        await request(env, '/api/settings/payment', {
          method: 'PUT',
          body: { enable_cash: false, enable_qr: false },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request(env, '/api/settings/payment', {
          method: 'PUT',
          body: { enable_cash: true, enable_qr: true, promptpay_id: '12345' },
        })
      ).status,
      400
    );

    const updateSettingsRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        promptpay_id: '081-234-5678',
        promptpay_name: 'ร้านยำยำ',
      },
    });
    assert.equal(updateSettingsRes.status, 200);
    assert.equal(updateSettingsRes.data.payment.promptpay_id, '0812345678');
    assert.equal(updateSettingsRes.data.payment.promptpay_name, 'ร้านยำยำ');

    const [catRes, pubCatRes] = await Promise.all([
      request(env, '/api/catalog'),
      request(env, '/api/public/catalog'),
    ]);
    assert.equal(catRes.status, 200);
    assert.equal(pubCatRes.status, 200);
    const catalog = catRes.data;
    assert.equal(catalog.categories.length, 3);
    assert.equal(catalog.menus.length, 12);
    assert.equal(catalog.option_groups.length, 8);
    assert.equal(pubCatRes.data.categories.length, 3);
    assert.equal(pubCatRes.data.menus.length, 12);
    assert.equal(pubCatRes.data.option_groups.length, 8);
    assert.equal(pubCatRes.data.payment_settings.promptpay_id, '0812345678');
    assert.equal(pubCatRes.data.payment_settings.promptpay_name, 'ร้านยำยำ');
    console.log('PASS 1: Staff/public catalogs, PromptPay EMVCo vector, and payment settings verified');

    const noodlePork = catalog.menus.find((m) => m.name === 'ก๋วยเตี๋ยวหมู');
    assert.ok(noodlePork);

    const optSmall = findOptionId(catalog.option_groups, 'เลือกเส้น', 'เส้นเล็ก');
    const optTomyum = findOptionId(catalog.option_groups, 'น้ำ / แห้ง', 'ต้มยำ');
    const optNoVeg = findOptionId(catalog.option_groups, 'ผัก / ไม่ใส่', 'ไม่ใส่ผัก');
    const optExtra = findOptionId(catalog.option_groups, 'เพิ่มเติมก๋วยเตี๋ยว', 'พิเศษ');

    const staffOrderRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'dine_in',
        staff_name: 'มาร์ค',
        customer_name: 'บี',
        pay_now: false,
        items: [
          {
            is_custom: false,
            menu_id: noodlePork.id,
            option_ids: [optSmall, optTomyum, optNoVeg, optExtra],
            quantity: 1,
            note: 'แยกน้ำ',
          },
          {
            is_custom: true,
            menu_name: 'ผัดพริกแกงเนื้อไข่เยี่ยวม้า',
            base_price: 85,
            quantity: 1,
            note: 'เผ็ดน้อย',
          },
        ],
      },
    });
    assert.equal(staffOrderRes.status, 201);
    const staffOrder = staffOrderRes.data.order;
    assert.equal(staffOrder.queue_no, 1);
    assert.equal(staffOrder.source, 'staff');
    assert.equal(staffOrder.status, 'open');
    assert.equal(staffOrder.kitchen_status, 'pending');
    assert.equal(staffOrder.customer_name, 'บี');
    assert.equal(staffOrder.items[0].unit_price, 65);
    assert.equal(staffOrder.items[1].is_custom, 1);
    assert.equal(staffOrder.subtotal, 150);
    console.log('PASS 2: Staff counter order pay-later + daily queue Q001 verified');

    const missingRequiredRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'มาร์ค',
        items: [
          {
            is_custom: false,
            menu_id: noodlePork.id,
            option_ids: [optSmall],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(missingRequiredRes.status, 400);
    console.log('PASS 3: Rejects order missing required option group (HTTP 400)');

    const kaphrao = catalog.menus.find((m) => m.name === 'ผัดกะเพรา');
    const optCrispyPork = findOptionId(catalog.option_groups, 'เลือกเนื้อสัตว์', 'หมูกรอบ');
    const optFriedEgg = findOptionId(catalog.option_groups, 'ท็อปปิ้งตามสั่ง', 'ไข่ดาว');

    const publicCustomRejectRes = await request(env, '/api/public/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        customer_name: 'แฮกเกอร์',
        items: [
          {
            is_custom: true,
            menu_name: 'เมนูลับ',
            base_price: 1,
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(publicCustomRejectRes.status, 400);

    const qrOrderRes = await request(env, '/api/public/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        customer_name: 'นุ่น',
        payment_method: 'transfer',
        items: [
          {
            menu_id: kaphrao.id,
            option_ids: [optCrispyPork, optFriedEgg],
            quantity: 1,
            note: 'ไม่ใส่ถั่วฝักยาว',
          },
        ],
      },
    });
    assert.equal(qrOrderRes.status, 201);
    const qrOrder = qrOrderRes.data.order;
    assert.equal(qrOrder.queue_no, 2);
    assert.equal(qrOrder.status, 'open');
    assert.equal(qrOrder.payment_method, 'transfer');
    assert.equal(qrOrder.kitchen_status, 'pending');
    assert.equal(qrOrder.total_amount, 80);
    assert.ok(qrOrder.tracking_token && qrOrder.tracking_token.length > 10);
    assert.equal(qrOrder.staff_name, undefined);
    console.log('PASS 4: Public QR order Q002 verified and custom item injection blocked');

    const trackRes = await request(env, `/api/public/orders/${qrOrder.tracking_token}`);
    assert.equal(trackRes.status, 200);
    assert.equal(trackRes.data.order.queue_no, 2);
    assert.equal(trackRes.data.order.payment_method, 'transfer');
    assert.equal(trackRes.data.order.staff_name, undefined);

    const badTrackRes = await request(env, '/api/public/orders/nonexistent-token-12345');
    assert.equal(badTrackRes.status, 404);
    console.log('PASS 5: Public QR queue tracking verified and invalid token returns 404');

    const kitchenBeforePay = await request(env, '/api/kitchen');
    assert.equal(kitchenBeforePay.status, 200);
    assert.equal(kitchenBeforePay.data.orders.length, 0);

    const openListRes = await request(env, '/api/orders?status=open');
    assert.equal(openListRes.status, 200);
    assert.equal(openListRes.data.orders.length, 2);
    const qrOrderRecord = openListRes.data.orders.find((o) => o.queue_no === 2);
    assert.ok(qrOrderRecord);

    const unpaidKitchenPatch = await request(env, `/api/orders/${qrOrderRecord.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'cooking' },
    });
    assert.equal(unpaidKitchenPatch.status, 409);

    const payQrRes = await request(env, `/api/orders/${qrOrderRecord.id}/pay`, {
      method: 'POST',
      body: {
        payment_method: 'cash',
        discount_amount: 10,
        received_amount: 100,
      },
    });
    assert.equal(payQrRes.status, 200);
    assert.equal(payQrRes.data.order.status, 'paid');
    assert.equal(payQrRes.data.order.kitchen_status, 'pending');
    assert.equal(payQrRes.data.order.total_amount, 70);
    assert.equal(payQrRes.data.order.change_amount, 30);

    const kitchenList1 = await request(env, '/api/kitchen');
    assert.equal(kitchenList1.status, 200);
    assert.equal(kitchenList1.data.orders.length, 1);
    assert.equal(kitchenList1.data.orders[0].queue_no, 2);
    assert.equal(kitchenList1.data.orders[0].kitchen_status, 'pending');

    const stepCooking = await request(env, `/api/orders/${qrOrderRecord.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'cooking' },
    });
    assert.equal(stepCooking.status, 200);
    assert.equal(stepCooking.data.order.kitchen_status, 'cooking');
    assert.ok(stepCooking.data.order.cooking_started_at);

    const stepReady = await request(env, `/api/orders/${qrOrderRecord.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'ready' },
    });
    assert.equal(stepReady.status, 200);
    assert.equal(stepReady.data.order.kitchen_status, 'ready');
    assert.ok(stepReady.data.order.ready_at);

    const stepCompleted = await request(env, `/api/orders/${qrOrderRecord.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'completed' },
    });
    assert.equal(stepCompleted.status, 200);
    assert.equal(stepCompleted.data.order.kitchen_status, 'completed');
    assert.ok(stepCompleted.data.order.completed_at);
    console.log('PASS 6 & 7: Pay-first kitchen gate, QR order payment, and Kanban flow verified');

    const water = catalog.menus.find((m) => m.name === 'น้ำเปล่า');
    const staffPayNowRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'ฝ้าย',
        pay_now: true,
        payment_method: 'transfer',
        items: [
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 2,
          },
        ],
      },
    });
    assert.equal(staffPayNowRes.status, 201);
    assert.equal(staffPayNowRes.data.order.queue_no, 3);
    assert.equal(staffPayNowRes.data.order.status, 'paid');
    assert.equal(staffPayNowRes.data.order.kitchen_status, 'pending');
    assert.equal(staffPayNowRes.data.order.total_amount, 30);

    const kitchenList2 = await request(env, '/api/kitchen');
    assert.equal(kitchenList2.status, 200);
    assert.ok(kitchenList2.data.orders.some((o) => o.queue_no === 3));
    console.log('PASS 8: Paid counter order Q003 immediately enters Kitchen Kanban');

    const cancelRes = await request(env, `/api/orders/${staffOrder.id}/cancel`, {
      method: 'POST',
      body: { cancel_reason: 'คีย์รายการผิด' },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.order.status, 'cancelled');
    assert.equal(cancelRes.data.order.kitchen_status, 'cancelled');

    const kitchenList3 = await request(env, '/api/kitchen');
    assert.equal(kitchenList3.status, 200);
    assert.equal(kitchenList3.data.orders.length, 1);
    assert.equal(kitchenList3.data.orders[0].queue_no, 3);
    console.log('PASS 9: Cancelled order removed from Kitchen Kanban');

    const newCatRes = await request(env, '/api/categories', {
      method: 'POST',
      body: { name: 'ของหวาน', sort_order: 99, is_active: true },
    });
    assert.equal(newCatRes.status, 201);
    const createdCatId = newCatRes.data.category.id;

    const newGrpRes = await request(env, '/api/option-groups', {
      method: 'POST',
      body: { name: 'ท็อปปิ้งขนม', selection_type: 'multiple', is_required: false, sort_order: 99 },
    });
    assert.equal(newGrpRes.status, 201);
    const createdGrpId = newGrpRes.data.option_group.id;

    const newOptRes = await request(env, `/api/option-groups/${createdGrpId}/options`, {
      method: 'POST',
      body: { name: 'น้ำเชื่อม', price_delta: 5, is_available: true, sort_order: 1 },
    });
    assert.equal(newOptRes.status, 201);
    const createdOptId = newOptRes.data.option.id;

    const newMenuRes = await request(env, '/api/menus', {
      method: 'POST',
      body: {
        category_id: createdCatId,
        name: 'เฉาก๊วยนมสด',
        base_price: 30,
        is_available: true,
        sort_order: 1,
        option_group_ids: [createdGrpId],
      },
    });
    assert.equal(newMenuRes.status, 201);
    const createdMenuId = newMenuRes.data.menu.id;

    const toggleMenuRes = await request(env, `/api/menus/${createdMenuId}/availability`, {
      method: 'PATCH',
      body: { is_available: false },
    });
    assert.equal(toggleMenuRes.status, 200);
    assert.equal(toggleMenuRes.data.menu.is_available, 0);

    assert.equal((await request(env, `/api/menus/${createdMenuId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(env, `/api/options/${createdOptId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(env, `/api/option-groups/${createdGrpId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await request(env, `/api/categories/${createdCatId}`, { method: 'DELETE' })).status, 200);

    const reportRes = await request(env, '/api/reports/summary');
    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.data.summary.total_sales, 100);
    assert.equal(reportRes.data.summary.cash_sales, 70);
    assert.equal(reportRes.data.summary.transfer_sales, 30);
    assert.equal(reportRes.data.summary.qr_sales, 70);
    assert.equal(reportRes.data.summary.staff_sales, 30);
    assert.equal(reportRes.data.summary.qr_order_count, 1);
    assert.equal(reportRes.data.summary.staff_order_count, 1);
    assert.equal(reportRes.data.summary.order_count, 2);
    assert.equal(reportRes.data.summary.cancelled_count, 1);
    assert.equal(reportRes.data.top_menus[0].menu_name, 'น้ำเปล่า');
    assert.equal(reportRes.data.top_menus[0].total_qty, 2);
    console.log('PASS 10: Admin CRUD and Sales Report (staff vs QR breakdown) verified');

    const validPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const rejectSvgRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        qr_image_data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      },
    });
    assert.equal(rejectSvgRes.status, 400);

    const rejectSpoofRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        qr_image_data: 'data:image/png;base64,bm90LWEtcG5nLWRhdGEtMTIz',
      },
    });
    assert.equal(rejectSpoofRes.status, 400);

    const uploadQrRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        promptpay_id: '0812345678',
        promptpay_name: 'ร้านยำยำ',
        qr_image_data: validPngDataUrl,
      },
    });
    assert.equal(uploadQrRes.status, 200);
    assert.equal(uploadQrRes.data.payment.has_qr_image, true);
    assert.ok(uploadQrRes.data.payment.qr_image_url.startsWith('/api/public/payment-qr?v='));

    const rawQrRes = await requestRaw(env, '/api/public/payment-qr');
    assert.equal(rawQrRes.status, 200);
    assert.equal(rawQrRes.headers.get('content-type'), 'image/png');
    assert.equal(rawQrRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(rawQrRes.bytes[0], 0x89);
    assert.equal(rawQrRes.bytes[1], 0x50);
    assert.equal(rawQrRes.bytes[2], 0x4e);
    assert.equal(rawQrRes.bytes[3], 0x47);

    const pubCatalogWithQr = await request(env, '/api/public/catalog');
    assert.equal(pubCatalogWithQr.status, 200);
    assert.equal(pubCatalogWithQr.data.payment_settings.has_qr_image, true);
    assert.ok(
      pubCatalogWithQr.data.payment_settings.qr_image_url.startsWith('/api/public/payment-qr?v=')
    );
    assert.equal(pubCatalogWithQr.data.payment_settings.qr_image_data, undefined);

    const preserveQrRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        promptpay_id: '0812345678',
        promptpay_name: 'ร้านยำยำ โฉมใหม่',
      },
    });
    assert.equal(preserveQrRes.status, 200);
    assert.equal(preserveQrRes.data.payment.has_qr_image, true);

    const removeQrRes = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        promptpay_id: '0812345678',
        promptpay_name: 'ร้านยำยำ โฉมใหม่',
        qr_image_data: '',
      },
    });
    assert.equal(removeQrRes.status, 200);
    assert.equal(removeQrRes.data.payment.has_qr_image, false);
    assert.equal(removeQrRes.data.payment.qr_image_url, '');

    const removedQrRaw = await requestRaw(env, '/api/public/payment-qr');
    assert.equal(removedQrRaw.status, 404);
    console.log('PASS 11: Custom shop QR image upload, serving, preservation, and deletion verified');

    const speechTextSingle = buildOrderSpeechText({
      queue_no: 1,
      order_type: 'dine_in',
      items: [
        {
          menu_name: 'ก๋วยเตี๋ยวหมู',
          quantity: 1,
          options: [{ option_name: 'เส้นเล็ก' }, { option_name: 'ต้มยำ' }],
          note: '',
        },
      ],
    });
    assert.equal(speechTextSingle, 'คิวที่ 1 ทานที่ร้าน ก๋วยเตี๋ยวหมู เส้นเล็ก ต้มยำ');

    const speechTextMulti = buildOrderSpeechText({
      queue_no: 2,
      order_type: 'takeaway',
      items: [
        {
          menu_name: 'ก๋วยเตี๋ยวหมู',
          quantity: 2,
          options: [{ option_name: 'เส้นใหญ่' }],
          note: 'ไม่ใส่ผัก',
        },
        {
          menu_name: 'ชาเย็น',
          quantity: 1,
          options: [],
          note: '',
        },
      ],
    });
    assert.equal(
      speechTextMulti,
      'คิวที่ 2 กลับบ้าน ก๋วยเตี๋ยวหมู เส้นใหญ่ 2 ที่ หมายเหตุ ไม่ใส่ผัก, ชาเย็น'
    );

    const q1 = { id: 101, queue_no: 1, kitchen_status: 'pending' };
    const q2 = { id: 102, queue_no: 2, kitchen_status: 'pending' };
    const q3 = { id: 103, queue_no: 3, kitchen_status: 'pending' };
    const q4 = { id: 104, queue_no: 4, kitchen_status: 'pending' };
    const announced = new Set();

    const firstIdle = resolveNextOrderToAnnounce(new Map(), [q1], announced);
    assert.equal(firstIdle?.id, 101);

    const twoSimultaneous = resolveNextOrderToAnnounce(new Map(), [q1, q2], announced);
    assert.equal(twoSimultaneous?.id, 101);
    announced.add(101);

    const stackedWhilePending = resolveNextOrderToAnnounce(
      new Map([[101, 'pending']]),
      [q1, q2],
      announced
    );
    assert.equal(stackedWhilePending, null);

    const moveToCooking = resolveNextOrderToAnnounce(
      new Map([
        [101, 'pending'],
        [102, 'pending'],
      ]),
      [{ ...q1, kitchen_status: 'cooking' }, q2],
      announced
    );
    assert.equal(moveToCooking, null);

    const rollbackToPending = resolveNextOrderToAnnounce(
      new Map([
        [101, 'cooking'],
        [102, 'pending'],
      ]),
      [q1, q2],
      announced
    );
    assert.equal(rollbackToPending, null);

    const completedOldReady = resolveNextOrderToAnnounce(
      new Map([
        [100, 'ready'],
        [101, 'cooking'],
        [102, 'pending'],
      ]),
      [{ ...q1, kitchen_status: 'cooking' }, q2],
      announced
    );
    assert.equal(completedOldReady, null);

    const q1Finished = resolveNextOrderToAnnounce(
      new Map([
        [101, 'cooking'],
        [102, 'pending'],
        [103, 'pending'],
      ]),
      [{ ...q1, kitchen_status: 'ready' }, q2, q3],
      announced
    );
    assert.equal(q1Finished?.id, 102);
    announced.add(102);

    const q2FinishedFast = resolveNextOrderToAnnounce(
      new Map([
        [101, 'ready'],
        [102, 'pending'],
        [103, 'pending'],
      ]),
      [{ ...q1, kitchen_status: 'ready' }, { ...q2, kitchen_status: 'ready' }, q3],
      announced
    );
    assert.equal(q2FinishedFast?.id, 103);
    announced.add(103);

    const q3FinishedEmpty = resolveNextOrderToAnnounce(
      new Map([[103, 'cooking']]),
      [{ ...q3, kitchen_status: 'ready' }],
      announced
    );
    assert.equal(q3FinishedEmpty, null);

    const nextIdleArrival = resolveNextOrderToAnnounce(
      new Map([[103, 'ready']]),
      [{ ...q3, kitchen_status: 'ready' }, q4],
      announced
    );
    assert.equal(nextIdleArrival?.id, 104);

    assert.equal(DEFAULT_SPEECH_RATE, 1.15);
    assert.equal(normalizeSpeechRate(undefined), 1.15);
    assert.equal(normalizeSpeechRate('1.5'), 1.5);
    assert.equal(normalizeSpeechRate(0.2), 0.8);
    assert.equal(normalizeSpeechRate(5), 2);
    console.log('PASS 12: Kitchen voice Thai speech formatting, speed control, and queue gating verified');

    const rejectClearRes = await request(env, '/api/orders/clear-all', {
      method: 'POST',
      body: {},
    });
    assert.equal(rejectClearRes.status, 400);

    const clearRes = await request(env, '/api/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    });
    assert.equal(clearRes.status, 200);
    assert.equal(clearRes.data.cleared, true);
    assert.equal(clearRes.data.deleted_orders, 3);

    const [afterOrders, afterKitchen, afterOpen, afterReport, afterCatalog] = await Promise.all([
      request(env, '/api/orders?status=all&date=all'),
      request(env, '/api/kitchen'),
      request(env, '/api/orders?status=open'),
      request(env, '/api/reports/summary'),
      request(env, '/api/catalog'),
    ]);
    assert.equal(afterOrders.data.orders.length, 0);
    assert.equal(afterKitchen.data.orders.length, 0);
    assert.equal(afterOpen.data.orders.length, 0);
    assert.equal(afterReport.data.summary.order_count, 0);
    assert.equal(afterReport.data.summary.total_sales, 0);
    assert.equal(afterCatalog.data.categories.length, 3);
    assert.equal(afterCatalog.data.menus.length, 12);
    assert.equal(afterCatalog.data.option_groups.length, 8);
    assert.equal(afterCatalog.data.payment_settings.promptpay_id, '0812345678');

    const resetOrderRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'มาร์ค',
        pay_now: true,
        payment_method: 'cash',
        received_amount: 20,
        items: [
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(resetOrderRes.status, 201);
    assert.equal(resetOrderRes.data.order.queue_no, 1);
    console.log('PASS 13: Clear all orders & queues resets queue to Q001 while preserving catalog & settings');

    await request(env, '/api/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    });

    const stationOrderRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'dine_in',
        staff_name: 'มาร์ค',
        pay_now: true,
        payment_method: 'cash',
        received_amount: 200,
        items: [
          {
            is_custom: false,
            menu_id: noodlePork.id,
            option_ids: [optSmall, optTomyum],
            quantity: 1,
          },
          {
            is_custom: false,
            menu_id: kaphrao.id,
            option_ids: [optCrispyPork],
            quantity: 1,
          },
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(stationOrderRes.status, 201);
    const stationOrder = stationOrderRes.data.order;
    const noodleCatId = noodlePork.category_id;
    const stirFryCatId = kaphrao.category_id;
    const drinkCatId = water.category_id;

    assert.equal(stationOrder.items[0].category_id, noodleCatId);
    assert.equal(stationOrder.items[0].category_name, 'ก๋วยเตี๋ยว');
    assert.equal(stationOrder.items[0].kitchen_status, 'pending');
    assert.equal(stationOrder.items[1].category_id, stirFryCatId);
    assert.equal(stationOrder.items[2].category_id, drinkCatId);

    const kitchenStationFetch = await request(env, '/api/kitchen');
    assert.equal(kitchenStationFetch.status, 200);
    assert.equal(countActiveByStation(kitchenStationFetch.data.orders, String(noodleCatId)), 1);
    assert.equal(countActiveByStation(kitchenStationFetch.data.orders, String(stirFryCatId)), 1);
    assert.equal(countActiveByStation(kitchenStationFetch.data.orders, String(drinkCatId)), 1);

    const noodleOrdersBefore = buildStationOrders(kitchenStationFetch.data.orders, String(noodleCatId));
    assert.equal(noodleOrdersBefore.length, 1);
    assert.equal(noodleOrdersBefore[0].items.length, 1);
    assert.equal(noodleOrdersBefore[0].items[0].menu_name, 'ก๋วยเตี๋ยวหมู');
    assert.equal(noodleOrdersBefore[0].total_item_count, 3);

    const drinkReadyRes = await request(env, `/api/orders/${stationOrder.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'ready', category_id: drinkCatId },
    });
    assert.equal(drinkReadyRes.status, 200);
    assert.equal(drinkReadyRes.data.order.kitchen_status, 'cooking');
    assert.equal(drinkReadyRes.data.order.items[2].kitchen_status, 'ready');
    assert.equal(drinkReadyRes.data.order.items[0].kitchen_status, 'pending');
    assert.equal(drinkReadyRes.data.order.items[1].kitchen_status, 'pending');

    const drinkReadyView = buildStationOrders([drinkReadyRes.data.order], String(drinkCatId));
    const noodleStillPendingView = buildStationOrders([drinkReadyRes.data.order], String(noodleCatId));
    assert.equal(drinkReadyView[0].kitchen_status, 'ready');
    assert.equal(noodleStillPendingView[0].kitchen_status, 'pending');

    const noodleReadyRes = await request(env, `/api/orders/${stationOrder.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'ready', category_id: noodleCatId },
    });
    assert.equal(noodleReadyRes.status, 200);
    assert.equal(noodleReadyRes.data.order.kitchen_status, 'cooking');

    const stirFryReadyRes = await request(env, `/api/orders/${stationOrder.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'ready', category_id: stirFryCatId },
    });
    assert.equal(stirFryReadyRes.status, 200);
    assert.equal(stirFryReadyRes.data.order.kitchen_status, 'ready');

    const drinkDoneRes = await request(env, `/api/orders/${stationOrder.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'completed', category_id: drinkCatId },
    });
    assert.equal(drinkDoneRes.status, 200);
    assert.equal(drinkDoneRes.data.order.kitchen_status, 'ready');
    assert.equal(buildStationOrders([drinkDoneRes.data.order], String(drinkCatId)).length, 0);
    assert.equal(buildStationOrders([drinkDoneRes.data.order], String(noodleCatId)).length, 1);

    const allDoneRes = await request(env, `/api/orders/${stationOrder.id}/kitchen-status`, {
      method: 'PATCH',
      body: { kitchen_status: 'completed' },
    });
    assert.equal(allDoneRes.status, 200);
    assert.equal(allDoneRes.data.order.kitchen_status, 'completed');
    assert.ok(allDoneRes.data.order.items.every((i) => i.kitchen_status === 'completed'));

    await request(env, '/api/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    });
    console.log('PASS 14: Kitchen station filtering, per-item status aggregation, and independent completion verified');

    const concurrentRequests = Array.from({ length: 15 }, (_, idx) => {
      if (idx % 2 === 0) {
        return request(env, '/api/orders', {
          method: 'POST',
          body: {
            order_type: idx % 4 === 0 ? 'dine_in' : 'takeaway',
            staff_name: 'มาร์ค',
            customer_name: `ลูกค้า-${idx + 1}`,
            pay_now: true,
            payment_method: 'cash',
            received_amount: 100,
            items: [
              {
                is_custom: false,
                menu_id: noodlePork.id,
                option_ids: [optSmall, optTomyum],
                quantity: 1,
                note: `โน้ต-${idx + 1}`,
              },
            ],
          },
        });
      }
      return request(env, '/api/public/orders', {
        method: 'POST',
        body: {
          order_type: 'takeaway',
          customer_name: `QR-${idx + 1}`,
          payment_method: 'transfer',
          items: [
            {
              menu_id: kaphrao.id,
              option_ids: [optCrispyPork, optFriedEgg],
              quantity: 1,
            },
          ],
        },
      });
    });

    const concurrentResults = await Promise.all(concurrentRequests);
    assert.ok(concurrentResults.every((r) => r.status === 201));
    const concurrentQueueNos = concurrentResults
      .map((r) => r.data.order.queue_no)
      .sort((a, b) => a - b);
    assert.deepEqual(
      concurrentQueueNos,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    );
    assert.ok(
      concurrentResults.every(
        (r) =>
          Array.isArray(r.data.order.items) &&
          r.data.order.items.length === 1 &&
          Array.isArray(r.data.order.items[0].options) &&
          r.data.order.items[0].options.length === 2
      )
    );

    const multiStationRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'dine_in',
        staff_name: 'มาร์ค',
        pay_now: true,
        payment_method: 'cash',
        received_amount: 200,
        items: [
          {
            is_custom: false,
            menu_id: noodlePork.id,
            option_ids: [optSmall, optTomyum],
            quantity: 1,
          },
          {
            is_custom: false,
            menu_id: kaphrao.id,
            option_ids: [optCrispyPork],
            quantity: 1,
          },
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(multiStationRes.status, 201);
    const multiId = multiStationRes.data.order.id;

    const parallelStationPatches = await Promise.all([
      request(env, `/api/orders/${multiId}/kitchen-status`, {
        method: 'PATCH',
        body: { kitchen_status: 'ready', category_id: noodleCatId },
      }),
      request(env, `/api/orders/${multiId}/kitchen-status`, {
        method: 'PATCH',
        body: { kitchen_status: 'ready', category_id: stirFryCatId },
      }),
      request(env, `/api/orders/${multiId}/kitchen-status`, {
        method: 'PATCH',
        body: { kitchen_status: 'ready', category_id: drinkCatId },
      }),
    ]);
    assert.ok(parallelStationPatches.every((r) => r.status === 200));

    const finalMultiOrder = await request(env, `/api/orders/${multiId}`);
    assert.equal(finalMultiOrder.status, 200);
    assert.equal(finalMultiOrder.data.order.kitchen_status, 'ready');
    assert.ok(finalMultiOrder.data.order.ready_at);

    const unpaidDoublePayTarget = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'มาร์ค',
        pay_now: false,
        items: [
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(unpaidDoublePayTarget.status, 201);

    const parallelPays = await Promise.all([
      request(env, `/api/orders/${unpaidDoublePayTarget.data.order.id}/pay`, {
        method: 'POST',
        body: { payment_method: 'cash', received_amount: 20 },
      }),
      request(env, `/api/orders/${unpaidDoublePayTarget.data.order.id}/pay`, {
        method: 'POST',
        body: { payment_method: 'cash', received_amount: 20 },
      }),
    ]);
    const payStatuses = parallelPays.map((r) => r.status).sort((a, b) => a - b);
    assert.deepEqual(payStatuses, [200, 409]);

    await request(env, '/api/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    });

    const postClearSeqRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'มาร์ค',
        pay_now: true,
        payment_method: 'cash',
        received_amount: 20,
        items: [
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(postClearSeqRes.status, 201);
    assert.equal(postClearSeqRes.data.order.queue_no, 1);
    console.log('PASS 15: Concurrency stress test (15 parallel orders, 3 parallel stations, double-pay guard) verified');

    const staffToken = await makeAccessJwt({ email: 'staff@example.com' });
    const wrongAudToken = await makeAccessJwt({ aud: 'wrong-aud' });
    const expiredToken = await makeAccessJwt({ expOffsetSec: -60 });

    assert.equal((await request(env, '/api/orders', { noAuth: true })).status, 401);
    assert.equal((await request(env, '/api/orders', { token: 'not.a.jwt' })).status, 401);
    assert.equal((await request(env, '/api/orders', { token: wrongAudToken })).status, 401);
    assert.equal((await request(env, '/api/orders', { token: expiredToken })).status, 401);

    const meAdminRes = await request(env, '/api/me');
    assert.equal(meAdminRes.status, 200);
    assert.equal(meAdminRes.data.user.email, 'admin@example.com');
    assert.equal(meAdminRes.data.user.is_admin, true);

    const meStaffRes = await request(env, '/api/me', { token: staffToken });
    assert.equal(meStaffRes.status, 200);
    assert.equal(meStaffRes.data.user.email, 'staff@example.com');
    assert.equal(meStaffRes.data.user.is_admin, false);

    assert.equal(
      (
        await request(env, '/api/orders/clear-all', {
          method: 'POST',
          token: staffToken,
          body: { confirm: 'CLEAR_ALL' },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/settings/payment', {
          method: 'PUT',
          token: staffToken,
          body: { enable_cash: true, enable_qr: true },
        })
      ).status,
      403
    );
    assert.equal(
      (await request(env, '/api/reports/summary', { token: staffToken })).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/categories', {
          method: 'POST',
          token: staffToken,
          body: { name: 'ทดสอบสิทธิ์', sort_order: 99 },
        })
      ).status,
      403
    );

    assert.equal((await request(env, '/api/orders', { token: staffToken })).status, 200);
    assert.equal((await request(env, '/api/kitchen', { token: staffToken })).status, 200);
    assert.equal((await request(env, '/api/catalog', { token: staffToken })).status, 200);

    assert.equal(
      (
        await request(env, '/api/orders/clear-all', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ confirm: 'CLEAR_ALL' }),
        })
      ).status,
      415
    );

    assert.equal(
      (
        await request(env, '/api/orders/clear-all', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: { confirm: 'CLEAR_ALL' },
        })
      ).status,
      403
    );

    assert.equal(
      (
        await request(env, '/api/orders/clear-all', {
          method: 'POST',
          headers: { 'Sec-Fetch-Site': 'cross-site' },
          body: { confirm: 'CLEAR_ALL' },
        })
      ).status,
      403
    );

    assert.equal(
      (await request(env, '/api/reports/summary?from=2024-01-01&to=2026-01-01')).status,
      400
    );

    const limitedEnv = {
      ...env,
      PUBLIC_ORDER_LIMITER: {
        limit: async () => ({ success: false }),
      },
    };
    assert.equal(
      (
        await request(limitedEnv, '/api/public/orders', {
          method: 'POST',
          noAuth: true,
          body: {
            order_type: 'takeaway',
            items: [{ menu_id: water.id, quantity: 1 }],
          },
        })
      ).status,
      429
    );

    assert.equal((await request(env, '/api/public/catalog', { noAuth: true })).status, 200);
    console.log('PASS 16: Security hardening (Access JWT, RBAC, CSRF, query span, rate limit, public bypass) verified');

    assert.equal(
      (await request(env, '/api/backup/export', { token: staffToken })).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          token: staffToken,
          body: { confirm: 'RESTORE_BACKUP', backup: {} },
        })
      ).status,
      403
    );

    const setQrBeforeBackup = await request(env, '/api/settings/payment', {
      method: 'PUT',
      body: {
        enable_cash: true,
        enable_qr: true,
        promptpay_id: '0812345678',
        promptpay_name: 'ร้านยำยำ สำรอง',
        qr_image_data: validPngDataUrl,
      },
    });
    assert.equal(setQrBeforeBackup.status, 200);

    const exportRes = await request(env, '/api/backup/export');
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.data.app, 'yumyum-pos');
    assert.equal(exportRes.data.version, 1);
    assert.ok(exportRes.data.data.categories.length > 0);
    assert.ok(exportRes.data.data.menus.length > 0);
    assert.ok(exportRes.data.data.option_groups.length > 0);
    assert.ok(exportRes.data.data.orders.length > 0);
    assert.ok(exportRes.data.data.daily_counters.length > 0);
    assert.ok(
      exportRes.data.data.shop_settings.some(
        (s) => s.key === 'qr_image_data' && s.value === validPngDataUrl
      )
    );

    const exportedSnapshot = exportRes.data;
    const expectedCatCount = exportedSnapshot.data.categories.length;
    const expectedOrderCount = exportedSnapshot.data.orders.length;
    const maxRestoredQueue = Math.max(
      ...exportedSnapshot.data.orders.map((o) => Number(o.queue_no || 0))
    );

    assert.equal(
      (
        await request(env, '/api/orders/clear-all', {
          method: 'POST',
          body: { confirm: 'CLEAR_ALL' },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await request(env, '/api/settings/payment', {
          method: 'PUT',
          body: {
            enable_cash: true,
            enable_qr: true,
            qr_image_data: '',
          },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await request(env, '/api/categories', {
          method: 'POST',
          body: { name: 'หมวดชั่วคราว', sort_order: 88, is_active: true },
        })
      ).status,
      201
    );

    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          body: { backup: exportedSnapshot },
        })
      ).status,
      400
    );

    const wrongVersionBackup = structuredClone(exportedSnapshot);
    wrongVersionBackup.version = 99;
    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE_BACKUP', backup: wrongVersionBackup },
        })
      ).status,
      400
    );

    const spoofQrBackup = structuredClone(exportedSnapshot);
    spoofQrBackup.data.shop_settings = spoofQrBackup.data.shop_settings.map((row) =>
      row.key === 'qr_image_data'
        ? { ...row, value: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
        : row
    );
    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE_BACKUP', backup: spoofQrBackup },
        })
      ).status,
      400
    );

    const brokenFkBackup = structuredClone(exportedSnapshot);
    brokenFkBackup.data.menus[0].category_id = 999999;
    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE_BACKUP', backup: brokenFkBackup },
        })
      ).status,
      400
    );

    const catsDuringMutation = await request(env, '/api/categories');
    assert.ok(catsDuringMutation.data.categories.some((c) => c.name === 'หมวดชั่วคราว'));

    const restoreRes = await request(env, '/api/backup/restore', {
      method: 'POST',
      body: { confirm: 'RESTORE_BACKUP', backup: exportedSnapshot },
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.data.restored, true);
    assert.equal(restoreRes.data.counts.categories, expectedCatCount);
    assert.equal(restoreRes.data.counts.orders, expectedOrderCount);

    const catsAfterRestore = await request(env, '/api/categories');
    assert.equal(catsAfterRestore.status, 200);
    assert.equal(catsAfterRestore.data.categories.length, expectedCatCount);
    assert.equal(
      catsAfterRestore.data.categories.some((c) => c.name === 'หมวดชั่วคราว'),
      false
    );

    const ordersAfterRestore = await request(env, '/api/orders?status=all');
    assert.equal(ordersAfterRestore.status, 200);
    assert.equal(ordersAfterRestore.data.orders.length, expectedOrderCount);

    const qrAfterRestore = await requestRaw(env, '/api/public/payment-qr');
    assert.equal(qrAfterRestore.status, 200);
    assert.equal(qrAfterRestore.headers.get('content-type'), 'image/png');
    assert.equal(qrAfterRestore.bytes[0], 0x89);
    assert.equal(qrAfterRestore.bytes[1], 0x50);
    assert.equal(qrAfterRestore.bytes[2], 0x4e);
    assert.equal(qrAfterRestore.bytes[3], 0x47);

    const postRestoreOrderRes = await request(env, '/api/orders', {
      method: 'POST',
      body: {
        order_type: 'takeaway',
        staff_name: 'มาร์ค',
        pay_now: true,
        payment_method: 'cash',
        received_amount: 20,
        items: [
          {
            is_custom: false,
            menu_id: water.id,
            option_ids: [],
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(postRestoreOrderRes.status, 201);
    assert.equal(postRestoreOrderRes.data.order.queue_no, maxRestoredQueue + 1);
    console.log('PASS 17: Backup JSON export, validation guards, and atomic full restore verified');

    const initRuntimeRes = await request(env, '/api/speech/runtime', { token: staffToken });
    assert.equal(initRuntimeRes.status, 200);
    assert.equal(initRuntimeRes.data.speech.source, 'web_speech');
    assert.equal(initRuntimeRes.data.speech.ai_studio_ready, false);

    assert.equal(
      (await request(env, '/api/settings/speech', { token: staffToken })).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/settings/speech', {
          method: 'PUT',
          token: staffToken,
          body: { source: 'web_speech', rate: 1.15 },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/speech/catalog', {
          method: 'POST',
          token: staffToken,
          body: {},
        })
      ).status,
      403
    );
    assert.equal(
      (
        await request(env, '/api/speech/preview', {
          method: 'POST',
          token: staffToken,
          body: { text: 'ทดสอบ' },
        })
      ).status,
      403
    );

    assert.equal(
      (
        await request(env, '/api/settings/speech', {
          method: 'PUT',
          body: { source: 'ai_studio', rate: 1.15 },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request(env, '/api/settings/speech', {
          method: 'PUT',
          body: {
            source: 'web_speech',
            rate: 1.15,
            model: '../evil-model',
          },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request(env, '/api/settings/speech', {
          method: 'PUT',
          body: {
            source: 'web_speech',
            rate: 1.15,
            temperature: 5.0,
          },
        })
      ).status,
      400
    );

    const secretApiKey = 'AIzaSyTestSecretKey_9876543210';
    const saveSpeechRes = await request(env, '/api/settings/speech', {
      method: 'PUT',
      body: {
        source: 'ai_studio',
        rate: 1.3,
        model: 'gemini-2.5-pro-preview-tts',
        voice: 'Kore',
        temperature: 0.7,
        style_prompt: 'พูดภาษาไทยให้ชัดเจน สดใส',
        api_key: secretApiKey,
      },
    });
    assert.equal(saveSpeechRes.status, 200);
    assert.equal(saveSpeechRes.data.speech.source, 'ai_studio');
    assert.equal(saveSpeechRes.data.speech.has_api_key, true);
    assert.equal(saveSpeechRes.data.speech.api_key_masked, 'AIza••••3210');
    assert.equal(JSON.stringify(saveSpeechRes.data).includes(secretApiKey), false);

    const adminSpeechGet = await request(env, '/api/settings/speech');
    assert.equal(adminSpeechGet.status, 200);
    assert.equal(adminSpeechGet.data.speech.has_api_key, true);
    assert.equal(JSON.stringify(adminSpeechGet.data).includes(secretApiKey), false);

    const staffRuntimeAfter = await request(env, '/api/speech/runtime', { token: staffToken });
    assert.equal(staffRuntimeAfter.status, 200);
    assert.equal(staffRuntimeAfter.data.speech.source, 'ai_studio');
    assert.equal(staffRuntimeAfter.data.speech.ai_studio_ready, true);
    assert.equal(staffRuntimeAfter.data.speech.api_key_masked, undefined);
    assert.equal(JSON.stringify(staffRuntimeAfter.data).includes(secretApiKey), false);

    const publicAfterSpeech = await request(env, '/api/public/catalog', { noAuth: true });
    assert.equal(publicAfterSpeech.status, 200);
    assert.equal(JSON.stringify(publicAfterSpeech.data).includes(secretApiKey), false);
    assert.equal(JSON.stringify(publicAfterSpeech.data).includes('ai_studio_api_key'), false);

    geminiFetchCalls.length = 0;
    const catalogSpeechRes = await request(env, '/api/speech/catalog', {
      method: 'POST',
      body: {},
    });
    assert.equal(catalogSpeechRes.status, 200);
    assert.equal(catalogSpeechRes.data.models.length, 2);
    assert.equal(
      catalogSpeechRes.data.models.some((m) => m.id === 'gemini-2.5-flash'),
      false
    );
    assert.equal(catalogSpeechRes.data.voices_source, 'api');
    assert.equal(catalogSpeechRes.data.voices.length, 2);
    assert.ok(
      geminiFetchCalls.every(
        (call) => call.apiKeyHeader === secretApiKey && !call.url.includes(secretApiKey)
      )
    );

    geminiFetchCalls.length = 0;
    const previewRes = await request(env, '/api/speech/preview', {
      method: 'POST',
      body: {
        text: 'ทดสอบคิวที่ 1',
        model: 'gemini-2.5-flash-preview-tts',
        voice: 'Puck',
        temperature: 1.2,
        style_prompt: 'พูดสดใส',
      },
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.data.audio_base64, mockPcmBase64);
    assert.equal(previewRes.data.sample_rate, 24000);
    assert.equal(geminiFetchCalls.length, 1);
    assert.equal(geminiFetchCalls[0].apiKeyHeader, secretApiKey);
    assert.equal(geminiFetchCalls[0].url.includes(secretApiKey), false);
    assert.deepEqual(geminiFetchCalls[0].body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(geminiFetchCalls[0].body.generationConfig.temperature, 1.2);
    assert.equal(
      geminiFetchCalls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      'Puck'
    );
    assert.equal(geminiFetchCalls[0].body.contents[0].parts[0].text, 'ทดสอบคิวที่ 1');
    assert.equal(geminiFetchCalls[0].body.contents[0].parts[0].speechMetadata.style, 'พูดสดใส');

    const wavBlob = pcmBase64ToWavBlob(previewRes.data.audio_base64, {
      mimeType: previewRes.data.mime_type,
      sampleRate: previewRes.data.sample_rate,
    });
    assert.equal(wavBlob.type, 'audio/wav');
    assert.equal(wavBlob.size, 44 + 8);

    geminiFetchCalls.length = 0;
    const speakRes = await request(env, '/api/speech/speak', {
      method: 'POST',
      token: staffToken,
      body: {
        text: 'คิวที่ 2 ทานที่ร้าน',
        model: 'gemini-2.5-flash-preview-tts',
        voice: 'Puck',
        style_prompt: 'override attempt',
      },
    });
    assert.equal(speakRes.status, 200);
    assert.equal(speakRes.data.audio_base64, mockPcmBase64);
    assert.equal(geminiFetchCalls.length, 1);
    assert.ok(geminiFetchCalls[0].url.includes('gemini-2.5-pro-preview-tts:generateContent'));
    assert.equal(
      geminiFetchCalls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      'Kore'
    );
    assert.equal(
      geminiFetchCalls[0].body.contents[0].parts[0].text,
      'คิวที่ 2 ทานที่ร้าน'
    );
    assert.equal(
      geminiFetchCalls[0].body.contents[0].parts[0].speechMetadata.style,
      'พูดภาษาไทยให้ชัดเจน สดใส'
    );

    const exportWithSpeech = await request(env, '/api/backup/export');
    assert.equal(exportWithSpeech.status, 200);
    assert.equal(JSON.stringify(exportWithSpeech.data).includes(secretApiKey), false);
    assert.equal(
      exportWithSpeech.data.data.shop_settings.some((s) => s.key === 'ai_studio_api_key'),
      false
    );

    const injectedKeyBackup = structuredClone(exportWithSpeech.data);
    injectedKeyBackup.data.shop_settings.push({
      key: 'ai_studio_api_key',
      value: 'evil-injected-key',
      updated_at: '2026-11-24 00:00:00',
    });
    assert.equal(
      (
        await request(env, '/api/backup/restore', {
          method: 'POST',
          body: { confirm: 'RESTORE_BACKUP', backup: injectedKeyBackup },
        })
      ).status,
      400
    );

    const restoreWithSpeech = await request(env, '/api/backup/restore', {
      method: 'POST',
      body: { confirm: 'RESTORE_BACKUP', backup: exportWithSpeech.data },
    });
    assert.equal(restoreWithSpeech.status, 200);

    const speechAfterRestore = await request(env, '/api/settings/speech');
    assert.equal(speechAfterRestore.status, 200);
    assert.equal(speechAfterRestore.data.speech.has_api_key, true);
    assert.equal(speechAfterRestore.data.speech.api_key_masked, 'AIza••••3210');

    const clearKeyRes = await request(env, '/api/settings/speech', {
      method: 'PUT',
      body: {
        source: 'web_speech',
        rate: 1.15,
        clear_api_key: true,
      },
    });
    assert.equal(clearKeyRes.status, 200);
    assert.equal(clearKeyRes.data.speech.has_api_key, false);
    assert.equal(clearKeyRes.data.speech.api_key_masked, '');
    assert.equal(
      (
        await request(env, '/api/speech/speak', {
          method: 'POST',
          token: staffToken,
          body: { text: 'คิวที่ 3' },
        })
      ).status,
      400
    );

    console.log('PASS 18: Admin speech settings, Gemini TTS catalog/preview/speak, API key protection & backup preservation verified');

    console.log('\nALL 18 VERIFICATION CHECKS PASSED!');
  } finally {
    globalThis.fetch = originalFetch;
    clearJwksCache();
    await proxy.dispose();
    cleanupState();
  }
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
