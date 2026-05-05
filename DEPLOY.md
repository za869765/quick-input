# 部署 D1 雲端資料庫指南

`v0.2.0` 開始支援 Cloudflare D1 雲端儲存。第一次設置步驟如下。

## 1. 建立 D1 資料庫

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → 左側 **D1**
2. **Create database**
3. 名稱：`quick-input-db`（或自取）
4. Region：自動

## 2. 跑 schema

1. 點剛建好的 db → **Console** 分頁
2. 貼上 `schema.sql` 全文 → Execute
3. 執行 `SELECT * FROM cases;` 應回傳空清單即 OK

## 3. 綁 D1 到 Pages 專案

1. Workers & Pages → 你的 **quick-input** 專案 → **Settings** → **Functions** → **D1 database bindings**
2. **Add binding**：
   - Variable name：`DB`（**必須是 DB**，code 寫死）
   - D1 database：選 `quick-input-db`
3. Save

## 4. 觸發重新部署

任何 commit 都行，例如：

```bash
git commit --allow-empty -m "trigger redeploy after D1 binding"
git push
```

CF Pages 約 30 秒重新部署完成。

## 5. 驗證

開 `https://你的域名/api/_health` 應回傳：

```json
{ "ok": true, "dbBound": true, "caseCount": 0, "time": "..." }
```

## 6. 批次匯入既有資料

開 `https://你的域名/_import.html`：
1. 「檢查 D1 連線」應顯示綠色
2. 「選 JSON 檔」上傳 `_import_115.json`（本機解析過的歷史資料）
3. 「上傳到雲端」推送

完成後主頁開啟會自動帶入「下一筆編號」（接續雲端最大號 + 1）。

---

## API 一覽

| Method | Path | 用途 |
|---|---|---|
| GET | /api/_health | 健康檢查 + D1 binding 狀態 |
| GET | /api/cases?prefix=11505&limit=50&q=keyword | 查詢（支援前綴/關鍵字模糊查） |
| POST | /api/cases | 新增（單筆或陣列批次） |
| DELETE | /api/cases?id=N 或 ?no=XXX | 刪除 |
| GET | /api/cases/max-no?prefix=1150505 | 查當前 prefix 最大流水號 + 下一筆建議 |
