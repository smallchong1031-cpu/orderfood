import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapMenu, mapMenuSummary } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function GET() {
  return withErrorHandling(async () => {
    const rows = await sql`select id, store_name, items, created_at from menus order by created_at desc`;
    return NextResponse.json(rows.map(mapMenuSummary));
  });
}

export async function POST(request) {
  return withErrorHandling(async () => {
    const body = await request.json();
    const storeName = (body.storeName || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const image = body.image || null;
    if (!storeName || items.length === 0) {
      return jsonError("店名與品項不可為空", 400);
    }
    const rows = await sql`
      insert into menus (store_name, items, image)
      values (${storeName}, ${JSON.stringify(items)}::jsonb, ${image})
      returning *
    `;
    return NextResponse.json(mapMenu(rows[0]));
  });
}
