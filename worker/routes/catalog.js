import { Hono } from 'hono';
import { requireAdmin } from '../lib/accessAuth.js';
import { execute, prepareStmt, queryAll, queryByIdChunks, queryFirst } from '../lib/db.js';
import {
  HttpError,
  parseJsonBody,
  requireInt,
  requirePrice,
  requireString,
  toBoolInt,
} from '../lib/validate.js';
import { getPaymentSettings } from './settings.js';

async function getOptionGroupsWithOptions(db) {
  const [groups, options] = await Promise.all([
    queryAll(
      db,
      'SELECT id, name, selection_type, is_required, sort_order FROM option_groups ORDER BY sort_order ASC, id ASC'
    ),
    queryAll(
      db,
      'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options ORDER BY sort_order ASC, id ASC'
    ),
  ]);

  const optionsByGroup = new Map();
  for (const opt of options) {
    if (!optionsByGroup.has(opt.option_group_id)) {
      optionsByGroup.set(opt.option_group_id, []);
    }
    optionsByGroup.get(opt.option_group_id).push(opt);
  }

  return groups.map((group) => ({
    ...group,
    options: optionsByGroup.get(group.id) || [],
  }));
}

async function getMenusWithGroupIds(db) {
  const [menus, links] = await Promise.all([
    queryAll(
      db,
      'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus ORDER BY sort_order ASC, id ASC'
    ),
    queryAll(
      db,
      'SELECT menu_id, option_group_id, sort_order FROM menu_option_groups ORDER BY sort_order ASC, option_group_id ASC'
    ),
  ]);

  const groupIdsByMenu = new Map();
  for (const link of links) {
    if (!groupIdsByMenu.has(link.menu_id)) {
      groupIdsByMenu.set(link.menu_id, []);
    }
    groupIdsByMenu.get(link.menu_id).push(link.option_group_id);
  }

  return menus.map((menu) => ({
    ...menu,
    option_group_ids: groupIdsByMenu.get(menu.id) || [],
  }));
}

