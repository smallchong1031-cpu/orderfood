import { sql } from "@/lib/db";

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
  if (!token) return { sent: 0, reason: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN" };

  let targets = [];
  try {
    targets = await sql`select target_id from line_targets`;
  } catch (e) {
    return { sent: 0, reason: "讀取 LINE 群組清單失敗" };
  }
  if (targets.length === 0) return { sent: 0, reason: "還沒有記錄到任何 LINE 群組" };

  let sent = 0;
  for (const t of targets) {
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: t.target_id, messages }),
      });
      if (res.ok) sent += 1;
      else console.error("推送 LINE 失敗：", res.status, await res.text().catch(() => ""));
    } catch (e) {
      console.error("推送 LINE 發生錯誤：", e);
    }
  }
  return { sent };
}

// 把結單後的帳單整理成一段純文字，推到 LINE 群組。
// 用文字而不是圖片：伺服器端畫中文圖片需要額外載入字型檔，在 Vercel 上又慢又容易壞，
// 文字版在 LINE 裡一樣清楚，而且可以直接複製。
function formatItemDetails(item) {
  const parts = [];
  (item.options || []).forEach((o) => {
    if (o.choice) parts.push(o.choice);
  });
  if (item.note) parts.push(item.note);
  return parts.length ? `（${parts.join("、")}）` : "";
}

export function buildBillText(group) {
  const entries = Object.entries(group.memberOrders || {}).filter(([, o]) => o && !o.skipped);
  const skipped = Object.entries(group.memberOrders || {}).filter(([, o]) => o && o.skipped).map(([p]) => p);
  const extraCharges = Array.isArray(group.extraCharges) ? group.extraCharges : [];
  const extraTotal = extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const money = (n) => `NT$${Math.round(n).toLocaleString("zh-TW")}`;
  const personExtra = (person) => {
    let e = 0;
    extraCharges.forEach((c) => {
      if (c.appliesTo === "all") e += (Number(c.amount) || 0) / (entries.length || 1);
      else if (c.appliesTo === person) e += Number(c.amount) || 0;
    });
    return e;
  };

  const lines = [`🍱 ${group.groupName}（已結單）`, ""];
  entries.forEach(([person, order]) => {
    lines.push(`${person}　${money((Number(order.total) || 0) + personExtra(person))}`);
    (order.items || []).forEach((it) => {
      lines.push(`　・${it.name}×${it.qty}${formatItemDetails(it)}`);
    });
    lines.push("");
  });
  if (extraCharges.length) {
    extraCharges.forEach((c) => {
      const who = c.appliesTo === "all" ? "平均分攤" : c.appliesTo;
      lines.push(`${c.label}（${who}）　${c.amount < 0 ? "-" : ""}${money(Math.abs(c.amount))}`);
    });
    lines.push("");
  }
  const grand = entries.reduce((s, [, o]) => s + (Number(o.total) || 0), 0) + extraTotal;
  lines.push(`總計　${money(grand)}`);
  lines.push(`付款人：${group.payerName || group.creatorName}`);
  if (skipped.length) lines.push(`不用餐：${skipped.join("、")}`);
  return lines.join("\n");
}
