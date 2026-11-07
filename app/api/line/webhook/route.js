import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { sql } from "@/lib/db";

// LINE 官方帳號的 webhook，同時服務兩個機器人：
//
// 1. 菜單圖書館（LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）
//    有人打店名（例如「克里姆」）就回覆一鍵開團網址。結單帳單也是用這組推送。
//
// 2. 大豐小幫手（TASK_LINE_CHANNEL_SECRET / TASK_LINE_CHANNEL_ACCESS_TOKEN）
//    一樣會回店名；其餘訊息轉給交辦小幫手（Google Apps Script，TASK_BOT_WEBHOOK_URL）
//    判斷是不是交辦事項。
//
// 用 X-Line-Signature 判斷是哪個機器人送來的。
// 之後全面改用大豐小幫手時，把 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN
// 也改成大豐小幫手的值即可，帳單就會改由大豐小幫手推送。

// 回應 LINE 後才轉送，避免 LINE 等太久而重送事件
export const maxDuration = 30;

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

// 已設定的機器人。大豐小幫手排前面：兩組設成一樣時，以大豐小幫手的行為（會轉送）為準。
function getChannels() {
  const list = [];
  if (process.env.TASK_LINE_CHANNEL_SECRET) {
    list.push({
      name: "大豐小幫手",
      secret: process.env.TASK_LINE_CHANNEL_SECRET,
      token: process.env.TASK_LINE_CHANNEL_ACCESS_TOKEN,
      forward: true,
    });
  }
  if (process.env.LINE_CHANNEL_SECRET) {
    list.push({
      name: "菜單圖書館",
      secret: process.env.LINE_CHANNEL_SECRET,
      token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      forward: false,
    });
  }
  return list;
}

// 用 channel secret 對「原始的」request body 算 HMAC-SHA256，確認這個請求真的來自 LINE
function verifySignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function replyToLine(token, replyToken, text) {
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

// 把這裡沒有回覆的事件原封不動轉給交辦小幫手。
// 一則訊息的 replyToken 只能用一次，所以只轉「這裡沒有回覆過」的事件。
async function forwardToTaskBot(events) {
  const url = process.env.TASK_BOT_WEBHOOK_URL;
  if (!url || events.length === 0) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("轉送交辦小幫手失敗：", res.status, body.slice(0, 300));
    }
  } catch (e) {
    console.error("轉送交辦小幫手發生錯誤：", e);
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

  if (matches.length === 0) return null; // 找不到就安靜不回（大豐小幫手會改交給交辦小幫手判斷）
  if (matches.length === 1) {
    const m = matches[0];
    return `${m.store_name}\n點這個網址就能開團／加入一起點餐：\n${baseUrl}/menus/${m.id}/start`;
  }
  const lines = matches.map((m) => `・${m.store_name}\n${baseUrl}/menus/${m.id}/start`);
  return `找到這幾家，選一家點進去：\n\n${lines.join("\n\n")}`;
}

export async function POST(request) {
  // 一定要拿「還沒被解析過」的原始字串來驗簽章，先 JSON.parse 過會對不上
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  const channel = getChannels().find((c) => verifySignature(rawBody, signature, c.secret));
  if (!channel) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return NextResponse.json({ ok: true });
  }

  // 只有負責推帳單的那個機器人，才記錄它所在的群組
  const recordTargets = channel.token && channel.token === process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const events = payload.events || [];
  const unhandled = []; // 這裡沒回覆的事件，等一下轉給交辦小幫手

  for (const event of events) {
    // 記住這個群組／聊天室，自動結單時才知道要把帳單推到哪裡
    if (recordTargets) {
      try {
        const src = event.source || {};
        const targetId = src.groupId || src.roomId || null;
        if (targetId) {
          await sql`
            insert into line_targets (target_id, target_type, updated_at)
            values (${targetId}, ${src.groupId ? "group" : "room"}, now())
            on conflict (target_id) do update set updated_at = now()
          `;
        }
      } catch (e) {
        console.error("記錄 LINE 群組失敗：", e);
      }
    }

    // 非文字訊息（圖片、檔案、加入群組等）一律交給交辦小幫手
    if (event.type !== "message" || event.message?.type !== "text") {
      unhandled.push(event);
      continue;
    }
    try {
      const text = await buildReplyText(event.message.text);
      if (text) await replyToLine(channel.token, event.replyToken, text);
      else unhandled.push(event); // 不是店名 → 可能是交辦
    } catch (e) {
      console.error("處理 LINE 訊息失敗：", e);
      unhandled.push(event);
    }
  }

  // 只有大豐小幫手的事件要轉送；轉送排在回應之後才跑，先讓 LINE 收到 200
  if (channel.forward) after(() => forwardToTaskBot(unhandled));

  // LINE 規定：不管有沒有處理成功，都要盡快回 200
  return NextResponse.json({ ok: true });
}
