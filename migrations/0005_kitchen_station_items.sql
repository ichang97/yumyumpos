ALTER TABLE order_items ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN category_name TEXT;
ALTER TABLE order_items ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK (kitchen_status IN ('pending', 'cooking', 'ready', 'completed', 'cancelled'));

UPDATE order_items
SET category_id = (
  SELECT m.category_id FROM menus m WHERE m.id = order_items.menu_id
)
WHERE menu_id IS NOT NULL AND category_id IS NULL;

UPDATE order_items
SET category_name = COALESCE(
  (SELECT c.name FROM categories c WHERE c.id = order_items.category_id),
  CASE WHEN is_custom = 1 THEN 'เมนูเอง' ELSE NULL END
)
WHERE category_name IS NULL;

UPDATE order_items
SET kitchen_status = COALESCE(
  (SELECT o.kitchen_status FROM orders o WHERE o.id = order_items.order_id),
  'pending'
);

CREATE INDEX IF NOT EXISTS idx_order_items_category_id ON order_items(category_id);
CREATE INDEX IF NOT EXISTS idx_order_items_kitchen_status ON order_items(kitchen_status);
