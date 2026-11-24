import { Hono } from 'hono';
import { requireAdmin } from '../lib/accessAuth.js';
import { prepareStmt, queryAll } from '../lib/db.js';
import { getBangkokNow } from '../lib/time.js';
import { HttpError, parseJsonBody } from '../lib/validate.js';
import { parseQrImageDataUrl } from './settings.js';

const BACKUP_APP = 'yumyum-pos';
const BACKUP_VERSION = 1;

const SETTING_KEYS = [
  'enable_cash',
  'enable_qr',
  'promptpay_id',
  'promptpay_name',
  'qr_image_data',
];
const ALLOWED_SETTING_KEYS = new Set(SETTING_KEYS);
const SELECTION_TYPES = new Set(['single', 'multiple']);
const ORDER_TYPES = new Set(['dine_in', 'takeaway']);
const ORDER_SOURCES = new Set(['staff', 'qr']);
const ORDER_STATUSES = new Set(['open', 'paid', 'cancelled']);
const KITCHEN_STATUSES = new Set([
  'pending',
  'cooking',
  'ready',
  'completed',
  'cancelled',
]);
const PAYMENT_METHODS = new Set(['cash', 'transfer']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ROW_LIMITS = {
  categories: 200,
  option_groups: 200,
  options: 2000,
  menus: 1000,
  menu_option_groups: 5000,
  shop_settings: 20,
  orders: 5000,
  order_items: 20000,
  order_item_options: 40000,
  daily_counters: 2000,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertArray(value, label, maxLen) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `ข้อมูล ${label} ต้องอยู่ในรูปแบบรายการ`);
  }
  if (value.length > maxLen) {
    throw new HttpError(400, `จำนวนข้อมูล ${label} เกินขีดจำกัด (${maxLen})`);
  }
  return value;
}

function parsePositiveInt(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 1000000000) {
    throw new HttpError(400, `${label} ต้องเป็นจำนวนเต็มบวก`);
  }
  return num;
}

function parseNullablePositiveInt(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parsePositiveInt(value, label);
}

function parseNonNegInt(value, label, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 1000000000) {
    throw new HttpError(400, `${label} ต้องเป็นจำนวนเต็มที่ไม่ติดลบ`);
  }
  return num;
}

