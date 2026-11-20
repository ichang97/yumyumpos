CREATE TABLE IF NOT EXISTS shop_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO shop_settings (key, value, updated_at) VALUES
  ('enable_cash', '1', '2026-11-20 00:00:00'),
  ('enable_qr', '1', '2026-11-20 00:00:00'),
  ('promptpay_id', '', '2026-11-20 00:00:00'),
  ('promptpay_name', '', '2026-11-20 00:00:00');
