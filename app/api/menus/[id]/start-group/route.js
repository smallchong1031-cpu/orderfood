import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 「加入或開團」：這是一鍵開團網址背後的邏輯。
// 規則（依序判斷）：
//  1. 這家店有進行中的團 → 直接加入，不開新團
//  2. 沒有進行中的、但有還沒被刪除的已結單團 → 導向那張收據，讓大家還能對帳
//     （不自動開新團，否則舊收據就沒人找得到了）
//  3. 都沒有 → 開新團
// 想在情況 2 之下明確開新的一團，前端會帶 force: true 過來。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const creatorName = (body.creatorName || "").trim();
    const force = body.force === true;
    if (!creatorName) return jsonError("缺少開團人名稱", 400);

    const menus = await sql`select id, store_name from menus where id = ${id}`;
    if (menus.length === 0) return jsonError("找不到這份菜單", 404);
    const menu = menus[0];

    if (!force) {
      const existing = await sql`
        select * from groups
        where menu_id = ${id} and status = 'open'
        order by created_at desc
        limit 1
      `;
      if (existing.length > 0) {
        return NextResponse.json({ group: mapGroup(existing[0]), mode: "joined" });
      }

      const recentClosed = await sql`
        select * from groups
        where menu_id = ${id} and status = 'closed'
        order by closed_at desc nulls last
        limit 1
      `;
      if (recentClosed.length > 0) {
        return NextResponse.json({ group: mapGroup(recentClosed[0]), mode: "closed" });
      }
    }

    const created = await sql`
      insert into groups (menu_id, store_name, group_name, creator_name, status)
      values (${id}, ${menu.store_name}, ${`${menu.store_name} 揪團`}, ${creatorName}, 'open')
      returning *
    `;
    return NextResponse.json({ group: mapGroup(created[0]), mode: "created" });
  });
}