function parseNumber(value, label, min = 0, max = 10000000) {
  if (value === '' || value === null || value === undefined) {
    throw new HttpError(400, `${label} ไม่ถูกต้อง`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, `${label} ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
  }
  return Math.round(num * 100) / 100;
}

function parseNullableNumber(value, label, min = 0, max = 10000000) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseNumber(value, label, min, max);
}

function parseFlag(value, defaultValue = 1) {
  if (value === undefined || value === null) {
    return defaultValue ? 1 : 0;
  }
  if (value === true || value === 1 || value === '1') {
    return 1;
  }
  if (value === false || value === 0 || value === '0') {
    return 0;
  }
  throw new HttpError(400, 'ค่าสถานะบูลีนไม่ถูกต้อง');
}

function parseReqStr(value, label, maxLen) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} ไม่ถูกต้อง`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) {
    throw new HttpError(400, `${label} ต้องมีความยาว 1-${maxLen} ตัวอักษร`);
  }
  return trimmed;
}

function parseOptStr(value, label, maxLen) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} ไม่ถูกต้อง`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new HttpError(400, `${label} ยาวเกิน ${maxLen} ตัวอักษร`);
  }
  return trimmed;
}

function parseDateStr(value, label) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new HttpError(400, `${label} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} ไม่ถูกต้อง`);
  }
  return value;
}

function parseEnum(value, allowedSet, label) {
  if (typeof value !== 'string' || !allowedSet.has(value)) {
    throw new HttpError(400, `ค่าของ ${label} ไม่ถูกต้อง`);
  }
  return value;
}

function normalizeCategories(rawList) {
  const rows = assertArray(rawList, 'categories', ROW_LIMITS.categories);
  const categoryIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลหมวดหมู่ไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสหมวดหมู่');
    if (categoryIds.has(id)) {
      throw new HttpError(400, `พบรหัสหมวดหมู่ซ้ำ: ${id}`);
    }
    categoryIds.add(id);
    normalized.push({
      id,
      name: parseReqStr(row.name, 'ชื่อหมวดหมู่', 80),
      sort_order: parseNonNegInt(row.sort_order, 'ลำดับหมวดหมู่', 0),
      is_active: parseFlag(row.is_active, 1),
    });
  }

  return { rows: normalized, categoryIds };
}

function normalizeOptionGroups(rawList) {
  const rows = assertArray(rawList, 'option_groups', ROW_LIMITS.option_groups);
  const groupIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลกลุ่มตัวเลือกไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสกลุ่มตัวเลือก');
    if (groupIds.has(id)) {
      throw new HttpError(400, `พบรหัสกลุ่มตัวเลือกซ้ำ: ${id}`);
    }
    groupIds.add(id);
    normalized.push({
      id,
      name: parseReqStr(row.name, 'ชื่อกลุ่มตัวเลือก', 80),
      selection_type: parseEnum(row.selection_type, SELECTION_TYPES, 'selection_type'),
      is_required: parseFlag(row.is_required, 0),
      sort_order: parseNonNegInt(row.sort_order, 'ลำดับกลุ่มตัวเลือก', 0),
    });
  }

  return { rows: normalized, groupIds };
}

function normalizeOptions(rawList, groupIds) {
  const rows = assertArray(rawList, 'options', ROW_LIMITS.options);
  const optionIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลตัวเลือกไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสตัวเลือก');
    if (optionIds.has(id)) {
      throw new HttpError(400, `พบรหัสตัวเลือกซ้ำ: ${id}`);
    }
    const optionGroupId = parsePositiveInt(row.option_group_id, 'option_group_id');
    if (!groupIds.has(optionGroupId)) {
      throw new HttpError(400, `ตัวเลือก #${id} อ้างอิงกลุ่มตัวเลือกที่ไม่มีอยู่ในไฟล์`);
    }
    optionIds.add(id);
    normalized.push({
      id,
      option_group_id: optionGroupId,
      name: parseReqStr(row.name, 'ชื่อตัวเลือก', 80),
      price_delta: parseNumber(row.price_delta ?? 0, 'ราคาส่วนเพิ่ม', -100000, 1000000),
      is_available: parseFlag(row.is_available, 1),
      sort_order: parseNonNegInt(row.sort_order, 'ลำดับตัวเลือก', 0),
    });
  }

  return normalized;
}

function normalizeMenus(rawList, categoryIds) {
  const rows = assertArray(rawList, 'menus', ROW_LIMITS.menus);
  const menuIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลเมนูไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสเมนู');
    if (menuIds.has(id)) {
      throw new HttpError(400, `พบรหัสเมนูซ้ำ: ${id}`);
    }
    const categoryId = parsePositiveInt(row.category_id, 'category_id ของเมนู');
    if (!categoryIds.has(categoryId)) {
      throw new HttpError(400, `เมนู #${id} อ้างอิงหมวดหมู่ที่ไม่มีอยู่ในไฟล์`);
    }
    menuIds.add(id);
    normalized.push({
      id,
      category_id: categoryId,
      name: parseReqStr(row.name, 'ชื่อเมนู', 100),
      base_price: parseNumber(row.base_price, 'ราคาเมนู', 0, 1000000),
      is_available: parseFlag(row.is_available, 1),
      sort_order: parseNonNegInt(row.sort_order, 'ลำดับเมนู', 0),
    });
  }

  return { rows: normalized, menuIds };
}

function normalizeMenuOptionGroups(rawList, menuIds, groupIds) {
  const rows = assertArray(rawList, 'menu_option_groups', ROW_LIMITS.menu_option_groups);
  const pairs = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลความสัมพันธ์เมนู-ตัวเลือกไม่ถูกต้อง');
    }
    const menuId = parsePositiveInt(row.menu_id, 'menu_id');
    const optionGroupId = parsePositiveInt(row.option_group_id, 'option_group_id');
    if (!menuIds.has(menuId) || !groupIds.has(optionGroupId)) {
      throw new HttpError(400, 'พบความสัมพันธ์เมนูและกลุ่มตัวเลือกที่อ้างอิงรหัสที่ไม่มีอยู่');
    }
    const pairKey = `${menuId}:${optionGroupId}`;
    if (pairs.has(pairKey)) {
      throw new HttpError(400, 'พบการเชื่อมโยงเมนูและกลุ่มตัวเลือกซ้ำกัน');
    }
    pairs.add(pairKey);
    normalized.push({
      menu_id: menuId,
      option_group_id: optionGroupId,
      sort_order: parseNonNegInt(row.sort_order, 'ลำดับกลุ่มตัวเลือกของเมนู', 0),
    });
  }

  return normalized;
}

