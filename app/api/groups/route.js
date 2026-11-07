import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup, mapGroupSummary } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { DEFAULT_CLOSE_HOURS } from "@/lib/deadline";

export async function GET() {
  return withErrorHandling(async () => {
    const rows = await sql`
      select id, store_name, group_name, creator_name, payer_name, status, cancel_reason, created_at, close_at
      from groups
      order by created_at desc
    `;
    return NextResponse.json(rows.map(mapGroupSummary));
  });
}

export async function POST(request) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const { menuId, storeName, groupName, creatorName } = body;
    if (!storeName || !groupName || !creatorName) {
      return jsonError("缺少必要欄位", 400);
    }
    const rows = await sql`
      insert into groups (menu_id, store_name, group_name, creator_name, status, close_at)
      values (${menuId || null}, ${storeName}, ${groupName}, ${creatorName}, 'open',
              now() + make_interval(hours => ${DEFAULT_CLOSE_HOURS}::int))
      returning *
    `;
    return NextResponse.json(mapGroup(rows[0]));
  });
}
