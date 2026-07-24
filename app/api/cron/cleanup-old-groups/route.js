import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// 由 Vercel Cron 每天觸發一次：把「已結單超過 5 天」的揪團自動刪除。
// Vercel 會在請求上帶 Authorization: Bearer <CRON_SECRET>，用來確認這是 Vercel 自己觸發的、
// 不是別人隨便打這個網址就能清資料庫。
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await sql`
      delete from groups
      where status = 'closed' and closed_at < now() - interval '5 days'
      returning id
    `;
    return NextResponse.json({ deletedCount: deleted.length });
  } catch (e) {
    console.error("cleanup-old-groups 失敗：", e);
    return NextResponse.json({ error: e.message || "清除失敗" }, { status: 500 });
  }
}