function normalizeShopSettings(rawList, now) {
  const rows = assertArray(rawList, 'shop_settings', ROW_LIMITS.shop_settings);
  const byKey = new Map();

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลการตั้งค่าร้านไม่ถูกต้อง');
    }
    const key = parseEnum(row.key, ALLOWED_SETTING_KEYS, 'setting key');
    if (byKey.has(key)) {
      throw new HttpError(400, `พบการตั้งค่าซ้ำสำหรับ ${key}`);
    }
    if (typeof row.value !== 'string') {
      throw new HttpError(400, `ค่าของการตั้งค่า ${key} ต้องเป็นข้อความ`);
    }
    const updatedAt = parseOptStr(row.updated_at, 'updated_at', 40) || now;
    byKey.set(key, { key, value: row.value, updated_at: updatedAt });
  }

  const enableCash = byKey.has('enable_cash')
    ? parseFlag(byKey.get('enable_cash').value, 1)
    : 1;
  const enableQr = byKey.has('enable_qr')
    ? parseFlag(byKey.get('enable_qr').value, 1)
    : 1;
  if (!enableCash && !enableQr) {
    throw new HttpError(400, 'การตั้งค่าร้านต้องเปิดวิธีชำระเงินอย่างน้อย 1 ช่องทาง');
  }

  const rawPromptpayId = byKey.get('promptpay_id')?.value || '';
  const promptpayId = rawPromptpayId.replace(/\D/g, '');
  if (
    promptpayId &&
    !/^0\d{9}$/.test(promptpayId) &&
    !/^\d{13}$/.test(promptpayId) &&
    !/^\d{15}$/.test(promptpayId)
  ) {
    throw new HttpError(400, 'หมายเลขพร้อมเพย์ในไฟล์สำรองข้อมูลไม่ถูกต้อง');
  }

  const promptpayName = parseOptStr(byKey.get('promptpay_name')?.value, 'promptpay_name', 80) || '';

  const normalized = [
    {
      key: 'enable_cash',
      value: enableCash ? '1' : '0',
      updated_at: byKey.get('enable_cash')?.updated_at || now,
    },
    {
      key: 'enable_qr',
      value: enableQr ? '1' : '0',
      updated_at: byKey.get('enable_qr')?.updated_at || now,
    },
    {
      key: 'promptpay_id',
      value: promptpayId,
      updated_at: byKey.get('promptpay_id')?.updated_at || now,
    },
    {
      key: 'promptpay_name',
      value: promptpayName,
      updated_at: byKey.get('promptpay_name')?.updated_at || now,
    },
  ];

  const qrEntry = byKey.get('qr_image_data');
  if (qrEntry && qrEntry.value.trim() !== '') {
    const parsedQr = parseQrImageDataUrl(qrEntry.value);
    normalized.push({
      key: 'qr_image_data',
      value: parsedQr.dataUrl,
      updated_at: qrEntry.updated_at,
    });
  }

  return normalized;
}

