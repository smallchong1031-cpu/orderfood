import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 「加入或開團」：這是一鍵開團網址背後的邏輯。
// 重點是「同一家店同時只會有一個進行中的團」，這樣同一條網址發到 LINE 群組後，
// 第一個點的人會開團，後面點的人是加入同一團，而不是每個人各自開一團。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const creatorName = (body.creatorName || "").trim();
    if (!creatorName) return jsonError("缺少開團人名稱", 400);

    const menus = await sql`select id, store_name from menus where id = ${id}`;
    if (menus.length === 0) return jsonError("找不到這份菜單", 404);
    const menu = menus[0];

    // 先找這家店有沒有還在進行中的團，有的話直接沿用
    const existing = await sql`
      select * from groups
      where menu_id = ${id} and status = 'open'
      order by created_at desc
      limit 1
    `;
    if (existing.length > 0) {
      return NextResponse.json({ group: mapGroup(existing[0]), joined: true });
    }

    const created = await sql`
      insert into groups (menu_id, store_name, group_name, creator_name, status)
      values (${id}, ${menu.store_name}, ${`${menu.store_name} 揪團`}, ${creatorName}, 'open')
      returning *
    `;
    return NextResponse.json({ group: mapGroup(created[0]), joined: false });
  });
}
