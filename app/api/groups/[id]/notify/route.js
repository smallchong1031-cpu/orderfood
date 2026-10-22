import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { mapGroup } from "@/lib/mappers";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";
import { pushToLineTargets, buildBillText, buildCompactBillText, getPayerProfile, getBaseUrl } from "@/lib/lineNotify";

async function loadBillGroup(id) {
  const rows = await sql`select * from groups where id = ${id}`;
  if (rows.length === 0) return { error: jsonError("找不到這團", 404) };

  const group = mapGroup(rows[0]);
  if (group.status !== "closed") return { error: jsonError("這團還沒結單，先結單才有帳單可以傳", 400) };

  const hasOrders = Object.values(group.memberOrders || {}).some((o) => o && !o.skipped);
  if (!hasOrders) return { error: jsonError("這團沒有人點餐，沒有帳單可以傳", 400) };

  return { group };
}

// 回傳帳單的純文字，給結單的人自己複製貼到 LINE 群組。
// 這是現在的主要做法 —— LINE 的推播是「按收到的人數」計費（23 人的群組推一次扣 23 則，
// 免費版一個月只有 200 則），但人自己貼訊息完全免費。
export async function GET(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { group, error } = await loadBillGroup(id);
    if (error) return error;

    const payerProfile = await getPayerProfile(group.payerName || group.creatorName);
    return NextResponse.json({
      text: buildBillText(group, payerProfile),
      // 人多的時候完整帳單塞進 LINE 的分享網址會太長，前端會自動改用這個版本
      compactText: buildCompactBillText(group, payerProfile, getBaseUrl()),
      // 機器人推播預設關掉，只有自己設了 LINE_AUTO_PUSH=1 才會出現推播按鈕
      pushEnabled: process.env.LINE_AUTO_PUSH === "1",
    });
  });
}

// 用機器人把帳單推到 LINE 群組。會吃推播額度，所以只在有人主動按的時候才做。
export async function POST(request, { params }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const { group, error } = await loadBillGroup(id);
    if (error) return error;

    const payerProfile = await getPayerProfile(group.payerName || group.creatorName);
    const result = await pushToLineTargets([
      { type: "text", text: buildBillText(group, payerProfile) },
    ]);

    return NextResponse.json(result);
  });
}
