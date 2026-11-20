CREATE TABLE IF NOT EXISTS daily_counters (
  counter_date TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

INSERT OR IGNORE INTO daily_counters (counter_date, last_seq)
SELECT queue_date, MAX(queue_no)
FROM orders
WHERE queue_date IS NOT NULL AND queue_no IS NOT NULL
GROUP BY queue_date;
