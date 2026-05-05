-- Cloudflare D1 schema for quick-input
-- 之後接雲端時用：wrangler d1 execute quick-input-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  user_code TEXT PRIMARY KEY,
  display_name TEXT,
  unit_name TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT NOT NULL,
  apply_no TEXT,
  send_date TEXT,
  reason TEXT,
  target_code TEXT,
  rows_json TEXT,
  saved_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_code) REFERENCES users(user_code)
);

CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_code);
