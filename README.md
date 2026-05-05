# 送驗單快速輸入器 (quick-input)

衛生所/外展工作的送驗單快速產生工具。

## 功能（規劃中）

- 表單快速輸入個案資料（姓名、出生年月日、身分證、性別、檢驗項目等）
- 一鍵產生符合衛生局格式的送驗單 XLSX
- **重點**：兩個分頁都自動填好
  - 第一分頁「送驗單」— 列印紙本
  - 第二分頁「醫事檢驗檢體列表」— ⚡ 系統上傳專用
- 雲端個別儲存常用設定 / 個案資料（千筆內）

## 技術棧

- 前端：單檔 `index.html`（Vanilla JS + SheetJS 讀寫 XLSX）
- 部署：Cloudflare Pages
- 雲端儲存：Cloudflare D1（個別使用，以使用者代號區隔）
- 版本控管：GitHub

## 部署

1. Cloudflare Pages 連 GitHub 自動部署
2. D1 資料庫透過 wrangler 建立 schema（`schema.sql`）
3. 在 Cloudflare Pages 專案設定 D1 binding `DB`
