import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function GET(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`select * from groups where id = ${id}`;
    if (rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(mapGroup(rows[0]));
  });
}

export async function DELETE(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`select * from groups where id = ${id}`;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    const group = mapGroup(rows[0]);

    if (group.status !== "closed") {
      return jsonError("這團還沒結單，不能刪除", 400);
    }
    const people = Object.keys(group.memberOrders || {});
    const allPaid = people.length === 0 || people.every((p) => group.paidStatus?.[p]);
    if (!allPaid) {
      return jsonError("還有人尚未標記付款，不能刪除", 400);
    }

    await sql`delete from groups where id = ${id}`;
    return NextResponse.json({ ok: true });
  });
}
