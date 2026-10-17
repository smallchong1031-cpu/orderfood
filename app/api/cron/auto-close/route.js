import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { pushToLineTargets, buildBillText, getBaseUrl } from "@/lib/lineNotify";

const AUTO_CLOSE_HOURS = 3;

// 把開超過 3 小時還沒結單的團自動結單，並把帳單推到 LINE 群組。
// 付款人先預設為發起人，之後在收據上隨時可以改。
// 這支可以被兩種方式觸發：
//  1. 外部排程（GitHub Actions）帶 Authorization: Bearer <CRON_SECRET>
//  2. 網站自己在有人開頁面時順手呼叫（帶 ?self=1，不需要密碼，只做必要的事）
async function runAutoClose() {
  const due = await sql`
    select * from groups
    where status = 'open' and created_at < now() - (${AUTO_CLOSE_HOURS} || ' hours')::interval
    order by created_at asc
    limit 20
  `;
  if (due.length === 0) return { closed: 0 };

  const baseUrl = getBaseUrl();
  let closed = 0;
  for (const row of due) {
    const updated = await sql`
      update groups
      set status = 'closed', closed_at = now(),
          payer_name = coalesce(payer_name, creator_name)
      where id = ${row.id} and status = 'open'
      returning *
    `;
    if (updated.length === 0) continue;
    closed += 1;

    const group = mapGroup(updated[0]);
    const hasOrders = Object.values(group.memberOrders || {}).some((o) => o && !o.skipped);
    if (!hasOrders) continue; // 沒人點餐就不用吵群組

    await pushToLineTargets([
      { type: "text", text: `⏰ 超過 ${AUTO_CLOSE_HOURS} 小時自動結單\n\n${buildBillText(group, baseUrl)}` },
    ]);
  }
  return { closed };
}

export async function GET(request) {
  const url = new URL(request.url);
  const isSelf = url.searchParams.get("self") === "1";
  const authHeader = request.headers.get("authorization");

  if (!isSelf && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAutoClose();
    return NextResponse.json(result);
  } catch (e) {
    console.error("auto-close 失敗：", e);
    return NextResponse.json({ error: e.message || "自動結單失敗" }, { status: 500 });
  }
}

export const POST = GET;
