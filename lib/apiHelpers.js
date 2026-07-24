import { NextResponse } from "next/server";

export function jsonError(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function withErrorHandling(handler) {
  try {
    return await handler();
  } catch (e) {
    console.error(e);
    return jsonError(e.message || "伺服器發生錯誤", 500);
  }
}
