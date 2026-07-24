import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup, mapGroupSummary } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function GET() {
  return withErrorHandling(async () => {
    const rows = await sql`
      select id, store_name, group_name, creator_name, payer_name, status, created_at
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
      insert into groups (menu_id, store_name, group_name, creator_name, status)
      values (${menuId || null}, ${storeName}, ${groupName}, ${creatorName}, 'open')
      returning *
    `;
    return NextResponse.json(mapGroup(rows[0]));
  });
}
