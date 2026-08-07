import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 取消結單：把已結單的團改回進行中，讓沒點到餐的人可以繼續點。
// 付款人與已標記的付款狀態都保留，之後再次結單時不用重新設定。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`
      update groups
      set status = 'open', closed_at = null
      where id = ${id} and status = 'closed'
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團，或這團目前不是已結單狀態", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
