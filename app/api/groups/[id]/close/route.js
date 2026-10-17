import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { pushToLineTargets, buildBillText } from "@/lib/lineNotify";

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

    // 把帳單推到 LINE 群組。推播失敗不影響結單本身，所以包起來不讓它往外丟。
    const hasOrders = Object.values(group.memberOrders || {}).some((o) => o && !o.skipped);
    if (hasOrders) {
      try {
        await pushToLineTargets([{ type: "text", text: buildBillText(group) }]);
      } catch (e) {
        console.error("結單推送 LINE 失敗：", e);
      }
    }

    return NextResponse.json(group);
  });
}