export async function getCatalogData(db) {
  const [categories, allMenus, optionGroups, paymentSettings] = await Promise.all([
    queryAll(
      db,
      'SELECT id, name, sort_order, is_active FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    ),
    getMenusWithGroupIds(db),
    getOptionGroupsWithOptions(db),
    getPaymentSettings(db),
  ]);

  const activeCatIds = new Set(categories.map((cat) => cat.id));
  const menus = allMenus.filter((m) => activeCatIds.has(m.category_id));

  return {
    categories,
    menus,
    option_groups: optionGroups,
    payment_settings: paymentSettings,
  };
}

async function validateOptionGroupIds(db, rawGroupIds) {
  if (rawGroupIds === undefined) {
    return [];
  }
  if (!Array.isArray(rawGroupIds)) {
    throw new HttpError(400, 'รูปแบบกลุ่มตัวเลือกไม่ถูกต้อง');
  }
  const seen = new Set();
  const normalized = [];
  for (const rawId of rawGroupIds) {
    const id = requireInt(Number(rawId), 'รหัสกลุ่มตัวเลือก', 1);
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  if (normalized.length > 0) {
    const found = await queryByIdChunks(
      db,
      (placeholders) => `SELECT id FROM option_groups WHERE id IN (${placeholders})`,
      normalized
    );
    if (found.length !== normalized.length) {
      throw new HttpError(400, 'มีกลุ่มตัวเลือกที่ไม่พบในระบบ');
    }
  }
  return normalized;
}

export function createCatalogRoutes() {
  const router = new Hono();

  router.get('/catalog', async (c) => {
    const data = await getCatalogData(c.env.DB);
    return c.json(data);
  });

  router.get('/categories', async (c) => {
    const categories = await queryAll(
      c.env.DB,
      'SELECT id, name, sort_order, is_active FROM categories ORDER BY sort_order ASC, id ASC'
    );
    return c.json({ categories });
  });

  router.post('/categories', requireAdmin, async (c) => {
    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อหมวดหมู่', 80);
    const sortOrder =
      body.sort_order !== undefined ? requireInt(body.sort_order, 'ลำดับ', 0, 9999) : 0;
    const isActive = toBoolInt(body.is_active, 1);

    const meta = await execute(
      c.env.DB,
      'INSERT INTO categories (name, sort_order, is_active) VALUES (?, ?, ?)',
      [name, sortOrder, isActive]
    );
    const category = await queryFirst(
      c.env.DB,
      'SELECT id, name, sort_order, is_active FROM categories WHERE id = ?',
      [meta.last_row_id]
    );
    return c.json({ category }, 201);
  });

  router.put('/categories/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสหมวดหมู่', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, name, sort_order, is_active FROM categories WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบหมวดหมู่ที่ต้องการแก้ไข');
    }

    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อหมวดหมู่', 80);
    const sortOrder =
      body.sort_order !== undefined
        ? requireInt(body.sort_order, 'ลำดับ', 0, 9999)
        : existing.sort_order;
    const isActive = toBoolInt(body.is_active, existing.is_active);

    await execute(
      c.env.DB,
      'UPDATE categories SET name = ?, sort_order = ?, is_active = ? WHERE id = ?',
      [name, sortOrder, isActive, id]
    );
    const category = await queryFirst(
      c.env.DB,
      'SELECT id, name, sort_order, is_active FROM categories WHERE id = ?',
      [id]
    );
    return c.json({ category });
  });

  router.delete('/categories/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสหมวดหมู่', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id FROM categories WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบหมวดหมู่ที่ต้องการลบ');
    }

    const countRow = await queryFirst(
      c.env.DB,
      'SELECT COUNT(id) AS total FROM menus WHERE category_id = ?',
      [id]
    );
    if (countRow && countRow.total > 0) {
      throw new HttpError(409, 'ไม่สามารถลบหมวดหมู่ที่ยังมีเมนูอยู่ได้ กรุณาย้ายหรือลบเมนูก่อน');
    }

    await execute(c.env.DB, 'DELETE FROM categories WHERE id = ?', [id]);
    return c.json({ deleted: true });
  });

  router.get('/option-groups', async (c) => {
    const optionGroups = await getOptionGroupsWithOptions(c.env.DB);
    return c.json({ option_groups: optionGroups });
  });

  router.post('/option-groups', requireAdmin, async (c) => {
    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อกลุ่มตัวเลือก', 80);
    const selectionType = body.selection_type === 'multiple' ? 'multiple' : 'single';
    if (
      body.selection_type !== undefined &&
      body.selection_type !== 'single' &&
      body.selection_type !== 'multiple'
    ) {
      throw new HttpError(400, 'รูปแบบการเลือกต้องเป็น single หรือ multiple');
    }
    const isRequired = toBoolInt(body.is_required, 0);
    const sortOrder =
      body.sort_order !== undefined ? requireInt(body.sort_order, 'ลำดับ', 0, 9999) : 0;

    const meta = await execute(
      c.env.DB,
      'INSERT INTO option_groups (name, selection_type, is_required, sort_order) VALUES (?, ?, ?, ?)',
      [name, selectionType, isRequired, sortOrder]
    );
    const group = await queryFirst(
      c.env.DB,
      'SELECT id, name, selection_type, is_required, sort_order FROM option_groups WHERE id = ?',
      [meta.last_row_id]
    );
    return c.json({ option_group: { ...group, options: [] } }, 201);
  });

  router.put('/option-groups/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสกลุ่มตัวเลือก', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, name, selection_type, is_required, sort_order FROM option_groups WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบกลุ่มตัวเลือกที่ต้องการแก้ไข');
    }

    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อกลุ่มตัวเลือก', 80);
    const selectionType = body.selection_type ?? existing.selection_type;
    if (selectionType !== 'single' && selectionType !== 'multiple') {
      throw new HttpError(400, 'รูปแบบการเลือกต้องเป็น single หรือ multiple');
    }
    const isRequired = toBoolInt(body.is_required, existing.is_required);
    const sortOrder =
      body.sort_order !== undefined
        ? requireInt(body.sort_order, 'ลำดับ', 0, 9999)
        : existing.sort_order;

    await execute(
      c.env.DB,
      'UPDATE option_groups SET name = ?, selection_type = ?, is_required = ?, sort_order = ? WHERE id = ?',
      [name, selectionType, isRequired, sortOrder, id]
    );

    const [group, options] = await Promise.all([
      queryFirst(
        c.env.DB,
        'SELECT id, name, selection_type, is_required, sort_order FROM option_groups WHERE id = ?',
        [id]
      ),
      queryAll(
        c.env.DB,
        'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options WHERE option_group_id = ? ORDER BY sort_order ASC, id ASC',
        [id]
      ),
    ]);
    return c.json({ option_group: { ...group, options } });
  });

  router.delete('/option-groups/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสกลุ่มตัวเลือก', 1);
    const meta = await execute(c.env.DB, 'DELETE FROM option_groups WHERE id = ?', [id]);
    if (!meta.changes) {
      throw new HttpError(404, 'ไม่พบกลุ่มตัวเลือกที่ต้องการลบ');
    }
    return c.json({ deleted: true });
  });

  router.post('/option-groups/:groupId/options', requireAdmin, async (c) => {
    const groupId = requireInt(Number(c.req.param('groupId')), 'รหัสกลุ่มตัวเลือก', 1);
    const group = await queryFirst(
      c.env.DB,
      'SELECT id FROM option_groups WHERE id = ?',
      [groupId]
    );
    if (!group) {
      throw new HttpError(404, 'ไม่พบกลุ่มตัวเลือก');
    }

    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อตัวเลือก', 80);
    const priceDelta =
      body.price_delta !== undefined ? requirePrice(body.price_delta, 'ราคาเพิ่ม') : 0;
    const isAvailable = toBoolInt(body.is_available, 1);
    const sortOrder =
      body.sort_order !== undefined ? requireInt(body.sort_order, 'ลำดับ', 0, 9999) : 0;

    const meta = await execute(
      c.env.DB,
      'INSERT INTO options (option_group_id, name, price_delta, is_available, sort_order) VALUES (?, ?, ?, ?, ?)',
      [groupId, name, priceDelta, isAvailable, sortOrder]
    );
    const option = await queryFirst(
      c.env.DB,
      'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options WHERE id = ?',
      [meta.last_row_id]
    );
    return c.json({ option }, 201);
  });

  router.put('/options/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสตัวเลือก', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบตัวเลือกที่ต้องการแก้ไข');
    }

    const body = await parseJsonBody(c);
    const name = requireString(body.name, 'ชื่อตัวเลือก', 80);
    const priceDelta =
      body.price_delta !== undefined
        ? requirePrice(body.price_delta, 'ราคาเพิ่ม')
        : existing.price_delta;
    const isAvailable = toBoolInt(body.is_available, existing.is_available);
    const sortOrder =
      body.sort_order !== undefined
        ? requireInt(body.sort_order, 'ลำดับ', 0, 9999)
        : existing.sort_order;

    await execute(
      c.env.DB,
      'UPDATE options SET name = ?, price_delta = ?, is_available = ?, sort_order = ? WHERE id = ?',
      [name, priceDelta, isAvailable, sortOrder, id]
    );
    const option = await queryFirst(
      c.env.DB,
      'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options WHERE id = ?',
      [id]
    );
    return c.json({ option });
  });

  router.patch('/options/:id/availability', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสตัวเลือก', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, is_available FROM options WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบตัวเลือก');
    }

    const body = await parseJsonBody(c);
    const nextState =
      body.is_available !== undefined
        ? toBoolInt(body.is_available)
        : existing.is_available
          ? 0
          : 1;

    await execute(c.env.DB, 'UPDATE options SET is_available = ? WHERE id = ?', [nextState, id]);
    const option = await queryFirst(
      c.env.DB,
      'SELECT id, option_group_id, name, price_delta, is_available, sort_order FROM options WHERE id = ?',
      [id]
    );
    return c.json({ option });
  });

  router.delete('/options/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสตัวเลือก', 1);
    const meta = await execute(c.env.DB, 'DELETE FROM options WHERE id = ?', [id]);
    if (!meta.changes) {
      throw new HttpError(404, 'ไม่พบตัวเลือกที่ต้องการลบ');
    }
    return c.json({ deleted: true });
  });

  router.get('/menus', async (c) => {
    const menus = await getMenusWithGroupIds(c.env.DB);
    return c.json({ menus });
  });

  router.post('/menus', requireAdmin, async (c) => {
    const body = await parseJsonBody(c);
    const categoryId = requireInt(Number(body.category_id), 'หมวดหมู่', 1);
    const category = await queryFirst(
      c.env.DB,
      'SELECT id FROM categories WHERE id = ?',
      [categoryId]
    );
    if (!category) {
      throw new HttpError(400, 'ไม่พบหมวดหมู่ที่เลือก');
    }

    const name = requireString(body.name, 'ชื่อเมนู', 100);
    const basePrice = requirePrice(body.base_price, 'ราคา');
    const isAvailable = toBoolInt(body.is_available, 1);
    const sortOrder =
      body.sort_order !== undefined ? requireInt(body.sort_order, 'ลำดับ', 0, 9999) : 0;
    const optionGroupIds = await validateOptionGroupIds(c.env.DB, body.option_group_ids);

    const meta = await execute(
      c.env.DB,
      'INSERT INTO menus (category_id, name, base_price, is_available, sort_order) VALUES (?, ?, ?, ?, ?)',
      [categoryId, name, basePrice, isAvailable, sortOrder]
    );
    const createdId = meta.last_row_id;

    if (optionGroupIds.length > 0) {
      await c.env.DB.batch(
        optionGroupIds.map((groupId, idx) =>
          prepareStmt(
            c.env.DB,
            'INSERT INTO menu_option_groups (menu_id, option_group_id, sort_order) VALUES (?, ?, ?)',
            [createdId, groupId, idx + 1]
          )
        )
      );
    }

    const menu = await queryFirst(
      c.env.DB,
      'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus WHERE id = ?',
      [createdId]
    );
    return c.json(
      {
        menu: {
          ...menu,
          option_group_ids: optionGroupIds,
        },
      },
      201
    );
  });

  router.put('/menus/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสเมนู', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบเมนูที่ต้องการแก้ไข');
    }

    const body = await parseJsonBody(c);
    const categoryId =
      body.category_id !== undefined
        ? requireInt(Number(body.category_id), 'หมวดหมู่', 1)
        : existing.category_id;
    const category = await queryFirst(
      c.env.DB,
      'SELECT id FROM categories WHERE id = ?',
      [categoryId]
    );
    if (!category) {
      throw new HttpError(400, 'ไม่พบหมวดหมู่ที่เลือก');
    }

    const name = requireString(body.name, 'ชื่อเมนู', 100);
    const basePrice = requirePrice(body.base_price, 'ราคา');
    const isAvailable = toBoolInt(body.is_available, existing.is_available);
    const sortOrder =
      body.sort_order !== undefined
        ? requireInt(body.sort_order, 'ลำดับ', 0, 9999)
        : existing.sort_order;
    const optionGroupIds =
      body.option_group_ids !== undefined
        ? await validateOptionGroupIds(c.env.DB, body.option_group_ids)
        : null;

    const stmts = [
      prepareStmt(
        c.env.DB,
        'UPDATE menus SET category_id = ?, name = ?, base_price = ?, is_available = ?, sort_order = ? WHERE id = ?',
        [categoryId, name, basePrice, isAvailable, sortOrder, id]
      ),
    ];

    if (optionGroupIds !== null) {
      stmts.push(
        prepareStmt(c.env.DB, 'DELETE FROM menu_option_groups WHERE menu_id = ?', [id])
      );
      optionGroupIds.forEach((groupId, idx) => {
        stmts.push(
          prepareStmt(
            c.env.DB,
            'INSERT INTO menu_option_groups (menu_id, option_group_id, sort_order) VALUES (?, ?, ?)',
            [id, groupId, idx + 1]
          )
        );
      });
    }

    await c.env.DB.batch(stmts);

    const [menu, links] = await Promise.all([
      queryFirst(
        c.env.DB,
        'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus WHERE id = ?',
        [id]
      ),
      queryAll(
        c.env.DB,
        'SELECT option_group_id FROM menu_option_groups WHERE menu_id = ? ORDER BY sort_order ASC, option_group_id ASC',
        [id]
      ),
    ]);
    return c.json({
      menu: {
        ...menu,
        option_group_ids: links.map((l) => l.option_group_id),
      },
    });
  });

  router.patch('/menus/:id/availability', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสเมนู', 1);
    const existing = await queryFirst(
      c.env.DB,
      'SELECT id, is_available FROM menus WHERE id = ?',
      [id]
    );
    if (!existing) {
      throw new HttpError(404, 'ไม่พบเมนู');
    }

    const body = await parseJsonBody(c);
    const nextState =
      body.is_available !== undefined
        ? toBoolInt(body.is_available)
        : existing.is_available
          ? 0
          : 1;

    await execute(c.env.DB, 'UPDATE menus SET is_available = ? WHERE id = ?', [nextState, id]);
    const [menu, links] = await Promise.all([
      queryFirst(
        c.env.DB,
        'SELECT id, category_id, name, base_price, is_available, sort_order FROM menus WHERE id = ?',
        [id]
      ),
      queryAll(
        c.env.DB,
        'SELECT option_group_id FROM menu_option_groups WHERE menu_id = ? ORDER BY sort_order ASC, option_group_id ASC',
        [id]
      ),
    ]);
    return c.json({
      menu: {
        ...menu,
        option_group_ids: links.map((l) => l.option_group_id),
      },
    });
  });

  router.delete('/menus/:id', requireAdmin, async (c) => {
    const id = requireInt(Number(c.req.param('id')), 'รหัสเมนู', 1);
    const meta = await execute(c.env.DB, 'DELETE FROM menus WHERE id = ?', [id]);
    if (!meta.changes) {
      throw new HttpError(404, 'ไม่พบเมนูที่ต้องการลบ');
    }
    return c.json({ deleted: true });
  });

  return router;
}