function normalizeOrders(rawList) {
  const rows = assertArray(rawList, 'orders', ROW_LIMITS.orders);
  const orderIds = new Set();
  const orderNos = new Set();
  const queueKeys = new Set();
  const trackingTokens = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลบิลไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสบิล');
    if (orderIds.has(id)) {
      throw new HttpError(400, `พบรหัสบิลซ้ำ: ${id}`);
    }
    orderIds.add(id);

    const orderNo = parseReqStr(row.order_no, 'เลขที่บิล', 60);
    if (orderNos.has(orderNo)) {
      throw new HttpError(400, `พบเลขที่บิลซ้ำ: ${orderNo}`);
    }
    orderNos.add(orderNo);

    const queueNo = parseNullablePositiveInt(row.queue_no, 'หมายเลขคิว');
    const queueDate =
      row.queue_date === null || row.queue_date === undefined || row.queue_date === ''
        ? null
        : parseDateStr(row.queue_date, 'queue_date');

    if (queueNo !== null) {
      if (!queueDate) {
        throw new HttpError(400, `บิล #${id} มีเลขคิวแต่ไม่มีวันที่คิว`);
      }
      const qKey = `${queueDate}:${queueNo}`;
      if (queueKeys.has(qKey)) {
        throw new HttpError(400, `พบเลขคิวซ้ำในวันเดียวกัน: ${qKey}`);
      }
      queueKeys.add(qKey);
    }

    const trackingToken = parseOptStr(row.tracking_token, 'tracking_token', 120);
    if (trackingToken) {
      if (trackingTokens.has(trackingToken)) {
        throw new HttpError(400, 'พบ tracking_token ซ้ำกันในไฟล์');
      }
      trackingTokens.add(trackingToken);
    }

    const paymentMethod =
      row.payment_method === null || row.payment_method === undefined || row.payment_method === ''
        ? null
        : parseEnum(row.payment_method, PAYMENT_METHODS, 'payment_method');

    normalized.push({
      id,
      order_no: orderNo,
      queue_no: queueNo,
      queue_date: queueDate,
      order_type: parseEnum(row.order_type, ORDER_TYPES, 'order_type'),
      source: row.source === undefined || row.source === null ? 'staff' : parseEnum(row.source, ORDER_SOURCES, 'source'),
      kitchen_status: parseEnum(row.kitchen_status || 'pending', KITCHEN_STATUSES, 'kitchen_status'),
      customer_name: parseOptStr(row.customer_name, 'customer_name', 80),
      tracking_token: trackingToken,
      staff_name: parseOptStr(row.staff_name, 'staff_name', 80) || 'พนักงาน',
      status: parseEnum(row.status, ORDER_STATUSES, 'status'),
      subtotal: parseNumber(row.subtotal ?? 0, 'subtotal', 0, 10000000),
      discount_amount: parseNumber(row.discount_amount ?? 0, 'discount_amount', 0, 10000000),
      total_amount: parseNumber(row.total_amount ?? 0, 'total_amount', 0, 10000000),
      payment_method: paymentMethod,
      received_amount: parseNullableNumber(row.received_amount, 'received_amount'),
      change_amount: parseNullableNumber(row.change_amount, 'change_amount'),
      cancel_reason: parseOptStr(row.cancel_reason, 'cancel_reason', 200),
      created_at: parseReqStr(row.created_at, 'created_at', 40),
      paid_at: parseOptStr(row.paid_at, 'paid_at', 40),
      cooking_started_at: parseOptStr(row.cooking_started_at, 'cooking_started_at', 40),
      ready_at: parseOptStr(row.ready_at, 'ready_at', 40),
      completed_at: parseOptStr(row.completed_at, 'completed_at', 40),
    });
  }

  return { rows: normalized, orderIds };
}

function normalizeOrderItems(rawList, orderIds, menuIds, categoryIds) {
  const rows = assertArray(rawList, 'order_items', ROW_LIMITS.order_items);
  const orderItemIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลรายการอาหารในบิลไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสรายการอาหาร');
    if (orderItemIds.has(id)) {
      throw new HttpError(400, `พบรหัสรายการอาหารซ้ำ: ${id}`);
    }
    const orderId = parsePositiveInt(row.order_id, 'order_id');
    if (!orderIds.has(orderId)) {
      throw new HttpError(400, `รายการอาหาร #${id} อ้างอิงบิลที่ไม่มีอยู่ในไฟล์`);
    }
    orderItemIds.add(id);

    const rawMenuId = parseNullablePositiveInt(row.menu_id, 'menu_id');
    const rawCategoryId = parseNullablePositiveInt(row.category_id, 'category_id');

    normalized.push({
      id,
      order_id: orderId,
      menu_id: rawMenuId && menuIds.has(rawMenuId) ? rawMenuId : null,
      category_id: rawCategoryId && categoryIds.has(rawCategoryId) ? rawCategoryId : null,
      category_name: parseOptStr(row.category_name, 'category_name', 80),
      kitchen_status: parseEnum(row.kitchen_status || 'pending', KITCHEN_STATUSES, 'item kitchen_status'),
      menu_name: parseReqStr(row.menu_name, 'ชื่อเมนูในบิล', 120),
      base_price: parseNumber(row.base_price ?? 0, 'base_price', 0, 1000000),
      options_price: parseNumber(row.options_price ?? 0, 'options_price', -100000, 1000000),
      unit_price: parseNumber(row.unit_price ?? 0, 'unit_price', 0, 1000000),
      quantity: parsePositiveInt(row.quantity, 'จำนวนรายการอาหาร'),
      line_total: parseNumber(row.line_total ?? 0, 'line_total', 0, 10000000),
      note: parseOptStr(row.note, 'note', 200),
      is_custom: parseFlag(row.is_custom, 0),
    });
  }

  return { rows: normalized, orderItemIds };
}

