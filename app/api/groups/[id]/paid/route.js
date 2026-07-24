import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { person } = await request.json();
    if (!person) return jsonError("缺少 person", 400);

    const rows = await sql`
      update groups
      set paid_status = case
        when paid_status ? ${person} then paid_status - ${person}
        else jsonb_set(paid_status, array[${person}]::text[], 'true'::jsonb, true)
      end
      where id = ${id}
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
