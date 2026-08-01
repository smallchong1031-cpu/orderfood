import { NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "@/lib/db";

// LINE 官方帳號的 webhook：
// 有人在聊天室打店名（例如「克里姆」），機器人就回覆那家店的一鍵開團網址。

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

// 用 channel secret 對「原始的」request body 算 HMAC-SHA256，確認這個請求真的來自 LINE
function verifySignature(rawBody, signature, channelSecret) {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function replyToLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
  } catch (e) {
    console.error("回覆 LINE 失敗：", e);
  }
}

async function buildReplyText(userText) {
  const baseUrl = getBaseUrl();
  const keyword = userText.trim();
  if (!keyword) return null;

  // 「菜單」「店家」「list」等關鍵字 → 列出所有店家
  if (["菜單", "店家", "list", "清單", "有哪些"].includes(keyword)) {
    const all = await sql`select id, store_name from menus order by created_at desc limit 20`;
    if (all.length === 0) return "目前還沒有任何菜單，請先到網站上傳菜單。";
    const lines = all.map((m) => `・${m.store_name}\n${baseUrl}/menus/${m.id}/start`);
    return `目前有這些店家，點網址就能開團／加入：\n\n${lines.join("\n\n")}`;
  }

  const matches = await sql`
    select id, store_name from menus
    where store_name ilike ${"%" + keyword + "%"}
    order by created_at desc
    limit 5
  `;

  if (matches.length === 0) return null; // 找不到就安靜不回，避免在群組裡洗版
  if (matches.length === 1) {
    const m = matches[0];
    return `${m.store_name}\n點這個網址就能開團／加入一起點餐：\n${baseUrl}/menus/${m.id}/start`;
  }
  const lines = matches.map((m) => `・${m.store_name}\n${baseUrl}/menus/${m.id}/start`);
  return `找到這幾家，選一家點進去：\n\n${lines.join("\n\n")}`;
}

export async function POST(request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  // 一定要拿「還沒被解析過」的原始字串來驗簽章，先 JSON.parse 過會對不上
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!channelSecret || !verifySignature(rawBody, signature, channelSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return NextResponse.json({ ok: true });
  }

  const events = payload.events || [];
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    try {
      const text = await buildReplyText(event.message.text);
      if (text) await replyToLine(event.replyToken, text);
    } catch (e) {
      console.error("處理 LINE 訊息失敗：", e);
    }
  }

  // LINE 規定：不管有沒有處理成功，都要盡快回 200
  return NextResponse.json({ ok: true });
}
