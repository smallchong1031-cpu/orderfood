import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 取消整團（例如訂完才發現店家沒開）。不直接刪除，改成標記 cancelled，
// 這樣已經點過餐的人進來會看到「這團取消了」而不是整團神祕消失。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = (body.reason || "").trim() || null;

    const rows = await sql`
      update groups
      set status = 'cancelled', cancel_reason = ${reason}, closed_at = now()
      where id = ${id} and status <> 'cancelled'
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團，或這團已經取消過了", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
