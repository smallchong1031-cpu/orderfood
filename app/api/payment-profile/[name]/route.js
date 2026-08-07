import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapPaymentProfile } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

export async function GET(request, { params }) {
  return withErrorHandling(async () => {
    const { name } = await params;
    const rows = await sql`select * from payment_profiles where name = ${decodeURIComponent(name)}`;
    if (rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(mapPaymentProfile(rows[0]));
  });
}

export async function PUT(request, { params }) {
  return withErrorHandling(async () => {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const body = await request.json();
    const contact = body.contact ? String(body.contact).trim() || null : null;
    const lineUrl = body.lineUrl ? String(body.lineUrl).trim() || null : null;

    const rows = await sql`
      insert into payment_profiles (name, contact, line_url, updated_at)
      values (${decodedName}, ${contact}, ${lineUrl}, now())
      on conflict (name) do update
        set contact = excluded.contact, line_url = excluded.line_url, updated_at = now()
      returning *
    `;
    return NextResponse.json(mapPaymentProfile(rows[0]));
  });
}

export async function DELETE(request, { params }) {
  return withErrorHandling(async () => {
    const { name } = await params;
    await sql`delete from payment_profiles where name = ${decodeURIComponent(name)}`;
    return NextResponse.json({ ok: true });
  });
}
