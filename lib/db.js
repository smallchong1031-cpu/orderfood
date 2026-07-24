import { neon } from "@neondatabase/serverless";

let client = null;

/**
 * 取得可執行 SQL 的 tagged-template 函式。
 * 用法：await sql`select * from menus where id = ${id}`
 * 延遲到第一次呼叫才讀取 DATABASE_URL，避免在 build 階段（還沒有設定環境變數時）就出錯。
 */
export function sql(strings, ...values) {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      throw new Error("尚未設定 DATABASE_URL 環境變數，請確認 Vercel 專案的 Environment Variables。");
    }
    client = neon(process.env.DATABASE_URL);
  }
  return client(strings, ...values);
}