function normalizeOrderItemOptions(rawList, orderItemIds) {
  const rows = assertArray(rawList, 'order_item_options', ROW_LIMITS.order_item_options);
  const optIds = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลตัวเลือกของรายการอาหารไม่ถูกต้อง');
    }
    const id = parsePositiveInt(row.id, 'รหัสตัวเลือกรายการอาหาร');
    if (optIds.has(id)) {
      throw new HttpError(400, `พบรหัสตัวเลือกรายการอาหารซ้ำ: ${id}`);
    }
    const orderItemId = parsePositiveInt(row.order_item_id, 'order_item_id');
    if (!orderItemIds.has(orderItemId)) {
      throw new HttpError(400, `ตัวเลือก #${id} อ้างอิงรายการอาหารที่ไม่มีอยู่ในไฟล์`);
    }
    optIds.add(id);
    normalized.push({
      id,
      order_item_id: orderItemId,
      option_group_name: parseReqStr(row.option_group_name, 'option_group_name', 80),
      option_name: parseReqStr(row.option_name, 'option_name', 80),
      price_delta: parseNumber(row.price_delta ?? 0, 'price_delta', -100000, 1000000),
    });
  }

  return normalized;
}

function normalizeDailyCounters(rawList) {
  if (rawList === undefined || rawList === null) {
    return [];
  }
  const rows = assertArray(rawList, 'daily_counters', ROW_LIMITS.daily_counters);
  const dates = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new HttpError(400, 'ข้อมูลตัวนับคิวรายวันไม่ถูกต้อง');
    }
    const counterDate = parseDateStr(row.counter_date, 'counter_date');
    if (dates.has(counterDate)) {
      throw new HttpError(400, `พบวันที่ตัวนับคิวซ้ำ: ${counterDate}`);
    }
    dates.add(counterDate);
    normalized.push({
      counter_date: counterDate,
      last_seq: parseNonNegInt(row.last_seq, 'last_seq', 0),
    });
  }

  return normalized;
}

