-- 送驗單快速輸入器 — Cloudflare D1 schema
-- 部署：CF Dashboard → D1 → 該資料庫 Console → 貼上執行

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL,                   -- 送驗編號（如 11505050259）
  mode TEXT NOT NULL DEFAULT 'named', -- 'named' or 'anon'
  name TEXT,                          -- 姓名（具名）
  consult TEXT,                       -- 諮詢代碼（匿名）
  birth TEXT,                         -- 出生年月日 民國 yy/mm/dd
  id_no TEXT,                         -- 身分證字號
  sex TEXT,                           -- '1' 男 / '2' 女
  target TEXT,                        -- 檢驗對象代碼
  sample_date TEXT,                   -- 採檢日期 民國
  reason TEXT,                        -- 送驗原因
  unit TEXT,                          -- 單位名稱
  send_date TEXT,                     -- 送驗日期 民國
  source_file TEXT,                   -- 來源檔（匯入時用）
  apply_no TEXT,                      -- 申請單號（系統回填）
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_cases_no ON cases(no);
CREATE INDEX IF NOT EXISTS idx_cases_send_date ON cases(send_date);
CREATE INDEX IF NOT EXISTS idx_cases_name ON cases(name);
CREATE INDEX IF NOT EXISTS idx_cases_id_no ON cases(id_no);
CREATE INDEX IF NOT EXISTS idx_cases_mode ON cases(mode);
