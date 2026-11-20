import { prepareStmt, queryAll, queryByIdChunks, queryFirst } from './db.js';
import { getBangkokDate, getBangkokNow } from './time.js';
import {
  HttpError,
  optionalString,
  requireInt,
  requirePrice,
  requireString,
} from './validate.js';

export const ORDER_COLUMNS = `
  id,
  order_no,
  queue_no,
  queue_date,
  order_type,
  source,
  kitchen_status,
  customer_name,
  tracking_token,
  staff_name,
  status,
  subtotal,
  discount_amount,
  total_amount,
  payment_method,
  received_amount,
  change_amount,
  cancel_reason,
  created_at,
  paid_at,
  cooking_started_at,
  ready_at,
  completed_at
`;

export function deriveOrderKitchenStatus(itemStatuses) {
  const active = (Array.isArray(itemStatuses) ? itemStatuses : []).filter(
    (s) => s && s !== 'cancelled'
  );
  if (active.length === 0) {
    return 'pending';
  }
  if (active.every((s) => s === 'completed')) {
    return 'completed';
  }
  if (active.every((s) => s === 'ready' || s === 'completed')) {
    return 'ready';
  }
  if (active.some((s) => s === 'cooking' || s === 'ready' || s === 'completed')) {
    return 'cooking';
  }
  return 'pending';
}

export async function hydrateOrders(db, orderRows) {
  if (!orderRows || orderRows.length === 0) {
    return [];
  }

  const orderIds = orderRows.map((o) => o.id);
  const itemRows = await queryByIdChunks(
    db,
    (placeholders) =>
      `SELECT
        id,
        order_id,
        menu_id,
        category_id,
        category_name,
        kitchen_status,
        menu_name,
        base_price,
        options_price,
        unit_price,
        quantity,
        line_total,
        note,
        is_custom
      FROM order_items
      WHERE order_id IN (${placeholders})
      ORDER BY id ASC`,
    orderIds
  );

  const optionsByItemId = new Map();
  if (itemRows.length > 0) {
    const itemIds = itemRows.map((item) => item.id);
    const optionRows = await queryByIdChunks(
      db,
      (placeholders) =>
        `SELECT
          id,
          order_item_id,
          option_group_name,
          option_name,
          price_delta
        FROM order_item_options
        WHERE order_item_id IN (${placeholders})
        ORDER BY id ASC`,
      itemIds
    );

    for (const opt of optionRows) {
      if (!optionsByItemId.has(opt.order_item_id)) {
        optionsByItemId.set(opt.order_item_id, []);
      }
      optionsByItemId.get(opt.order_item_id).push(opt);
    }
  }

  const itemsByOrderId = new Map();
  for (const item of itemRows) {
    if (!itemsByOrderId.has(item.order_id)) {
      itemsByOrderId.set(item.order_id, []);
    }
    itemsByOrderId.get(item.order_id).push({
      ...item,
      options: optionsByItemId.get(item.id) || [],
    });
  }

  return orderRows.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) || [],
  }));
}

export async function getOrderById(db, orderId) {
  const row = await queryFirst(
    db,
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!row) {
    return null;
  }
  const hydrated = await hydrateOrders(db, [row]);
  return hydrated[0];
}

