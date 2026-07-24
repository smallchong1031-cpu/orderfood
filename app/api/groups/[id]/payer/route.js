import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function PUT(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { payerName } = await request.json();
    if (!payerName || !payerName.trim()) return jsonError("缺少付款人", 400);

    const rows = await sql`
      update groups set payer_name = ${payerName.trim()} where id = ${id} returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
