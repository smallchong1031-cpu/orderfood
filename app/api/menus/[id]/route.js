import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapMenu } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function GET(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const rows = await sql`select * from menus where id = ${id}`;
    if (rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(mapMenu(rows[0]));
  });
}

export async function PUT(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json();
    const storeName = (body.storeName || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const image = body.image || null;
    if (!storeName || items.length === 0) {
      return jsonError("店名與品項不可為空", 400);
    }
    const rows = await sql`
      update menus
      set store_name = ${storeName}, items = ${JSON.stringify(items)}::jsonb, image = ${image}, updated_at = now()
      where id = ${id}
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這份菜單", 404);
    return NextResponse.json(mapMenu(rows[0]));
  });
}

export async function DELETE(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    await sql`delete from menus where id = ${id}`;
    return NextResponse.json({ ok: true });
  });
}
