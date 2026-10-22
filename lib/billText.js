// 帳單文字的唯一來源。
// 前端（分享到 LINE 的按鈕）和後端（機器人推播）都從這裡拿，
// 這樣兩邊的格式永遠一樣，不會改了一邊忘了另一邊。
// 這個檔案刻意不碰資料庫、不用任何只有伺服器才有的東西，前端才能直接 import。

export function toLineLink(raw) {
  const v = (raw || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://line.me/ti/p/~${v.replace(/^~/, "")}`;
}

export function formatItemDetails(item) {
  const parts = [];
  (item.options || []).forEach((o) => {
    if (o.choice) parts.push(o.choice);
  });
  if (item.note) parts.push(item.note);
  return parts.length ? `（${parts.join("、")}）` : "";
}

// 把帳單拆成可重組的幾塊，完整版和精簡版才不會各寫一份算錢的邏輯。
function billParts(group, payerProfile) {
  const all = Object.entries(group.memberOrders || {});
  const entries = all.filter(([, o]) => o && !o.skipped);
  const skipped = all.filter(([, o]) => o && o.skipped).map(([p]) => p);
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

  const grand = entries.reduce((s, [, o]) => s + (Number(o.total) || 0), 0) + extraTotal;
  const payer = group.payerName || group.creatorName;
  const lineLink = toLineLink(payerProfile?.lineUrl);

  return { entries, skipped, extraCharges, money, personExtra, grand, payer, lineLink };
}

function tail({ extraCharges, money, grand, payer, lineLink, skipped }) {
  const lines = [];
  if (extraCharges.length) {
    extraCharges.forEach((c) => {
      const who = c.appliesTo === "all" ? "平均分攤" : c.appliesTo;
      lines.push(`${c.label}（${who}）　${c.amount < 0 ? "-" : ""}${money(Math.abs(c.amount))}`);
    });
    lines.push("");
  }
  lines.push(`總計　${money(grand)}`);
  lines.push(lineLink ? `付款人：${payer} 👉 ${lineLink}` : `付款人：${payer}`);
  if (skipped.length) lines.push(`不用餐：${skipped.join("、")}`);
  return lines;
}

// 完整版：一人一行，金額後面直接接品項。
// 刻意不讓品項各自換行 —— 18 個人的話會變成近百行，在 LINE 群組等於洗版。
export function buildBillText(group, payerProfile) {
  const p = billParts(group, payerProfile);
  const lines = [`🍱 ${group.groupName}（已結單）`, ""];
  p.entries.forEach(([person, order]) => {
    const itemText = (order.items || [])
      .map((it) => `${it.name}×${it.qty}${formatItemDetails(it)}`)
      .join("、");
    const amount = p.money((Number(order.total) || 0) + p.personExtra(person));
    lines.push(itemText ? `${person}　${amount}　${itemText}` : `${person}　${amount}`);
  });
  lines.push("");
  return [...lines, ...tail(p)].join("\n");
}

// 精簡版：只留每個人的金額，品項改放明細網址。
// 人多的時候完整版塞進分享網址會太長，被 LINE 截斷反而更糟。
export function buildCompactBillText(group, payerProfile, baseUrl) {
  const p = billParts(group, payerProfile);
  const lines = [`🍱 ${group.groupName}（已結單）`, ""];
  p.entries.forEach(([person, order]) => {
    lines.push(`${person}　${p.money((Number(order.total) || 0) + p.personExtra(person))}`);
  });
  lines.push("");
  const out = [...lines, ...tail(p)];
  if (baseUrl) out.push(`明細：${baseUrl}/groups/${group.id}`);
  return out.join("\n");
}

// 中文字經過 percent encoding 會膨脹成 9 倍（一個字 3 bytes、每 byte 3 字元），
// 所以 1000 字的帳單會變成 7000 字的網址。太長有被 LINE 截斷的風險，
// 超過就改用精簡版。一般 5～10 人的團都還在完整版的範圍內。
export const SHARE_URL_LIMIT = 8000;

export function buildLineShareUrl(group, payerProfile, baseUrl) {
  const full = buildBillText(group, payerProfile);
  const fullUrl = `https://line.me/R/share?text=${encodeURIComponent(full)}`;
  if (fullUrl.length <= SHARE_URL_LIMIT) {
    return { url: fullUrl, text: full, compact: false };
  }
  const short = buildCompactBillText(group, payerProfile, baseUrl);
  return {
    url: `https://line.me/R/share?text=${encodeURIComponent(short)}`,
    text: short,
    compact: true,
  };
}
