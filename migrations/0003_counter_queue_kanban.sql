ALTER TABLE orders ADD COLUMN queue_no INTEGER;
ALTER TABLE orders ADD COLUMN queue_date TEXT;
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'qr'));
ALTER TABLE orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK (kitchen_status IN ('pending', 'cooking', 'ready', 'completed', 'cancelled'));
ALTER TABLE orders ADD COLUMN customer_name TEXT;
ALTER TABLE orders ADD COLUMN tracking_token TEXT;
ALTER TABLE orders ADD COLUMN cooking_started_at TEXT;
ALTER TABLE orders ADD COLUMN ready_at TEXT;
ALTER TABLE orders ADD COLUMN completed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_queue_daily ON orders(queue_date, queue_no) WHERE queue_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token ON orders(tracking_token) WHERE tracking_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_kitchen_status ON orders(kitchen_status);
