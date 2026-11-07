import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { DEFAULT_CLOSE_HOURS } from "@/lib/deadline";

// 取消結單：把已結單的團改回進行中，讓沒點到餐的人可以繼續點。
// 付款人與已標記的付款狀態都保留，之後再次結單時不用重新設定。
// 截止時間至少往後推 3 小時 —— 不然原本的截止時間早就過了，
// 下一次有人打開網站就會馬上又被自動結單。原本設得更晚（例如隔天早上）就維持原樣。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`
      update groups
      set status = 'open', closed_at = null,
          close_at = greatest(
            coalesce(close_at, now()),
            now() + make_interval(hours => ${DEFAULT_CLOSE_HOURS}::int)
          )
      where id = ${id} and status = 'closed'
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團，或這團目前不是已結單狀態", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
