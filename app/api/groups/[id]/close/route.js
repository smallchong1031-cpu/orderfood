import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

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
    return NextResponse.json(mapGroup(rows[0]));
  });
}
