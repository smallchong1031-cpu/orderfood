import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { person, order } = await request.json();
    if (!person) return jsonError("缺少 person", 400);

    const rows = order
      ? await sql`
          update groups
          set member_orders = jsonb_set(member_orders, array[${person}]::text[], ${JSON.stringify(order)}::jsonb, true)
          where id = ${id}
          returning *
        `
      : await sql`
          update groups
          set member_orders = member_orders - ${person}
          where id = ${id}
          returning *
        `;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
