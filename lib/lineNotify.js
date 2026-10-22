import { sql } from "@/lib/db";
// 帳單文字的格式統一放在 billText.js，前端分享到 LINE 時用的是同一份
export { buildBillText, buildCompactBillText, toLineLink } from "@/lib/billText";

export function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

// 推訊息到所有記錄過的 LINE 群組。機器人被邀請進群組後，
// 只要群組裡有人跟它講過一句話，群組 ID 就會被記下來。
export async function pushToLineTargets(messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return { sent: 0, total: 0, reason: "伺服器沒有設定 LINE 金鑰（LINE_CHANNEL_ACCESS_TOKEN）" };
  }

  let targets = [];
  try {
    targets = await sql`select target_id from line_targets`;
  } catch (e) {
    console.error("讀取 LINE 群組清單失敗：", e);
    return { sent: 0, total: 0, reason: "讀取 LINE 群組清單失敗" };
  }
  if (targets.length === 0) {
    return {
      sent: 0,
      total: 0,
      reason: "還沒有記錄到任何 LINE 群組。請在群組裡跟機器人講一句話（例如打店名），它才知道要傳到哪裡。",
    };
  }

  let sent = 0;
  const failures = [];
  for (const t of targets) {
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: t.target_id, messages }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        const body = await res.text().catch(() => "");
        console.error("推送 LINE 失敗：", res.status, body);
        failures.push({ status: res.status, body: body.slice(0, 300) });
      }
    } catch (e) {
      console.error("推送 LINE 發生錯誤：", e);
      failures.push({ status: 0, body: String(e?.message || e).slice(0, 300) });
    }
  }

  // 把失敗原因翻成看得懂的話，不然使用者只會看到「沒傳出去」
  let reason = null;
  if (sent === 0 && failures.length > 0) {
    const f = failures[0];
    if (f.status === 401) reason = "LINE 金鑰無效或已失效（401），請在 Vercel 重新設定 LINE_CHANNEL_ACCESS_TOKEN 後 Redeploy。";
    else if (f.status === 403) reason = "LINE 拒絕推送（403）。常見原因是機器人已經不在那個群組裡，或方案不支援推播。";
    else if (f.status === 429) {
      // 推播是按「收到的人數」計費，推一次到 23 人的群組就扣 23 則，
      // 免費版一個月只有 200 則，所以很容易在月中就用完。
      reason = "本月 LINE 推播則數已經用完（429），帳單被 LINE 擋下來了。額度每月初重置；在那之前請用「分享帳單圖片」手動貼到群組。";
    }
    else if (f.status === 400) reason = `LINE 說訊息格式有問題（400）：${f.body}`;
    else reason = `LINE 回傳錯誤（${f.status || "連線失敗"}）：${f.body}`;
  }

  return { sent, total: targets.length, reason, failures };
}

// 讀付款人自己設定的收款方式，放進 LINE 帳單裡，
// 這樣大家在群組就能直接轉帳，不用再開網頁查。
export async function getPayerProfile(payerName) {
  if (!payerName) return null;
  try {
    const rows = await sql`select contact, line_url from payment_profiles where name = ${payerName}`;
    if (rows.length === 0) return null;
    return { contact: rows[0].contact || null, lineUrl: rows[0].line_url || null };
  } catch (e) {
    return null;
  }
}

// 使用者可能填完整網址，也可能只填 LINE ID，統一轉成可以點的連結

// 把結單後的帳單整理成一段純文字，推到 LINE 群組。
// 用文字而不是圖片：伺服器端畫中文圖片需要額外載入字型檔，在 Vercel 上又慢又容易壞，
// 文字版在 LINE 裡一樣清楚，而且可以直接複製。

