import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 額外費用：{ id, label, amount, appliesTo }
// appliesTo 是 "all"（平均分攤給所有點餐的人）或某個人的名字（算在那個人頭上，例如那個人的品項單獨漲價）。
export async function PUT(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    const list = Array.isArray(body.extraCharges) ? body.extraCharges : [];
    const clean = list
      .map((c) => ({
        id: c.id,
        label: (c.label || "").trim(),
        amount: Number(c.amount) || 0,
        appliesTo: c.appliesTo || "all",
      }))
      .filter((c) => c.label && c.amount !== 0);

    const rows = await sql`
      update groups set extra_charges = ${JSON.stringify(clean)}::jsonb where id = ${id} returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