export function createBackupRoutes() {
  const router = new Hono();

  router.get('/backup/export', requireAdmin, async (c) => {
    const db = c.env.DB;
    const [
      categories,
      optionGroups,
      options,
      menus,
      menuOptionGroups,
      shopSettings,
      orders,
      orderItems,
      orderItemOptions,
      dailyCounters,
    ] = await Promise.all([
      queryAll(
        db,
        'SELECT id, name, sort_order, is_active FROM categories ORDER BY sort_order ASC, id ASC'
      ),
      queryAll(
        db,
        'SELECT id, name, selection_type, is_required, sort_order FROM option_groups ORDER BY sort_order ASC, id ASC'
      ),
      queryAll(
        db,
        'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options ORDER BY option_group_id ASC, sort_order ASC, id ASC'
      ),
      queryAll(
        db,
        'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus ORDER BY sort_order ASC, id ASC'
      ),
      queryAll(
        db,
        'SELECT menu_id, option_group_id, sort_order FROM menu_option_groups ORDER BY menu_id ASC, sort_order ASC, option_group_id ASC'
      ),
      queryAll(
        db,
        'SELECT key, value, updated_at FROM shop_settings WHERE key IN (?, ?, ?, ?, ?) ORDER BY key ASC',
        SETTING_KEYS
      ),
      queryAll(
        db,
        `SELECT id, order_no, queue_no, queue_date, order_type, source, kitchen_status,
          customer_name, tracking_token, staff_name, status, subtotal, discount_amount,
          total_amount, payment_method, received_amount, change_amount, cancel_reason,
          created_at, paid_at, cooking_started_at, ready_at, completed_at
        FROM orders
        ORDER BY id ASC`
      ),
      queryAll(
        db,
        `SELECT id, order_id, menu_id, category_id, category_name, kitchen_status, menu_name,
          base_price, options_price, unit_price, quantity, line_total, note, is_custom
        FROM order_items
        ORDER BY id ASC`
      ),
      queryAll(
        db,
        'SELECT id, order_item_id, option_group_name, option_name, price_delta FROM order_item_options ORDER BY id ASC'
      ),
      queryAll(
        db,
        'SELECT counter_date, last_seq FROM daily_counters ORDER BY counter_date ASC'
      ),
    ]);

    const now = getBangkokNow();
    console.log(
      JSON.stringify({
        event: 'backup_exported',
        actor: c.get('authUser')?.email || 'unknown',
        counts: {
          categories: categories.length,
          option_groups: optionGroups.length,
          options: options.length,
          menus: menus.length,
          orders: orders.length,
          has_qr_image: shopSettings.some((s) => s.key === 'qr_image_data' && Boolean(s.value)),
        },
        at: now,
      })
    );

    return c.json({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exported_at: now,
      data: {
        categories,
        option_groups: optionGroups,
        options,
        menus,
        menu_option_groups: menuOptionGroups,
        shop_settings: shopSettings,
        orders,
        order_items: orderItems,
        order_item_options: orderItemOptions,
        daily_counters: dailyCounters,
      },
    });
  });

  router.post('/backup/restore', requireAdmin, async (c) => {
    const body = await parseJsonBody(c);
    if (body.confirm !== 'RESTORE_BACKUP') {
      throw new HttpError(400, 'กรุณายืนยันการกู้คืนข้อมูลก่อนดำเนินการ');
    }

    const backup = body.backup;
    if (!isPlainObject(backup)) {
      throw new HttpError(400, 'ไม่พบข้อมูล backup ในคำขอ');
    }
    if (backup.app !== BACKUP_APP || backup.version !== BACKUP_VERSION || !isPlainObject(backup.data)) {
      throw new HttpError(400, 'ไฟล์สำรองข้อมูลไม่รองรับหรือเวอร์ชันไม่ถูกต้อง');
    }

    const now = getBangkokNow();
    const rawData = backup.data;

    const { rows: categories, categoryIds } = normalizeCategories(rawData.categories);
    const { rows: optionGroups, groupIds } = normalizeOptionGroups(rawData.option_groups);
    const options = normalizeOptions(rawData.options, groupIds);
    const { rows: menus, menuIds } = normalizeMenus(rawData.menus, categoryIds);
    const menuOptionGroups = normalizeMenuOptionGroups(rawData.menu_option_groups, menuIds, groupIds);
    const shopSettings = normalizeShopSettings(rawData.shop_settings, now);
    const { rows: orders, orderIds } = normalizeOrders(rawData.orders);
    const { rows: orderItems, orderItemIds } = normalizeOrderItems(
      rawData.order_items,
      orderIds,
      menuIds,
      categoryIds
    );
    const orderItemOptions = normalizeOrderItemOptions(rawData.order_item_options, orderItemIds);
    const dailyCounters = normalizeDailyCounters(rawData.daily_counters);

    const db = c.env.DB;
    const stmts = [
      prepareStmt(db, 'DELETE FROM order_item_options'),
      prepareStmt(db, 'DELETE FROM order_items'),
      prepareStmt(db, 'DELETE FROM orders'),
      prepareStmt(db, 'DELETE FROM daily_counters'),
      prepareStmt(db, 'DELETE FROM menu_option_groups'),
      prepareStmt(db, 'DELETE FROM options'),
      prepareStmt(db, 'DELETE FROM menus'),
      prepareStmt(db, 'DELETE FROM option_groups'),
      prepareStmt(db, 'DELETE FROM categories'),
      prepareStmt(db, 'DELETE FROM shop_settings'),
    ];

    for (const row of categories) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO categories (id, name, sort_order, is_active) VALUES (?, ?, ?, ?)',
          [row.id, row.name, row.sort_order, row.is_active]
        )
      );
    }

    for (const row of optionGroups) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO option_groups (id, name, selection_type, is_required, sort_order) VALUES (?, ?, ?, ?, ?)',
          [row.id, row.name, row.selection_type, row.is_required, row.sort_order]
        )
      );
    }

    for (const row of options) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO options (id, option_group_id, name, price_delta, is_available, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, row.option_group_id, row.name, row.price_delta, row.is_available, row.sort_order]
        )
      );
    }

    for (const row of menus) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO menus (id, category_id, name, base_price, is_available, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, row.category_id, row.name, row.base_price, row.is_available, row.sort_order]
        )
      );
    }

    for (const row of menuOptionGroups) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO menu_option_groups (menu_id, option_group_id, sort_order) VALUES (?, ?, ?)',
          [row.menu_id, row.option_group_id, row.sort_order]
        )
      );
    }

    for (const row of shopSettings) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO shop_settings (key, value, updated_at) VALUES (?, ?, ?)',
          [row.key, row.value, row.updated_at]
        )
      );
    }

    for (const row of orders) {
      stmts.push(
        prepareStmt(
          db,
          `INSERT INTO orders (
            id, order_no, queue_no, queue_date, order_type, table_id, table_name, source,
            kitchen_status, customer_name, tracking_token, staff_name, status, subtotal,
            discount_amount, total_amount, payment_method, received_amount, change_amount,
            cancel_reason, created_at, paid_at, cooking_started_at, ready_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.order_no,
            row.queue_no,
            row.queue_date,
            row.order_type,
            row.source,
            row.kitchen_status,
            row.customer_name,
            row.tracking_token,
            row.staff_name,
            row.status,
            row.subtotal,
            row.discount_amount,
            row.total_amount,
            row.payment_method,
            row.received_amount,
            row.change_amount,
            row.cancel_reason,
            row.created_at,
            row.paid_at,
            row.cooking_started_at,
            row.ready_at,
            row.completed_at,
          ]
        )
      );
    }

    for (const row of orderItems) {
      stmts.push(
        prepareStmt(
          db,
          `INSERT INTO order_items (
            id, order_id, menu_id, category_id, category_name, kitchen_status, menu_name,
            base_price, options_price, unit_price, quantity, line_total, note, is_custom
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.order_id,
            row.menu_id,
            row.category_id,
            row.category_name,
            row.kitchen_status,
            row.menu_name,
            row.base_price,
            row.options_price,
            row.unit_price,
            row.quantity,
            row.line_total,
            row.note,
            row.is_custom,
          ]
        )
      );
    }

    for (const row of orderItemOptions) {
      stmts.push(
        prepareStmt(
          db,
          'INSERT INTO order_item_options (id, order_item_id, option_group_name, option_name, price_delta) VALUES (?, ?, ?, ?, ?)',
          [row.id, row.order_item_id, row.option_group_name, row.option_name, row.price_delta]
        )
      );
    }

    if (dailyCounters.length > 0) {
      for (const row of dailyCounters) {
        stmts.push(
          prepareStmt(
            db,
            'INSERT INTO daily_counters (counter_date, last_seq) VALUES (?, ?)',
            [row.counter_date, row.last_seq]
          )
        );
      }
    } else if (orders.length > 0) {
      stmts.push(
        prepareStmt(
          db,
          `INSERT OR IGNORE INTO daily_counters (counter_date, last_seq)
          SELECT queue_date, MAX(queue_no)
          FROM orders
          WHERE queue_date IS NOT NULL AND queue_no IS NOT NULL
          GROUP BY queue_date`
        )
      );
    }

    await db.batch(stmts);

    const counts = {
      categories: categories.length,
      option_groups: optionGroups.length,
      options: options.length,
      menus: menus.length,
      menu_option_groups: menuOptionGroups.length,
      shop_settings: shopSettings.length,
      orders: orders.length,
      order_items: orderItems.length,
      order_item_options: orderItemOptions.length,
      daily_counters: dailyCounters.length,
      has_qr_image: shopSettings.some((s) => s.key === 'qr_image_data'),
    };

    console.log(
      JSON.stringify({
        event: 'backup_restored',
        actor: c.get('authUser')?.email || 'unknown',
        counts,
        at: now,
      })
    );

    return c.json({ restored: true, counts });
  });

  return router;
}
