# 揪呷團

從 Claude Artifact 雛形移植過來的正式版本：Next.js 16（App Router）+ Vercel + Neon Postgres。

## 專案結構

```
app/
  page.js                主頁面，載入 GroupOrderApp
  layout.js              全站 layout
  globals.css            設計系統樣式（含 Tailwind v4 匯入）
  components/
    GroupOrderApp.jsx    主要應用程式（所有畫面都在這個 client component 裡）
    api.js               呼叫後端 API 的統一介面
    identity.js          用 localStorage 記住「你的稱呼」
  api/                   後端 API route handlers（Next.js Route Handlers）
    menus/               菜單 CRUD + AI 辨識
    groups/              揪團 CRUD、點餐、結單、付款狀態
    payment-profile/     個人收款資料
lib/
  db.js                  Neon 資料庫連線（@neondatabase/serverless）
  mappers.js             資料庫欄位 (snake_case) <-> 前端物件 (camelCase) 轉換
  apiHelpers.js           API 路由共用的錯誤處理
schema.sql               建立資料表用的 SQL
.env.example             需要的環境變數範例
```

## 上線步驟

### 1. 建立 Neon 資料庫
1. 到 https://neon.tech 建立一個新專案（免費方案即可）。
2. 進到專案的 Dashboard，點左側選單的 **SQL Editor**，貼上 `schema.sql` 整份內容並執行，建立好三張表（menus / groups / payment_profiles）。
3. 回到 Dashboard 首頁，複製 **Connection string**（記得選 "Pooled connection" 那一條，適合 Vercel 這種 serverless 環境）。

### 2. 準備 Anthropic API Key
到 https://console.anthropic.com 建立一組新的 API Key（這跟你平常用網頁版 Claude.ai 的帳號是分開的計費系統，辨識菜單會依用量計費，但金額很低）。

### 3. 建立 GitHub Repo 並推上去
```bash
cd group-order-webapp
git init
git add .
git commit -m "init"
# 到 github.com 建立一個新的空 repo，取得它的 URL 之後：
git remote add origin <你的 repo URL>
git push -u origin main
```

### 4. 部署到 Vercel
1. 到 https://vercel.com，用 GitHub 帳號登入，選擇「Import Project」，選剛剛那個 repo。
2. 在 **Environment Variables** 這一步，加入兩個變數：
   - `DATABASE_URL` = 步驟 1 複製的 Neon 連線字串
   - `ANTHROPIC_API_KEY` = 步驟 2 拿到的 API Key
3. 按 Deploy，等個一兩分鐘就會拿到一個 `https://xxxx.vercel.app` 的網址。

### 5. 測試
打開網址，輸入你的稱呼，先上傳一份菜單試試 AI 辨識，再開一團自己點餐、結單看看。確認沒問題後，把網址發給隊上其他人（未來要換自己的網域，在 Vercel 專案的 Settings > Domains 加即可）。

## 之後想加強的方向（先不做，供參考）
- 目前每個人身分只是「輸入稱呼」沒有密碼，跟你的請假系統的 PIN 機制不同，如果需要防止別人亂改，可以之後再加。
- 收款 QR Code 目前直接存 base64 在資料庫裡，這個規模完全沒問題；如果之後圖片變多、變大，可以改用 Vercel Blob 或其他物件儲存。
- 目前用輪詢（每 4 秒重抓一次）做「即時」更新，18 人的規模綽綽有餘；真的要做到即時，可以考慮之後接 Neon 的 LISTEN/NOTIFY 或 Pusher 之類的服務。