export async function getOrderByTrackingToken(db, token) {
  const row = await queryFirst(
    db,
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE tracking_token = ?`,
    [token]
  );
  if (!row) {
    return null;
  }
  const hydrated = await hydrateOrders(db, [row]);
  return hydrated[0];
}

export function sanitizePublicOrder(order) {
  if (!order) {
    return null;
  }
  return {
    order_no: order.order_no,
    queue_no: order.queue_no,
    queue_date: order.queue_date,
    order_type: order.order_type,
    customer_name: order.customer_name,
    status: order.status,
    kitchen_status: order.kitchen_status,
    payment_method: order.payment_method,
    subtotal: order.subtotal,
    discount_amount: order.discount_amount,
    total_amount: order.total_amount,
    cancel_reason: order.cancel_reason,
    created_at: order.created_at,
    cooking_started_at: order.cooking_started_at,
    ready_at: order.ready_at,
    completed_at: order.completed_at,
    tracking_token: order.tracking_token,
    items: (order.items || []).map((item) => ({
      id: item.id,
      menu_name: item.menu_name,
      category_name: item.category_name,
      kitchen_status: item.kitchen_status,
      unit_price: item.unit_price,
      quantity: item.quantity,
      line_total: item.line_total,
      note: item.note,
      options: (item.options || []).map((opt) => ({
        option_group_name: opt.option_group_name,
        option_name: opt.option_name,
        price_delta: opt.price_delta,
      })),
    })),
  };
}

export async function resolveOrderItems(
  db,
  rawItems,
  { allowCustom = true, maxItems = 50, maxQtyPerItem = 999 } = {}
) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'กรุณาเลือกรายการอาหารอย่างน้อย 1 รายการ');
  }
  if (rawItems.length > maxItems) {
    throw new HttpError(400, `สั่งอาหารได้สูงสุด ${maxItems} รายการต่อบิล`);
  }

  const resolved = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') {
      throw new HttpError(400, 'ข้อมูลรายการอาหารไม่ถูกต้อง');
    }

    const quantity = requireInt(rawItem.quantity ?? 1, 'จำนวน', 1, maxQtyPerItem);
    const note = optionalString(rawItem.note, 200);
    const isCustom = Boolean(rawItem.is_custom);

    if (isCustom) {
      if (!allowCustom) {
        throw new HttpError(400, 'ไม่อนุญาตให้กำหนดเมนูเองผ่านช่องทางนี้');
      }
      const menuName = requireString(rawItem.menu_name, 'ชื่อเมนู', 100);
      const basePrice = requirePrice(rawItem.base_price, 'ราคา');
      const unitPrice = basePrice;
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      resolved.push({
        menu_id: null,
        category_id: null,
        category_name: 'เมนูเอง',
        kitchen_status: 'pending',
        menu_name: menuName,
        base_price: basePrice,
        options_price: 0,
        unit_price: unitPrice,
        quantity,
        line_total: lineTotal,
        note,
        is_custom: 1,
        options: [],
      });
      continue;
    }

    const menuId = requireInt(Number(rawItem.menu_id), 'รหัสเมนู', 1);
    const menu = await queryFirst(
      db,
      `SELECT m.id, m.category_id, c.name AS category_name, m.name, m.base_price, m.is_available
      FROM menus m
      LEFT JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?`,
      [menuId]
    );
    if (!menu) {
      throw new HttpError(400, 'ไม่พบเมนูที่เลือกในระบบ');
    }
    if (!menu.is_available) {
      throw new HttpError(400, `เมนู "${menu.name}" หมดชั่วคราว`);
    }

    const linkedGroups = await queryAll(
      db,
      `SELECT og.id, og.name, og.selection_type, og.is_required
      FROM menu_option_groups mog
      JOIN option_groups og ON og.id = mog.option_group_id
      WHERE mog.menu_id = ?
      ORDER BY mog.sort_order ASC, og.id ASC`,
      [menuId]
    );

    const rawOptionIds = rawItem.option_ids ?? [];
    if (!Array.isArray(rawOptionIds)) {
      throw new HttpError(400, 'รูปแบบตัวเลือกไม่ถูกต้อง');
    }

    const selectedOptionIds = [];
    const seenOptionIds = new Set();
    for (const rawOptId of rawOptionIds) {
      const optId = requireInt(Number(rawOptId), 'รหัสตัวเลือก', 1);
      if (!seenOptionIds.has(optId)) {
        seenOptionIds.add(optId);
        selectedOptionIds.push(optId);
      }
    }

    let optionsById = new Map();
    if (linkedGroups.length > 0) {
      const groupIds = linkedGroups.map((g) => g.id);
      const availableOptions = await queryByIdChunks(
        db,
        (placeholders) =>
          `SELECT id, option_group_id, name, price_delta, is_available, sort_order
          FROM options
          WHERE option_group_id IN (${placeholders})
          ORDER BY sort_order ASC, id ASC`,
        groupIds
      );
      optionsById = new Map(availableOptions.map((opt) => [opt.id, opt]));
    }

    const selectedByGroup = new Map();
    for (const optId of selectedOptionIds) {
      const opt = optionsById.get(optId);
      if (!opt) {
        throw new HttpError(400, `ตัวเลือกที่เลือกไม่ตรงกับเมนู "${menu.name}"`);
      }
      if (!opt.is_available) {
        throw new HttpError(400, `ตัวเลือก "${opt.name}" หมดชั่วคราว`);
      }
      if (!selectedByGroup.has(opt.option_group_id)) {
        selectedByGroup.set(opt.option_group_id, []);
      }
      selectedByGroup.get(opt.option_group_id).push(opt);
    }

    const snapshotOptions = [];
    let optionsPrice = 0;

    for (const group of linkedGroups) {
      const picks = selectedByGroup.get(group.id) || [];
      if (group.is_required && picks.length === 0) {
        throw new HttpError(400, `กรุณาเลือก "${group.name}" สำหรับเมนู "${menu.name}"`);
      }
      if (group.selection_type === 'single' && picks.length > 1) {
        throw new HttpError(400, `"${group.name}" สามารถเลือกได้เพียง 1 อย่าง`);
      }
      for (const pick of picks) {
        optionsPrice += pick.price_delta;
        snapshotOptions.push({
          option_group_name: group.name,
          option_name: pick.name,
          price_delta: pick.price_delta,
        });
      }
    }

    optionsPrice = Math.round(optionsPrice * 100) / 100;
    const unitPrice = Math.round((menu.base_price + optionsPrice) * 100) / 100;
    const lineTotal = Math.round(unitPrice * quantity * 100) / 100;

    resolved.push({
      menu_id: menu.id,
      category_id: menu.category_id,
      category_name: menu.category_name || null,
      kitchen_status: 'pending',
      menu_name: menu.name,
      base_price: menu.base_price,
      options_price: optionsPrice,
      unit_price: unitPrice,
      quantity,
      line_total: lineTotal,
      note,
      is_custom: 0,
      options: snapshotOptions,
    });
  }

  return resolved;
}

function formatOrderNo(bangkokDate, seq) {
  const compact = bangkokDate.replace(/-/g, '').slice(2);
  return `${compact}-${String(seq).padStart(4, '0')}`;
}

async function nextDailySequence(db, bangkokDate) {
  const row = await queryFirst(
    db,
    `INSERT INTO daily_counters (counter_date, last_seq)
    VALUES (?, 1)
    ON CONFLICT(counter_date) DO UPDATE SET last_seq = last_seq + 1
    RETURNING last_seq`,
    [bangkokDate]
  );
  return Number(row?.last_seq || 1);
}

export function computePaymentFields(subtotal, body) {
  const discountAmount =
    body.discount_amount !== undefined && body.discount_amount !== null && body.discount_amount !== ''
      ? requirePrice(body.discount_amount, 'ส่วนลด')
      : 0;
  if (discountAmount > subtotal) {
    throw new HttpError(400, 'ส่วนลดต้องไม่เกินยอดรวมอาหาร');
  }
  const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;
  const paymentMethod = body.payment_method;
  if (paymentMethod !== 'cash' && paymentMethod !== 'transfer') {
    throw new HttpError(400, 'กรุณาเลือกวิธีชำระเงินเป็น cash หรือ transfer');
  }

  let receivedAmount = totalAmount;
  let changeAmount = 0;

  if (paymentMethod === 'cash') {
    if (
      body.received_amount !== undefined &&
      body.received_amount !== null &&
      body.received_amount !== ''
    ) {
      receivedAmount = requirePrice(body.received_amount, 'จำนวนเงินที่รับ');
      if (receivedAmount < totalAmount) {
        throw new HttpError(400, 'จำนวนเงินที่รับน้อยกว่ายอดที่ต้องชำระ');
      }
    }
    changeAmount = Math.round((receivedAmount - totalAmount) * 100) / 100;
  }

  return {
    discountAmount,
    totalAmount,
    paymentMethod,
    receivedAmount,
    changeAmount,
  };
}

export async function createCounterOrder(
  db,
  {
    orderType,
    source = 'staff',
    staffName,
    customerName = null,
    rawItems,
    payNow = false,
    preferredPaymentMethod = null,
    paymentBody = {},
    allowCustom = true,
    maxItems = 50,
    maxQtyPerItem = 999,
  }
) {
  if (orderType !== 'dine_in' && orderType !== 'takeaway') {
    throw new HttpError(400, 'ประเภทออเดอร์ต้องเป็น dine_in หรือ takeaway');
  }

  const resolvedItems = await resolveOrderItems(db, rawItems, {
    allowCustom,
    maxItems,
    maxQtyPerItem,
  });
  const subtotal =
    Math.round(resolvedItems.reduce((sum, item) => sum + item.line_total, 0) * 100) / 100;

  const today = getBangkokDate();
  const now = getBangkokNow();
  const trackingToken = crypto.randomUUID();

  let status = 'open';
  let discountAmount = 0;
  let totalAmount = subtotal;
  let paymentMethod =
    !payNow && (preferredPaymentMethod === 'cash' || preferredPaymentMethod === 'transfer')
      ? preferredPaymentMethod
      : null;
  let receivedAmount = null;
  let changeAmount = null;
  let paidAt = null;

  if (payNow) {
    const payment = computePaymentFields(subtotal, paymentBody);
    status = 'paid';
    discountAmount = payment.discountAmount;
    totalAmount = payment.totalAmount;
    paymentMethod = payment.paymentMethod;
    receivedAmount = payment.receivedAmount;
    changeAmount = payment.changeAmount;
    paidAt = now;
  }

  const seq = await nextDailySequence(db, today);
  const queueNo = seq;
  const orderNo = formatOrderNo(today, seq);

  const stmts = [
    prepareStmt(
      db,
      `INSERT INTO orders (
        order_no,
        queue_no,
        queue_date,
        order_type,
        table_id,
        table_name,
        source,
        kitchen_status,
        customer_name,
        tracking_token,
        staff_name,
        status,
        subtotal,
        discount_amount,
        total_amount,
        payment_method,
        received_amount,
        change_amount,
        cancel_reason,
        created_at,
        paid_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        orderNo,
        queueNo,
        today,
        orderType,
        source,
        customerName,
        trackingToken,
        staffName,
        status,
        subtotal,
        discountAmount,
        totalAmount,
        paymentMethod,
        receivedAmount,
        changeAmount,
        now,
        paidAt,
      ]
    ),
  ];

  for (const item of resolvedItems) {
    stmts.push(
      prepareStmt(
        db,
        `INSERT INTO order_items (
          order_id,
          menu_id,
          category_id,
          category_name,
          kitchen_status,
          menu_name,
          base_price,
          options_price,
          unit_price,
          quantity,
          line_total,
          note,
          is_custom
        ) VALUES ((SELECT id FROM orders WHERE tracking_token = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trackingToken,
          item.menu_id,
          item.category_id ?? null,
          item.category_name ?? null,
          item.kitchen_status || 'pending',
          item.menu_name,
          item.base_price,
          item.options_price,
          item.unit_price,
          item.quantity,
          item.line_total,
          item.note,
          item.is_custom,
        ]
      )
    );

    for (const opt of item.options) {
      stmts.push(
        prepareStmt(
          db,
          `INSERT INTO order_item_options (
            order_item_id,
            option_group_name,
            option_name,
            price_delta
          ) VALUES ((SELECT MAX(id) FROM order_items WHERE order_id = (SELECT id FROM orders WHERE tracking_token = ?)), ?, ?, ?)`,
          [trackingToken, opt.option_group_name, opt.option_name, opt.price_delta]
        )
      );
    }
  }

  await db.batch(stmts);
  return getOrderByTrackingToken(db, trackingToken);
}
