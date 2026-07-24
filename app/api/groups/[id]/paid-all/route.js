import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 付款人一鍵確認「錢全部都收齊了」：把有點餐的每個人都標記為已付款。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`select * from groups where id = ${id}`;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    const group = mapGroup(rows[0]);

    const allPaid = {};
    Object.keys(group.memberOrders || {}).forEach((person) => {
      allPaid[person] = true;
    });

    const updated = await sql`
      update groups set paid_status = ${JSON.stringify(allPaid)}::jsonb where id = ${id} returning *
    `;
    return NextResponse.json(mapGroup(updated[0]));
  });
}
