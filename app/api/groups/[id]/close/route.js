import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { pushToLineTargets, buildBillText, getPayerProfile } from "@/lib/lineNotify";

export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { payerName } = await request.json();
    if (!payerName || !payerName.trim()) return jsonError("缺少付款人", 400);

    const rows = await sql`
      update groups
      set status = 'closed', closed_at = now(), payer_name = ${payerName.trim()}
      where id = ${id} and status = 'open'
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團，或這團已經結單過了", 404);

    const group = mapGroup(rows[0]);

    // 把帳單推到 LINE 群組。推播失敗不影響結單本身，所以包起來不讓它往外丟，
    // 但結果要回傳給前端 —— 以前失敗是完全無聲的，結單的人根本不知道訊息沒出去。
    const hasOrders = Object.values(group.memberOrders || {}).some((o) => o && !o.skipped);
    let lineNotify = { sent: 0, total: 0, reason: "這團沒有人點餐，所以沒有傳帳單" };

    // 機器人推播預設關閉：LINE 是按「收到的人數」計費，23 人的群組推一次就扣 23 則，
    // 免費版一個月只有 200 則，大概 8 張帳單就用完了。
    // 改成由結單的人自己把帳單貼到群組（人貼訊息不計費）。
    // 以後升級付費方案的話，在 Vercel 設 LINE_AUTO_PUSH=1 就會恢復自動推播。
    if (hasOrders && process.env.LINE_AUTO_PUSH !== "1") {
      lineNotify = { sent: 0, total: 0, skipped: true, reason: null };
    } else if (hasOrders) {
      try {
        const payerProfile = await getPayerProfile(group.payerName || group.creatorName);
        lineNotify = await pushToLineTargets([{ type: "text", text: buildBillText(group, payerProfile) }]);
      } catch (e) {
        console.error("結單推送 LINE 失敗：", e);
        lineNotify = { sent: 0, total: 0, reason: `傳送時發生錯誤：${e?.message || e}` };
      }
    }

    return NextResponse.json({ ...group, lineNotify });
  });
}
