-- 送驗單快速輸入器 — Cloudflare D1 schema
-- 部署：CF Dashboard → D1 → 該資料庫 Console → 貼上執行
--
-- ⚠️ 既有資料庫升級到 v0.2.5（UPSERT + 變更歷史）：
--   1. 先檢查重複編號：SELECT no, COUNT(*) c FROM cases GROUP BY no HAVING c > 1;
--      → 若有結果，須先人工處理（合併或刪除）才能建唯一索引
--   2. 執行下方 cases_history 與 uq_cases_no 兩段 DDL
--   3. 部署新版 functions/api/cases.js（POST 改 UPSERT）

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

-- v0.2.5 新增：唯一性保證（讓 UPSERT 的 ON CONFLICT(no) 可用）
-- 若既有 D1 已有重複 no 會建立失敗，需先依上方 SELECT 排除重複
CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_no ON cases(no);

-- v0.2.5 新增：變更歷史（覆蓋更新前的舊版本快照，可還原）
CREATE TABLE IF NOT EXISTS cases_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,                    -- 對應 cases.id（覆蓋當下的舊 id）
  no TEXT NOT NULL,                   -- 送驗編號（方便用 no 查歷史）
  snapshot_json TEXT NOT NULL,        -- 舊 row 完整 JSON
  replaced_at INTEGER DEFAULT (strftime('%s','now')),
  reason TEXT                         -- 'upsert' / 'manual' / 其他
);

CREATE INDEX IF NOT EXISTS idx_history_no ON cases_history(no);
CREATE INDEX IF NOT EXISTS idx_history_replaced_at ON cases_history(replaced_at);
