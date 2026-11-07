import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { MAX_CLOSE_DAYS } from "@/lib/deadline";

// 修改這團的自動結單時間。
// 典型用法：晚上先開「明天早餐」的團，把截止時間改到隔天早上，
// 不然預設的 3 小時一到就被自動結單，大家沒辦法點。
// 跟結單一樣，所有人都可以改。
export async function PUT(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const closeAt = new Date(body.closeAt);
    if (!body.closeAt || Number.isNaN(closeAt.getTime())) {
      return jsonError("截止時間格式不對", 400);
    }

    // 留一分鐘緩衝：選了「現在」以前的時間，下一次檢查就會直接結單，等於按錯
    const now = Date.now();
    if (closeAt.getTime() < now + 60 * 1000) {
      return jsonError("截止時間要選在現在之後", 400);
    }
    if (closeAt.getTime() > now + MAX_CLOSE_DAYS * 24 * 60 * 60 * 1000) {
      return jsonError(`截止時間最多只能設到 ${MAX_CLOSE_DAYS} 天後`, 400);
    }

    const rows = await sql`
      update groups
      set close_at = ${closeAt.toISOString()}
      where id = ${id} and status = 'open'
      returning *
    `;
    if (rows.length === 0) return jsonError("找不到這團，或這團已經結單了", 404);
    return NextResponse.json(mapGroup(rows[0]));
  });
}
