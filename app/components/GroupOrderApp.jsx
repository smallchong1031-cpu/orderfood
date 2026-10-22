"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Minus, ChevronLeft, ChevronDown, Loader2, Users, Receipt,
  Check, Store, RefreshCw, Eye, EyeOff, AlertCircle, Sparkles,
  UserRound, Lock, ImagePlus, Trash2, PencilLine, Wallet, MessageCircle,
  Circle, CheckCircle2, Share2, Upload, Phone, GripVertical, ListChecks, XCircle, UserX, Ban,
} from "lucide-react";
import { api } from "./api";
import { getMyName, setMyName } from "./identity";

/* ============================== helpers ============================== */

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const currency = (n) => `NT$ ${Number(n || 0).toLocaleString("zh-TW")}`;

// 依照品項的 category 欄位分組，保留每個分類第一次出現的順序。
// 舊資料沒有 category 欄位時，全部歸在同一組「其他」，且不會多顯示一個沒意義的標題。
function groupItemsByCategory(items) {
  const order = [];
  const map = new Map();
  for (const it of items) {
    const cat = (it.category || "").trim() || "其他";
    if (!map.has(cat)) {
      map.set(cat, []);
      order.push(cat);
    }
    map.get(cat).push(it);
  }
  return order.map((category) => ({ category, items: map.get(category) }));
}

// 依店家分類（飲料店/早餐店...）把菜單庫的店家分組，保留第一次出現的順序。
function groupMenusByType(menus) {
  const order = [];
  const map = new Map();
  for (const m of menus) {
    const type = (m.storeType || "").trim() || "其他";
    if (!map.has(type)) {
      map.set(type, []);
      order.push(type);
    }
    map.get(type).push(m);
  }
  return order.map((type) => ({ type, menus: map.get(type) }));
}

const STORE_TYPE_PRESETS = ["飲料店", "早餐店", "便當店", "小吃店", "餐廳", "甜點"];

// 把訂購紀錄裡的必選項目（例如肉類：牛肉）跟備註組成一段括號文字，供列表/收據顯示。
function formatOrderItemDetails(orderItem) {
  const parts = [];
  (orderItem.options || []).forEach((o) => {
    if (o.choice) parts.push(o.choice);
  });
  if (orderItem.note) parts.push(orderItem.note);
  return parts.length ? `（${parts.join("、")}）` : "";
}

// 把 memberOrders 拆成「有點餐的」與「表明我不用的」兩組。
// 「我不用」在資料上是 { skipped: true, items: [], total: 0 }，
// 不算進分攤人數、不列入付款狀態，只是讓大家知道這個人已經表態過了。
function splitMembers(memberOrders) {
  const ordering = [];
  const skipped = [];
  Object.entries(memberOrders || {}).forEach(([person, o]) => {
    if (!o || typeof o !== "object") return;
    if (o.skipped) skipped.push(person);
    else ordering.push([person, o]);
  });
  return { ordering, skipped };
}

// 計算某人要多分攤多少額外費用（例如外送費平分，或某人品項單獨漲價）。
function computePersonExtra(person, extraCharges, peopleCount) {
  let extra = 0;
  (extraCharges || []).forEach((c) => {
    if (c.appliesTo === "all") {
      extra += (Number(c.amount) || 0) / (peopleCount || 1);
    } else if (c.appliesTo === person) {
      extra += Number(c.amount) || 0;
    }
  });
  return extra;
}

// 把所有人點的餐合併成一張「要跟店家點什麼」的清單。
// 同一品項的份數會加總，但備註／選項不同的會各自列一行 ——
// 店家需要知道三碗酸辣湯裡面有一碗要加辣，全部合在一起反而會點錯。
// menuItems 只是用來讓清單的順序跟菜單一樣，照著念比較順。
function aggregateOrderItems(members, menuItems) {
  const menuOrder = new Map();
  (menuItems || []).forEach((it, i) => menuOrder.set(it.id, i));

  const byItem = new Map();
  (members || []).forEach(([person, order]) => {
    (order?.items || []).forEach((it) => {
      const key = it.itemId || it.name;
      if (!byItem.has(key)) {
        byItem.set(key, {
          key,
          name: it.name,
          qty: 0,
          // 菜單上沒有的（例如菜單更新後被刪掉的品項）排到最後面
          seq: menuOrder.has(key) ? menuOrder.get(key) : 10000 + byItem.size,
          variants: new Map(),
        });
      }
      const entry = byItem.get(key);
      const qty = Number(it.qty) || 0;
      entry.qty += qty;
      const detail = formatOrderItemDetails(it).replace(/^（/, "").replace(/）$/, "");
      if (!entry.variants.has(detail)) entry.variants.set(detail, { detail, qty: 0, people: [] });
      const variant = entry.variants.get(detail);
      variant.qty += qty;
      if (!variant.people.includes(person)) variant.people.push(person);
    });
  });

  return Array.from(byItem.values())
    .map((e) => ({
      ...e,
      // 沒備註的排最前面，念給店家時「三碗酸辣湯，其中一碗加辣」比較順
      variants: Array.from(e.variants.values()).sort((a, b) => {
        if (!a.detail !== !b.detail) return a.detail ? 1 : -1;
        return b.qty - a.qty;
      }),
    }))
    .sort((a, b) => a.seq - b.seq);
}

// 彙整清單的純文字版，方便直接貼到 LINE 給店家或自己留著。
function buildSummaryText(storeName, rows) {
  const lines = [`${storeName} 訂單彙整`, ""];
  rows.forEach((r) => {
    lines.push(`${r.name} ×${r.qty}`);
    if (r.variants.length > 1 || r.variants[0]?.detail) {
      r.variants.forEach((v) => lines.push(`　・${v.detail || "不加備註"} ×${v.qty}`));
    }
  });
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  lines.push("", `共 ${rows.length} 種品項、${totalQty} 份`);
  return lines.join("\n");
}

// 「我這餐不用」的人要讓大家一眼看到。
// 標示太小的話，點餐的人會以為他還沒點，一直等他、或是多幫他點一份。
function SkipNotice({ names, className = "" }) {
  if (!names || names.length === 0) return null;
  return (
    <div
      className={`rounded-xl px-3 py-2.5 flex items-start gap-2 ${className}`}
      style={{ background: "var(--till-bg)", border: "1.5px solid var(--till)" }}
    >
      <UserX size={17} className="shrink-0 mt-0.5" style={{ color: "var(--till)" }} />
      <div className="min-w-0">
        <div className="text-sm font-black" style={{ color: "var(--till)" }}>
          這餐不用 ・ {names.length} 人
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {names.map((n) => (
            <span
              key={n}
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--card)", color: "var(--till)" }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// 複製文字到剪貼簿。LINE 內建瀏覽器有時候擋 clipboard API，所以留一條老路。
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

// 結單後把帳單文字交給結單的人，自己貼到 LINE 群組。
// 不用機器人推播，是因為 LINE 的推播按「收到的人數」計費 ——
// 23 人的群組推一張帳單就扣 23 則，免費版一個月只有 200 則，大概 8 張就沒了。
// 人自己在群組貼訊息完全免費，所以改成複製貼上。
function LineBillPanel({ group }) {
  const [bill, setBill] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [copyState, setCopyState] = useState("");
  const [pushResult, setPushResult] = useState(null);
  const [pushing, setPushing] = useState(false);
  // 在 effect 裡判斷，避免伺服器端算出 false、瀏覽器算出 true 造成 hydration 不一致
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  // 額外費用、付款人都可能在結單後才改，帳單文字要跟著重新產生
  const signature = JSON.stringify({
    m: group.memberOrders,
    e: group.extraCharges,
    p: group.payerName,
  });

  useEffect(() => {
    let alive = true;
    setLoadError("");
    (async () => {
      try {
        const data = await api.getBillText(group.id);
        if (alive) setBill(data);
      } catch (e) {
        if (alive) setLoadError(e.message || "讀取帳單失敗");
      }
    })();
    return () => { alive = false; };
  }, [group.id, signature]);

  const doCopy = async () => {
    const ok = await copyToClipboard(bill.text);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState(""), 2500);
  };

  const doShare = async () => {
    try {
      await navigator.share({ text: bill.text });
    } catch (e) {
      // 使用者自己取消分享也會走到這裡，不用特別報錯
    }
  };

  const doPush = async () => {
    setPushing(true);
    try {
      setPushResult(await api.notifyLine(group.id));
    } catch (e) {
      setPushResult({ sent: 0, reason: e.message || "推播失敗" });
    } finally {
      setPushing(false);
    }
  };

  // 中文經過 percent encoding 會膨脹成 9 倍（一個字 3 bytes、每 byte 3 字元），
  // 所以 1000 字的帳單會變成 7000 字的網址。太長有被 LINE 截斷的風險，
  // 超過就改用精簡版（每人金額＋明細網址）。5～10 人的團都還在完整版範圍內。
  const SHARE_LIMIT = 8000;
  const shareUrlFor = (t) => `https://line.me/R/share?text=${encodeURIComponent(t)}`;

  let shareUrl = null;
  let isCompact = false;
  if (bill) {
    const full = shareUrlFor(bill.text);
    if (full.length <= SHARE_LIMIT || !bill.compactText) {
      shareUrl = full;
    } else {
      shareUrl = shareUrlFor(bill.compactText);
      isCompact = true;
    }
  }

  return (
    <div className="goa-card p-4 flex flex-col gap-2.5">
      <div className="text-sm font-black flex items-center gap-1.5">
        <MessageCircle size={16} style={{ color: "#06C755" }} />
        把帳單傳到群組
      </div>

      {loadError ? (
        <div className="text-xs" style={{ color: "var(--stamp)" }}>{loadError}</div>
      ) : !bill ? (
        <div className="flex items-center gap-2 text-xs py-3" style={{ color: "var(--ink-soft)" }}>
          <Loader2 size={13} className="animate-spin" /> 產生帳單中…
        </div>
      ) : (
        <>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>
            按下去會跳出 LINE 的傳送畫面，帳單已經幫你填好了，選群組按傳送就好。
          </div>

          {/* 用 <a> 而不是 button：原生導向最可靠，在 LINE 內建瀏覽器裡也不會被擋 */}
          <a
            href={shareUrl}
            className="w-full rounded-xl py-3 text-base font-black flex items-center justify-center gap-2"
            style={{ background: "#06C755", color: "#FFFFFF", textDecoration: "none" }}
          >
            <MessageCircle size={18} />
            傳帳單到 LINE
          </a>

          {isCompact && (
            <div className="text-xs flex items-start gap-1" style={{ color: "var(--ink-soft)" }}>
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>這團人多，傳出去的是每個人的金額加一條明細網址 —— 完整品項太長會被 LINE 截掉。</span>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 text-xs pt-0.5">
            {canShare && (
              <button onClick={doShare} style={{ color: "var(--ink-soft)", textDecoration: "underline" }}>
                用手機內建分享
              </button>
            )}
            <button onClick={doCopy} style={{ color: "var(--ink-soft)", textDecoration: "underline" }}>
              {copyState === "copied" ? "已複製" : copyState === "failed" ? "複製失敗" : "電腦版請改用複製"}
            </button>
            {bill.pushEnabled && (
              <button onClick={doPush} disabled={pushing} style={{ color: "var(--ink-soft)", textDecoration: "underline" }}>
                {pushing ? "推播中…" : "用機器人推播"}
              </button>
            )}
          </div>

          {pushResult && (
            <div className="text-xs text-center" style={{ color: pushResult.sent > 0 ? "var(--till)" : "var(--stamp)" }}>
              {pushResult.sent > 0 ? "已推播到 LINE 群組" : pushResult.reason || "推播失敗"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 給打電話跟店家點餐的人看的清單：同樣的品項合併算好總份數，不用自己逐筆加。
function OrderSummaryCard({ storeName, members, menuItems }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const rows = aggregateOrderItems(members, menuItems);
  if (rows.length === 0) return null;
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildSummaryText(storeName, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // 複製失敗就算了，畫面上本來就看得到
    }
  };

  return (
    <div className="goa-card p-4">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full">
        <span className="text-sm font-black flex items-center gap-1.5">
          <ListChecks size={15} style={{ color: "var(--stamp)" }} />
          訂餐彙整
          <span className="text-xs font-normal" style={{ color: "var(--ink-soft)" }}>
            {rows.length} 種・{totalQty} 份
          </span>
        </span>
        <ChevronDown
          size={16}
          style={{ color: "var(--ink-soft)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        />
      </button>
      {open && (
        <>
          <div className="text-xs mt-1 mb-1" style={{ color: "var(--ink-soft)" }}>
            照這張跟店家點就好，份數已經幫你加總
          </div>
          {rows.map((r, i) => {
            // 只有一種做法又沒備註時就不用再列細項，上面那行已經講完了
            const showVariants = r.variants.length > 1 || !!r.variants[0]?.detail;
            return (
              <div key={r.key} className={`py-2 ${i > 0 ? "goa-divider" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold min-w-0">{r.name}</span>
                  <span className="goa-mono font-black text-base shrink-0" style={{ color: "var(--stamp)" }}>
                    ×{r.qty}
                  </span>
                </div>
                {showVariants && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {r.variants.map((v) => (
                      <div
                        key={v.detail || "_plain"}
                        className="flex items-baseline justify-between gap-2 text-xs"
                        style={{ color: "var(--ink-soft)" }}
                      >
                        <span className="min-w-0">
                          ・{v.detail || "不加備註"}
                          <span style={{ opacity: 0.75 }}>（{v.people.join("、")}）</span>
                        </span>
                        <span className="goa-mono font-bold shrink-0">×{v.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={copy}
            className="goa-btn-outline w-full rounded-xl py-2 text-sm font-bold mt-3 flex items-center justify-center gap-2"
          >
            {copied ? <Check size={14} /> : <ListChecks size={14} />}
            {copied ? "已複製清單" : "複製這張清單"}
          </button>
        </>
      )}
    </div>
  );
}

// 把結單後的帳單畫成一張圖，方便直接分享到 LINE。
// 分兩階段：先把每一列的內容整理成 rows，算出總高度，再實際畫上去。
function buildReceiptRows({ group, entries, extraCharges, grandTotal, payerName }) {
  const rows = [];
  rows.push({ type: "title", text: group.groupName });
  rows.push({ type: "sub", text: `${group.storeName}・共 ${entries.length} 人` });
  rows.push({ type: "payer", text: `請把錢轉給付款人：${payerName}` });
  rows.push({ type: "divider" });

  entries.forEach(([person, order]) => {
    const personExtra = computePersonExtra(person, extraCharges, entries.length);
    rows.push({ type: "person", text: person, amount: order.total + personExtra });
    (order.items || []).forEach((it) => {
      rows.push({
        type: "item",
        text: `${it.name} × ${it.qty}${formatOrderItemDetails(it)}`,
        amount: it.price * it.qty,
      });
    });
    if (personExtra !== 0) {
      rows.push({
        type: "item",
        text: personExtra < 0 ? "折扣分攤" : "額外費用分攤",
        amount: personExtra,
        accent: true,
      });
    }
  });

  if ((extraCharges || []).length > 0) {
    rows.push({ type: "divider" });
    rows.push({ type: "section", text: "額外費用與折扣" });
    extraCharges.forEach((c) => {
      rows.push({
        type: "item",
        text: `${c.label}${c.appliesTo === "all" ? "（平均分攤）" : `（${c.appliesTo}）`}`,
        amount: c.amount,
      });
    });
  }

  rows.push({ type: "divider" });
  rows.push({ type: "total", text: "總計", amount: grandTotal });
  return rows;
}

const ROW_HEIGHTS = { title: 38, sub: 26, payer: 36, divider: 18, person: 30, item: 22, section: 26, total: 42 };

function renderReceiptCanvas(rows) {
  const W = 460;
  const PAD = 24;
  const SCALE = 2;
  const FONT = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
  const MONO = '"JetBrains Mono", "Courier New", monospace';

  let height = PAD * 2;
  rows.forEach((r) => {
    height += ROW_HEIGHTS[r.type] || 22;
    if (r.type === "payer" && r.contact) height += 24;
  });

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = "#FFFDF8";
  ctx.fillRect(0, 0, W, height);

  const money = (n) => (n < 0 ? `- NT$ ${Math.round(Math.abs(n)).toLocaleString("zh-TW")}` : `NT$ ${Math.round(n).toLocaleString("zh-TW")}`);

  // 太長的文字截斷，避免跟右邊金額疊在一起
  const fit = (text, maxWidth) => {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  };

  let y = PAD;
  rows.forEach((r) => {
    const h = ROW_HEIGHTS[r.type] || 22;
    switch (r.type) {
      case "title":
        ctx.fillStyle = "#2B2620";
        ctx.font = `900 24px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(fit(r.text, W - PAD * 2 - 90), PAD, y + 24);
        ctx.fillStyle = "#C23B2E";
        ctx.font = `700 13px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText("已結單", W - PAD, y + 22);
        break;
      case "sub":
        ctx.fillStyle = "#82785F";
        ctx.font = `400 13px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(r.text, PAD, y + 16);
        break;
      case "payer": {
        const boxH = r.contact ? 54 : 32;
        ctx.fillStyle = "#E4ECE1";
        ctx.fillRect(PAD, y, W - PAD * 2, boxH);
        ctx.fillStyle = "#3F6B4A";
        ctx.font = `700 14px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(fit(r.text, W - PAD * 2 - 20), PAD + 10, y + 21);
        if (r.contact) {
          ctx.font = `400 12px ${MONO}`;
          ctx.fillText(fit(r.contact, W - PAD * 2 - 20), PAD + 10, y + 43);
        }
        break;
      }
      case "divider":
        ctx.strokeStyle = "#D5CBB4";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD, y + h / 2);
        ctx.lineTo(W - PAD, y + h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case "section":
        ctx.fillStyle = "#82785F";
        ctx.font = `700 12px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(r.text, PAD, y + 17);
        break;
      case "person":
        ctx.fillStyle = "#2B2620";
        ctx.font = `700 15px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(fit(r.text, W - PAD * 2 - 110), PAD, y + 20);
        ctx.font = `700 16px ${MONO}`;
        ctx.textAlign = "right";
        ctx.fillText(money(r.amount), W - PAD, y + 20);
        break;
      case "item":
        ctx.fillStyle = r.accent ? (r.amount < 0 ? "#3F6B4A" : "#C23B2E") : "#82785F";
        ctx.font = `400 12px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(fit(r.text, W - PAD * 2 - 100), PAD + 12, y + 15);
        ctx.font = `400 12px ${MONO}`;
        ctx.textAlign = "right";
        ctx.fillText(money(r.amount), W - PAD, y + 15);
        break;
      case "total":
        ctx.fillStyle = "#2B2620";
        ctx.font = `900 17px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(r.text, PAD, y + 26);
        ctx.fillStyle = "#C23B2E";
        ctx.font = `700 21px ${MONO}`;
        ctx.textAlign = "right";
        ctx.fillText(money(r.amount), W - PAD, y + 26);
        break;
      default:
        break;
    }
    y += h;
    if (r.type === "payer" && r.contact) y += 24;
  });

  return canvas;
}

// 由使用者按「分享帳單圖片」才會呼叫。整個流程包在 try 裡，
// 就算產圖失敗也只是顯示錯誤訊息，不會把整頁弄崩。
async function shareReceiptImage(params) {
  let file = null;
  try {
    const rows = buildReceiptRows(params);
    const canvas = renderReceiptCanvas(rows);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("產生圖片失敗");
    const fileName = `${params.group.storeName || "揪呷團"}-帳單.png`;
    file = new File([blob], fileName, { type: "image/png" });

    let canShareFile = false;
    try {
      canShareFile = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (e) {
      canShareFile = false;
    }

    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: params.group.groupName });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelled";
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  } catch (e) {
    throw e instanceof Error ? e : new Error("產生圖片失敗");
  }
}

// 使用者可能填完整網址，也可能只填 LINE ID，這裡統一轉成可以點的連結
function toLineLink(raw) {
  const v = (raw || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://line.me/ti/p/~${v.replace(/^~/, "")}`;
}

function resizeImageToBase64(file, maxDim = 1100) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("圖片格式無法讀取"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", previewUrl: dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ============================== small UI atoms ============================== */

function TopBar({ title, subtitle, onBack, right }) {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      {onBack ? (
        <button onClick={onBack} className="goa-stepper-btn rounded-full p-2 shrink-0" aria-label="返回">
          <ChevronLeft size={18} />
        </button>
      ) : (
        <div className="goa-logo goa-display">揪</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="goa-display font-bold text-lg leading-tight truncate">{title}</div>
        {subtitle ? <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

function StatusChip({ status }) {
  if (status === "cancelled") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full"
        style={{ background: "#EAE1CF", color: "var(--ink-soft)", border: "2px solid var(--line)" }}
      >
        <XCircle size={11} /> 已取消
      </span>
    );
  }
  const isOpen = status === "open";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-full"
      style={
        isOpen
          ? { background: "var(--till)", color: "#FFFFFF" }
          : { background: "transparent", color: "var(--stamp)", border: "2px solid var(--stamp)" }
      }
    >
      {isOpen ? <span className="goa-pulse-dot" /> : <Lock size={11} />}
      {isOpen ? "開團中" : "已結單"}
    </span>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-2" style={{ color: "var(--ink-soft)" }}>
      {icon}
      <div className="goa-display font-bold text-base" style={{ color: "var(--ink)" }}>{title}</div>
      <div className="text-sm">{hint}</div>
    </div>
  );
}

/* ============================== Name Gate ============================== */

function NameGate({ onDone }) {
  const [name, setName] = useState("");
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    onDone(trimmed);
  };
  return (
    <div className="goa-root flex items-center justify-center p-6" style={{ minHeight: "100vh" }}>
      <div className="goa-card goa-pop w-full p-7 flex flex-col items-center gap-4" style={{ maxWidth: 360 }}>
        <div className="goa-logo goa-display" style={{ width: 56, height: 56, fontSize: 24 }}>揪</div>
        <div className="text-center">
          <div className="goa-display font-black text-2xl">揪呷團</div>
          <div className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>上傳菜單・揪團點餐・一鍵結帳</div>
        </div>
        <div className="w-full mt-2">
          <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>你的稱呼（會顯示給團員看到）</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="例如：阿強"
            className="goa-input w-full rounded-xl px-3 py-2.5 mt-1"
            maxLength={12}
          />
        </div>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="goa-btn-primary w-full rounded-xl py-2.5 font-bold flex items-center justify-center gap-2"
        >
          進入揪呷團
        </button>
      </div>
    </div>
  );
}

/* ============================== Payment Profile ============================== */

function PaymentProfileEditor({ me, onBack }) {
  const [loading, setLoading] = useState(true);
  const [lineUrl, setLineUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await api.getPaymentProfile(me);
        if (!alive) return;
        setLineUrl(p?.lineUrl || "");
        setSavedAt(p?.updatedAt || null);
      } catch (e) {
        if (alive) setError(e.message || "讀取失敗");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [me]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await api.savePaymentProfile(me, { lineUrl: lineUrl.trim() || null });
      setSavedAt(updated.updatedAt);
    } catch (e) {
      setError(e.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const clearProfile = async () => {
    setSaving(true);
    setError("");
    try {
      await api.deletePaymentProfile(me);
      setLineUrl("");
      setSavedAt(null);
    } catch (e) {
      setError(e.message || "清除失敗");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} /></div>;
  }

  return (
    <div className="pb-10">
      <TopBar title="我的收款設定" subtitle={`身分：${me}`} onBack={onBack} />
      <div className="px-4 flex flex-col gap-4">
        <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "var(--till-bg)", color: "var(--till)" }}>
          <Wallet size={16} className="shrink-0 mt-0.5" />
          <span>設定好之後，只要你被指定為某一團的付款人，傳到 LINE 群組的帳單上就會附你的連結，大家點一下就能轉帳給你。</span>
        </div>

        <div className="goa-card p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>我的 LINE 連結或 LINE ID</label>
            <input
              value={lineUrl}
              onChange={(e) => setLineUrl(e.target.value)}
              className="goa-input w-full rounded-xl px-3 py-2 text-sm mt-1"
              placeholder="貼上 LINE 邀請連結，或直接填 LINE ID"
            />
            <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
              填了之後，你當付款人時大家點你的名字就能直接開你的 LINE 對話。取得方式：LINE →「加入好友」→「邀請」→ 分享網址。
            </div>
          </div>
          {error && <div className="text-xs" style={{ color: "var(--stamp-dark)" }}>{error}</div>}
          <button
            onClick={save}
            disabled={saving}
            className="goa-btn-primary rounded-xl py-2.5 font-bold flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            儲存我的收款資料
          </button>
          {savedAt && (
            <button onClick={clearProfile} disabled={saving} className="text-xs font-bold text-center" style={{ color: "var(--ink-soft)" }}>
              清除我的收款資料
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== Menu Library ============================== */

function MenuCard({ menu, onClick, isConfirming, deleting, onDeleteRequest, onConfirmDelete, onCancelDelete }) {
  return (
    <div className="goa-card goa-pop p-4 flex flex-col gap-2 w-full relative">
      <button onClick={onClick} className="text-left flex flex-col gap-2 w-full pr-5">
        <div className="flex items-center gap-2">
          <Store size={16} style={{ color: "var(--stamp)" }} />
          <span className="goa-display font-bold text-base truncate">{menu.storeName || "未命名店家"}</span>
        </div>
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{menu.itemCount} 項品項</div>
      </button>
      {!isConfirming ? (
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteRequest(); }}
          className="absolute top-3 right-3 p-1"
          style={{ color: "var(--ink-soft)" }}
          aria-label="刪除菜單"
        >
          <Trash2 size={14} />
        </button>
      ) : (
        <div className="flex gap-1.5">
          <button onClick={onCancelDelete} className="goa-btn-outline rounded-lg px-2 py-1.5 text-xs font-bold flex-1">取消</button>
          <button
            onClick={onConfirmDelete}
            disabled={deleting}
            className="goa-btn-primary rounded-lg px-2 py-1.5 text-xs font-bold flex-1 flex items-center justify-center gap-1"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            確定刪除
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLibrary({ onOpenMenu, onUpload, refreshKey }) {
  const [menus, setMenus] = useState(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.listMenus();
        if (alive) setMenus(list);
      } catch (e) {
        if (alive) setError(e.message || "讀取菜單失敗");
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const toggleType = (type) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const deleteMenu = async (menuId) => {
    setDeletingId(menuId);
    try {
      await api.deleteMenu(menuId);
      setMenus((prev) => prev.filter((m) => m.id !== menuId));
    } catch (e) {
      setError(e.message || "刪除失敗");
    } finally {
      setConfirmDeleteId(null);
      setDeletingId(null);
    }
  };

  return (
    <div className="px-4 pb-24">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>已上傳的店家菜單</div>
        <button onClick={onUpload} className="goa-btn-primary rounded-full px-3 py-1.5 text-sm font-bold flex items-center gap-1">
          <Plus size={15} /> 新增菜單
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 text-sm p-3 rounded-xl mb-3" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {menus === null ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} /></div>
      ) : menus.length === 0 ? (
        <EmptyState
          icon={<Store size={32} />}
          title="還沒有任何菜單"
          hint={"點右上角「新增菜單」，拍照上傳第一家店吧"}
        />
      ) : (
        (() => {
          const groups = groupMenusByType(menus);
          const showHeaders = groups.length > 1;
          return groups.map((group, gi) => {
            const isOpen = !showHeaders || expandedTypes.has(group.type);
            return (
              <div key={group.type} className={gi > 0 ? "mt-4" : ""}>
                {showHeaders && (
                  <button
                    onClick={() => toggleType(group.type)}
                    className="flex items-center justify-between w-full py-1.5 mb-2"
                  >
                    <span className="text-sm font-black flex items-center gap-1.5" style={{ color: "var(--stamp)" }}>
                      {group.type}
                      <span className="font-normal" style={{ color: "var(--ink-soft)" }}>（{group.menus.length}）</span>
                    </span>
                    <ChevronDown
                      size={16}
                      style={{ color: "var(--ink-soft)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
                    />
                  </button>
                )}
                {isOpen && (
                  <div className="grid grid-cols-2 gap-3">
                    {group.menus.map((m) => (
                      <MenuCard
                        key={m.id}
                        menu={m}
                        onClick={() => onOpenMenu(m.id)}
                        isConfirming={confirmDeleteId === m.id}
                        deleting={deletingId === m.id}
                        onDeleteRequest={() => setConfirmDeleteId(m.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onConfirmDelete={() => deleteMenu(m.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          });
        })()
      )}
    </div>
  );
}

/* ============================== Sortable item row (menu edit) ============================== */

function SortableItemRow({ item, updateItem, removeItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [showOptions, setShowOptions] = useState(false);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
    position: "relative",
    background: isDragging ? "var(--card)" : "transparent",
  };

  const optionGroups = item.optionGroups || [];

  const addOptionGroup = () => {
    updateItem(item.id, { optionGroups: [...optionGroups, { id: uid("og"), name: "", choices: [], choicesText: "" }] });
    setShowOptions(true);
  };
  const updateOptionGroup = (groupId, patch) => {
    updateItem(item.id, { optionGroups: optionGroups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) });
  };
  const removeOptionGroup = (groupId) => {
    updateItem(item.id, { optionGroups: optionGroups.filter((g) => g.id !== groupId) });
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <button
          {...attributes}
          {...listeners}
          className="p-1 shrink-0 touch-none"
          style={{ color: "var(--ink-soft)", cursor: "grab" }}
          aria-label="拖曳排序"
        >
          <GripVertical size={16} />
        </button>
        <input
          value={item.name}
          onChange={(e) => updateItem(item.id, { name: e.target.value })}
          placeholder="品項名稱"
          className="goa-input flex-1 rounded-lg px-2.5 py-2 text-sm"
        />
        <input
          value={item.price}
          onChange={(e) => updateItem(item.id, { price: e.target.value.replace(/[^0-9]/g, "") })}
          inputMode="numeric"
          placeholder="0"
          className="goa-input goa-mono rounded-lg px-2.5 py-2 text-sm text-right"
          style={{ width: 76 }}
        />
        <button onClick={() => removeItem(item.id)} className="p-1.5 shrink-0" style={{ color: "var(--ink-soft)" }}>
          <Trash2 size={15} />
        </button>
      </div>
      <input
        value={item.category || ""}
        onChange={(e) => updateItem(item.id, { category: e.target.value })}
        placeholder="分類（例如：漢堡類、飲料類，選填）"
        className="goa-input rounded-lg px-2.5 py-1 text-xs ml-6"
        style={{ color: "var(--ink-soft)", maxWidth: 220 }}
      />

      <button
        onClick={() => setShowOptions((v) => !v)}
        className="text-xs font-bold flex items-center gap-1 ml-6"
        style={{ color: optionGroups.length ? "var(--stamp)" : "var(--ink-soft)" }}
      >
        <ListChecks size={12} /> 必選項目{optionGroups.length ? `（${optionGroups.length}）` : ""}
      </button>

      {showOptions && (
        <div className="flex flex-col gap-2 ml-6 p-2 rounded-lg" style={{ background: "var(--paper)" }}>
          {optionGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <input
                  value={group.name}
                  onChange={(e) => updateOptionGroup(group.id, { name: e.target.value })}
                  placeholder="選項名稱（例如：選擇肉類）"
                  className="goa-input flex-1 rounded-lg px-2 py-1.5 text-xs"
                />
                <button onClick={() => removeOptionGroup(group.id)} className="p-1 shrink-0" style={{ color: "var(--ink-soft)" }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <input
                value={group.choicesText !== undefined ? group.choicesText : (group.choices || []).join("、")}
                onChange={(e) => updateOptionGroup(group.id, { choicesText: e.target.value })}
                placeholder="選項內容，用頓號分隔，例如：豬肉、牛肉、雞肉"
                className="goa-input rounded-lg px-2 py-1.5 text-xs"
              />
            </div>
          ))}
          <button onClick={addOptionGroup} className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--stamp)" }}>
            <Plus size={12} /> 新增必選項目
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================== Upload Flow ============================== */

function UploadMenuFlow({ onBack, onSaved, existingMenu }) {
  const isEditMode = !!existingMenu;
  const [preview, setPreview] = useState(existingMenu?.image || null);
  const [pending, setPending] = useState(null);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [storeName, setStoreName] = useState(existingMenu?.storeName || "");
  const [storePhone, setStorePhone] = useState(existingMenu?.storePhone || "");
  const [storeType, setStoreType] = useState(existingMenu?.storeType || "");
  const [items, setItems] = useState(existingMenu ? existingMenu.items.map((it) => ({ ...it })) : []);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const pickFile = async (f) => {
    if (!f) return;
    setError("");
    try {
      const { base64, mediaType, previewUrl } = await resizeImageToBase64(f);
      setPreview(previewUrl);
      setPending({ base64, mediaType });
    } catch (e) {
      setError(e.message || "圖片處理失敗");
    }
  };

  const runRecognition = async () => {
    if (!pending) return;
    setRecognizing(true);
    setError("");
    setWarning("");
    try {
      const result = await api.recognizeMenu({ base64: pending.base64, mediaType: pending.mediaType });
      setStoreName((prev) => result.storeName || prev);
      setStorePhone((prev) => result.storePhone || prev);
      setItems(
        (result.items || []).map((it) => ({
          id: uid("it"),
          name: it.name || "未命名品項",
          price: Number(it.price) || 0,
          category: it.category || "",
        }))
      );
      if (result.truncated) {
        setWarning(`這家店品項太多，AI 回應被截斷了，只抓到前面 ${result.items.length} 項。請對照原本的菜單照片，把後面沒抓到的品項手動加進去。`);
      }
    } catch (e) {
      setError("辨識失敗，可以重試，或手動輸入品項：" + (e.message || ""));
    } finally {
      setRecognizing(false);
    }
  };

  const updateItem = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));
  const addBlankItem = () => setItems((prev) => [...prev, { id: uid("it"), name: "", price: 0, category: "" }]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const canSave = storeName.trim() && items.length > 0 && items.every((it) => it.name.trim());

  const save = async () => {
    setSaving(true);
    setError("");
    const payload = {
      storeName: storeName.trim(),
      storePhone: storePhone.trim(),
      storeType: storeType.trim(),
      items: items.map((it) => ({
        id: it.id,
        name: it.name.trim(),
        price: Number(it.price) || 0,
        category: (it.category || "").trim(),
        optionGroups: (it.optionGroups || [])
          .map((g) => {
            const rawText = g.choicesText !== undefined ? g.choicesText : (g.choices || []).join("、");
            const choices = rawText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
            return { id: g.id, name: (g.name || "").trim(), choices };
          })
          .filter((g) => g.choices.length > 0),
      })),
      image: preview || existingMenu?.image || null,
    };
    try {
      const saved = existingMenu ? await api.updateMenu(existingMenu.id, payload) : await api.createMenu(payload);
      onSaved(saved.id);
    } catch (e) {
      setError(e.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-10">
      <TopBar
        title={isEditMode ? "更新菜單" : "新增菜單"}
        subtitle={isEditMode ? "可重新上傳照片辨識，或直接修改下方品項" : "拍照或上傳菜單照片，讓 AI 幫忙辨識"}
        onBack={onBack}
      />
      <div className="px-4 flex flex-col gap-4">
        {isEditMode && (
          <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "var(--till-bg)", color: "var(--till)" }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>儲存後會直接覆蓋原本的菜單，不會留下舊版本。</span>
          </div>
        )}
        {!preview ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="goa-card flex flex-col items-center justify-center gap-2 py-14"
            style={{ borderStyle: "dashed" }}
          >
            <ImagePlus size={28} style={{ color: "var(--stamp)" }} />
            <div className="font-bold text-sm">{isEditMode ? "點此重新上傳菜單照片" : "點此選擇菜單照片"}</div>
            <div className="text-xs" style={{ color: "var(--ink-soft)" }}>建議拍清楚品項與價格</div>
          </button>
        ) : (
          <div className="goa-card p-3 flex flex-col gap-3">
            <img src={preview} alt="菜單預覽" className="w-full rounded-xl object-cover" style={{ maxHeight: 260, objectFit: "contain" }} />
            {!pending && (
              <div className="text-xs" style={{ color: "var(--ink-soft)" }}>這是先前儲存的照片，如果要重新辨識，請先點「重新選擇照片」上傳一張新的。</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setPreview(null); setPending(null); setError(""); }}
                className="goa-btn-outline rounded-xl px-3 py-2 text-sm font-bold flex-1"
              >
                重新選擇照片
              </button>
              <button
                onClick={runRecognition}
                disabled={recognizing || !pending}
                className="goa-btn-primary rounded-xl px-3 py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
              >
                {recognizing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {recognizing ? "AI 辨識中…" : "AI 辨識菜單"}
              </button>
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />

        {error ? (
          <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        {warning ? (
          <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "#FBF0DC", color: "var(--gold)" }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        ) : null}

        {(items.length > 0 || storeName || isEditMode) && (
          <div className="goa-card p-4 flex flex-col gap-3 goa-pop">
            <div>
              <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>店名</label>
              <input
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="輸入店家名稱"
                className="goa-input w-full rounded-xl px-3 py-2 mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>店家電話（選填，打電話訂餐用）</label>
              <input
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                placeholder="例如：089-358538"
                className="goa-input w-full rounded-xl px-3 py-2 mt-1"
                inputMode="tel"
              />
            </div>
            <div>
              <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>店家分類（選填，方便菜單庫分類瀏覽）</label>
              <div className="mt-1">
                <ChipPicker options={STORE_TYPE_PRESETS} value={storeType} onChange={setStoreType} customPlaceholder="輸入分類名稱" />
              </div>
            </div>
            <div className="goa-divider pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>品項與金額（可修改）</span>
                <button onClick={addBlankItem} className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--stamp)" }}>
                  <Plus size={13} /> 新增品項
                </button>
              </div>
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-3">
                    {items.map((it) => (
                      <SortableItemRow key={it.id} item={it} updateItem={updateItem} removeItem={removeItem} />
                    ))}
                    {items.length === 0 && (
                      <div className="text-sm text-center py-4" style={{ color: "var(--ink-soft)" }}>尚無品項，請先辨識或手動新增</div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
            <button
              onClick={save}
              disabled={!canSave || saving}
              className="goa-btn-primary rounded-xl py-2.5 font-bold flex items-center justify-center gap-2 mt-1"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {isEditMode ? "儲存更新（覆蓋舊菜單）" : "儲存這份菜單"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== Menu Detail ============================== */

function MenuDetail({ menuId, onBack, onGroupCreated, onUpdateMenu }) {
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [expandedCats, setExpandedCats] = useState(() => new Set());
  const [shareStatus, setShareStatus] = useState("idle");
  const me = useRef(null);

  const doShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch (e) {
      setShareStatus("fallback");
    }
  };

  const toggleCat = (cat) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const doc = await api.getMenu(menuId);
        setMenu(doc);
        if (doc) setGroupName(`${doc.storeName} 揪團`);
      } catch (e) {
        setError(e.message || "讀取失敗");
      }
      me.current = getMyName();
    })();
  }, [menuId]);

  const createGroup = async () => {
    if (!menu) return;
    setCreating(true);
    setError("");
    try {
      const created = await api.createGroup({
        menuId: menu.id,
        storeName: menu.storeName,
        groupName: groupName.trim() || `${menu.storeName} 揪團`,
        creatorName: me.current || "發起人",
      });
      onGroupCreated(created.id);
    } catch (e) {
      setError(e.message || "開團失敗");
    } finally {
      setCreating(false);
    }
  };

  if (!menu) {
    return (
      <div className="pb-10">
        <TopBar title="菜單" onBack={onBack} />
        {error ? (
          <div className="px-4">
            <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} /></div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-24">
      <TopBar
        title={menu.storeName}
        subtitle={`共 ${menu.items.length} 項品項`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-2">
            {shareStatus === "copied" && (
              <span className="text-xs font-bold" style={{ color: "var(--till)" }}>已複製</span>
            )}
            <button onClick={doShare} className="p-2" style={{ color: "var(--ink-soft)" }} aria-label="分享菜單">
              <Share2 size={15} />
            </button>
            <button
              onClick={() => onUpdateMenu(menu)}
              className="text-xs font-bold px-2 py-1 flex items-center gap-1"
              style={{ color: "var(--ink-soft)" }}
            >
              <Upload size={13} /> 更新菜單
            </button>
          </div>
        }
      />
      {shareStatus === "fallback" && (
        <div className="px-4 mb-3">
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
            <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>自動複製失敗，點下面網址全選後手動複製</div>
            <input
              readOnly
              value={typeof window !== "undefined" ? window.location.href : ""}
              onFocus={(e) => e.target.select()}
              className="goa-input goa-mono text-xs rounded-lg px-2.5 py-2 w-full"
            />
            <button onClick={() => setShareStatus("idle")} className="goa-btn-outline rounded-lg py-1.5 text-xs font-bold">關閉</button>
          </div>
        </div>
      )}
      <div className="px-4 flex flex-col gap-3">
        {menu.storePhone && (
          <a
            href={`tel:${menu.storePhone.replace(/[^0-9+]/g, "")}`}
            className="goa-card p-3 flex items-center justify-between"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Phone size={15} style={{ color: "var(--stamp)" }} /> {menu.storePhone}
            </span>
            <span className="text-xs font-bold" style={{ color: "var(--stamp)" }}>點此撥打</span>
          </a>
        )}
        {menu.image && (
          <div className="goa-card p-3">
            <button
              onClick={() => setShowPhoto((v) => !v)}
              className="flex items-center justify-between w-full text-xs font-bold"
              style={{ color: "var(--ink-soft)" }}
            >
              <span className="flex items-center gap-1.5">
                <ImagePlus size={13} /> 原始菜單照片
              </span>
              {showPhoto ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {showPhoto && (
              <img
                src={menu.image}
                alt={`${menu.storeName} 原始菜單照片`}
                className="w-full rounded-xl mt-2"
                style={{ maxHeight: 420, objectFit: "contain" }}
              />
            )}
          </div>
        )}
        <div className="goa-card p-4">
          {(() => {
            const groups = groupItemsByCategory(menu.items);
            const showHeaders = groups.length > 1;
            return groups.map((group, gi) => {
              const isOpen = !showHeaders || expandedCats.has(group.category);
              return (
                <div key={group.category} className={gi > 0 ? "goa-divider pt-2 mt-2" : ""}>
                  {showHeaders ? (
                    <button
                      onClick={() => toggleCat(group.category)}
                      className="flex items-center justify-between w-full py-1"
                    >
                      <span className="text-sm font-black" style={{ color: "var(--stamp)" }}>
                        {group.category}<span className="font-normal" style={{ color: "var(--ink-soft)" }}> （{group.items.length}）</span>
                      </span>
                      <ChevronDown
                        size={16}
                        style={{ color: "var(--ink-soft)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
                      />
                    </button>
                  ) : null}
                  {isOpen && (
                    <div className={showHeaders ? "mt-1.5" : ""}>
                      {group.items.map((it, i) => (
                        <div key={it.id} className={`py-2.5 ${i > 0 ? "goa-divider" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">{it.name}</span>
                            <span className="goa-mono font-bold text-sm">{currency(it.price)}</span>
                          </div>
                          {(it.optionGroups || []).filter((g) => g.choices?.length).map((g) => (
                            <div key={g.id} className="text-xs mt-0.5" style={{ color: "var(--stamp)" }}>
                              需選擇{g.name ? `「${g.name}」` : ""}：{g.choices.join("／")}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>

      <div className="fixed left-0 right-0 bottom-0 p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        {!showCreate ? (
          <button onClick={() => setShowCreate(true)} className="goa-btn-primary w-full rounded-xl py-3 font-bold flex items-center justify-center gap-2 shadow-lg">
            <Users size={17} /> 開這攤團
          </button>
        ) : (
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop shadow-lg">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="goa-input rounded-xl px-3 py-2 text-sm"
              placeholder="幫這團取個名字"
            />
            {error && <div className="text-xs" style={{ color: "var(--stamp-dark)" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
              <button onClick={createGroup} disabled={creating} className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                確認開團
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== Group List ============================== */

function GroupCard({ g, onClick }) {
  return (
    <button onClick={onClick} className="goa-card goa-pop text-left p-4 flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between">
        <span className="goa-display font-bold text-base truncate">{g.groupName}</span>
        <StatusChip status={g.status} />
      </div>
      <div className="text-xs flex items-center gap-1" style={{ color: "var(--ink-soft)" }}>
        <Store size={12} /> {g.storeName}
      </div>
      {g.status === "closed" && (g.payerName || g.creatorName) && (
        <div className="text-xs flex items-center gap-1 font-bold" style={{ color: "var(--till)" }}>
          <Wallet size={12} /> 付款人：{g.payerName || g.creatorName}
        </div>
      )}
    </button>
  );
}

function GroupList({ onOpenGroup, refreshKey }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.listGroups();
        if (alive) setGroups(list);
      } catch (e) {
        if (alive) setError(e.message || "讀取揪團失敗");
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  if (error) {
    return (
      <div className="px-4">
        <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      </div>
    );
  }

  if (groups === null) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} /></div>;
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Users size={32} />}
        title="還沒有任何揪團"
        hint={"到「菜單庫」選一家店，點「開這攤團」邀大家一起點餐"}
      />
    );
  }
  const open = groups.filter((g) => g.status === "open");
  const closed = groups.filter((g) => g.status === "closed");
  const cancelled = groups.filter((g) => g.status === "cancelled");
  return (
    <div className="px-4 pb-24 flex flex-col gap-5">
      {open.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>進行中</div>
          {open.map((g) => <GroupCard key={g.id} g={g} onClick={() => onOpenGroup(g.id)} />)}
        </div>
      )}
      {closed.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>已結單</div>
          {closed.map((g) => <GroupCard key={g.id} g={g} onClick={() => onOpenGroup(g.id)} />)}
        </div>
      )}
      {cancelled.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>已取消</div>
          {cancelled.map((g) => <GroupCard key={g.id} g={g} onClick={() => onOpenGroup(g.id)} />)}
        </div>
      )}
    </div>
  );
}

/* ============================== Chip Picker (reusable) ============================== */

function ChipPicker({ options, value, onChange, customPlaceholder = "輸入名字", allowCustom = true }) {
  const [customMode, setCustomMode] = useState(allowCustom && !!value && !options.includes(value));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((name) => (
          <button
            key={name}
            onClick={() => { onChange(name); setCustomMode(false); }}
            className="text-xs font-bold px-2.5 py-1.5 rounded-full"
            style={
              !customMode && value === name
                ? { background: "var(--till)", color: "#fff" }
                : { background: "transparent", border: "1.5px solid var(--line)", color: "var(--ink-soft)" }
            }
          >
            {name}
          </button>
        ))}
        {allowCustom && (
          <button
            onClick={() => setCustomMode(true)}
            className="text-xs font-bold px-2.5 py-1.5 rounded-full"
            style={
              customMode
                ? { background: "var(--till)", color: "#fff" }
                : { background: "transparent", border: "1.5px dashed var(--line)", color: "var(--ink-soft)" }
            }
          >
            其他
          </button>
        )}
      </div>
      {allowCustom && customMode && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          className="goa-input rounded-lg px-3 py-2 text-sm"
          autoFocus
        />
      )}
    </div>
  );
}

/* ============================== Extra Charges Editor (delivery fee / price adjustments) ============================== */

function ExtraChargesEditor({ group, canEdit, peopleNames, onUpdated }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [appliesTo, setAppliesTo] = useState("平均分攤");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const extraCharges = group.extraCharges || [];

  const startAdd = () => {
    setLabel("");
    setAmount("");
    setAppliesTo("平均分攤");
    setError("");
    setAdding(true);
  };

  const saveNew = async () => {
    const amt = Number(amount);
    if (!label.trim() || !amt) {
      setError("請填寫名稱與金額");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = [
        ...extraCharges,
        { id: uid("ec"), label: label.trim(), amount: amt, appliesTo: appliesTo === "平均分攤" ? "all" : appliesTo },
      ];
      const updated = await api.updateExtraCharges(group.id, next);
      onUpdated(updated);
      setAdding(false);
    } catch (e) {
      setError(e.message || "新增失敗");
    } finally {
      setSaving(false);
    }
  };

  const removeCharge = async (chargeId) => {
    setSaving(true);
    setError("");
    try {
      const next = extraCharges.filter((c) => c.id !== chargeId);
      const updated = await api.updateExtraCharges(group.id, next);
      onUpdated(updated);
    } catch (e) {
      setError(e.message || "刪除失敗");
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit && extraCharges.length === 0) return null;

  return (
    <div className="goa-card p-4 flex flex-col gap-2">
      <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>額外費用與折扣（外送費、漲價、折價券等）</div>
      {extraCharges.length === 0 && !adding && (
        <div className="text-sm text-center py-2" style={{ color: "var(--ink-soft)" }}>目前沒有額外費用或折扣</div>
      )}
      {extraCharges.map((c, i) => (
        <div key={c.id || `ec_${i}`} className="flex items-center justify-between text-sm">
          <span>
            {c.label}
            <span className="text-xs ml-1.5" style={{ color: "var(--ink-soft)" }}>
              {c.appliesTo === "all" ? "（平均分攤）" : `（算在 ${c.appliesTo} 身上）`}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="goa-mono font-bold" style={{ color: c.amount < 0 ? "var(--till)" : "var(--ink)" }}>{c.amount < 0 ? `- ${currency(Math.abs(c.amount))}` : currency(c.amount)}</span>
            {canEdit && (
              <button onClick={() => removeCharge(c.id)} disabled={saving} style={{ color: "var(--ink-soft)" }}>
                <Trash2 size={13} />
              </button>
            )}
          </span>
        </div>
      ))}
      {error && <div className="text-xs" style={{ color: "var(--stamp-dark)" }}>{error}</div>}
      {canEdit && (
        !adding ? (
          <button onClick={startAdd} className="text-xs font-bold flex items-center gap-1 mt-1" style={{ color: "var(--stamp)" }}>
            <Plus size={13} /> 新增費用／折扣
          </button>
        ) : (
          <div className="flex flex-col gap-2 mt-1 p-2 rounded-lg" style={{ background: "var(--paper)" }}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="名稱（例如：外送費、折價券）"
              className="goa-input rounded-lg px-2.5 py-1.5 text-sm"
            />
            <div>
              <div className="flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => {
                    // 允許負號，但只能放在最前面（例如 -50）
                    const v = e.target.value.replace(/[^0-9-]/g, "");
                    const negative = v.startsWith("-");
                    const digits = v.replace(/-/g, "");
                    setAmount(negative ? `-${digits}` : digits);
                  }}
                  inputMode="text"
                  placeholder="金額（折扣請填負數，例如 -50）"
                  className="goa-input goa-mono rounded-lg px-2.5 py-1.5 text-sm flex-1"
                />
                <button
                  onClick={() => setAmount((prev) => (prev.startsWith("-") ? prev.slice(1) : prev ? `-${prev}` : prev))}
                  className="goa-btn-outline rounded-lg px-2.5 py-1.5 text-xs font-bold shrink-0"
                >
                  ± 正負
                </button>
              </div>
              {amount.startsWith("-") && (
                <div className="text-xs mt-1" style={{ color: "var(--till)" }}>這是折扣，會從總金額扣掉</div>
              )}
            </div>
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: "var(--ink-soft)" }}>由誰分攤？</div>
              <ChipPicker options={["平均分攤", ...peopleNames]} value={appliesTo} onChange={setAppliesTo} allowCustom={false} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdding(false)} disabled={saving} className="goa-btn-outline rounded-lg py-1.5 text-xs font-bold flex-1">取消</button>
              <button onClick={saveNew} disabled={saving} className="goa-btn-primary rounded-lg py-1.5 text-xs font-bold flex-1 flex items-center justify-center gap-1">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                新增
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ============================== Receipt (closed group) ============================== */

function ReceiptView({ group, menu, me, canEdit, onGroupUpdated, onGoToProfile, onDeleteGroup, onGoToGroup, onReopened }) {
  const [expanded, setExpanded] = useState({});
  const [editingPayer, setEditingPayer] = useState(false);
  const [payerDraft, setPayerDraft] = useState("");
  const [savingPayer, setSavingPayer] = useState(false);
  const [profile, setProfile] = useState(undefined);
  const [togglingPerson, setTogglingPerson] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAllPaid, setConfirmAllPaid] = useState(false);
  const [confirmNewGroup, setConfirmNewGroup] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const [shareHint, setShareHint] = useState("");
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const { ordering: entries, skipped: skippedPeople } = splitMembers(group.memberOrders);
  const extraCharges = Array.isArray(group.extraCharges) ? group.extraCharges : [];
  const extraChargesTotal = extraCharges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const grandTotal = entries.reduce((s, [, o]) => s + (Number(o.total) || 0), 0) + extraChargesTotal;
  const payerName = group.payerName || group.creatorName;
  const isMe = me === payerName;
  const paidStatus = group.paidStatus || {};
  const paidCount = entries.filter(([person]) => paidStatus[person]).length;
  const allPaid = entries.length === 0 || paidCount === entries.length;

  useEffect(() => {
    let alive = true;
    setProfile(undefined);
    (async () => {
      try {
        const p = await api.getPaymentProfile(payerName);
        if (alive) setProfile(p);
      } catch (e) {
        if (alive) setProfile(null);
      }
    })();
    return () => { alive = false; };
  }, [payerName]);

  const savePayerName = async () => {
    const trimmed = payerDraft.trim();
    if (!trimmed) return;
    setSavingPayer(true);
    setActionError("");
    try {
      const updated = await api.updatePayerName(group.id, { payerName: trimmed });
      setEditingPayer(false);
      onGroupUpdated?.(updated);
    } catch (e) {
      setActionError(e.message || "更新失敗");
    } finally {
      setSavingPayer(false);
    }
  };

  const togglePaid = async (person) => {
    setTogglingPerson(person);
    setActionError("");
    try {
      const updated = await api.togglePaid(group.id, { person });
      onGroupUpdated?.(updated);
    } catch (e) {
      setActionError(e.message || "更新失敗");
    } finally {
      setTogglingPerson(null);
    }
  };

  const deleteThisGroup = async () => {
    setDeleting(true);
    setActionError("");
    try {
      await onDeleteGroup?.();
    } catch (e) {
      setActionError(e.message || "刪除失敗");
      setDeleting(false);
    }
  };

  const reopenGroup = async () => {
    setReopening(true);
    setActionError("");
    try {
      const updated = await api.reopenGroup(group.id);
      onGroupUpdated?.(updated);
      onReopened?.();
    } catch (e) {
      setActionError(e.message || "取消結單失敗");
      setReopening(false);
    }
  };

  const startNewGroup = async () => {
    setStartingNew(true);
    setActionError("");
    try {
      const res = await api.startGroup(group.menuId, { creatorName: me, force: true });
      onGoToGroup?.(res.group.id);
    } catch (e) {
      setActionError(e.message || "開新團失敗");
      setStartingNew(false);
    }
  };

  const markAllPaidAndDelete = async () => {
    setDeleting(true);
    setActionError("");
    try {
      await api.markAllPaid(group.id);
      await onDeleteGroup?.();
    } catch (e) {
      setActionError(e.message || "操作失敗");
      setDeleting(false);
    }
  };

  const payerLineLink = toLineLink(profile?.lineUrl);

  const shareImage = async () => {
    setSharingImage(true);
    setShareHint("");
    setActionError("");
    try {
      const result = await shareReceiptImage({
        group, entries, extraCharges, grandTotal, payerName,
      });
      if (result === "downloaded") {
        setShareHint("已下載帳單圖片，可以從相簿/下載資料夾傳到 LINE");
        setTimeout(() => setShareHint(""), 4000);
      }
    } catch (e) {
      setActionError(e.message || "產生圖片失敗");
    } finally {
      setSharingImage(false);
    }
  };

  return (
    <div className="px-4">
      <div className="receipt-ticket rounded-2xl p-5 flex flex-col gap-4 goa-pop" style={{ marginTop: 4, marginBottom: 4 }}>
        <div className="flex items-center justify-between">
          <div className="goa-display font-black text-lg">{group.groupName}</div>
          <span className="stamp-badge text-xs">已結單</span>
        </div>
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{group.storeName}・共 {entries.length} 人</div>
        {menu?.storePhone && (
          <a
            href={`tel:${menu.storePhone.replace(/[^0-9+]/g, "")}`}
            className="flex items-center justify-between rounded-xl px-3 py-2"
            style={{ background: "var(--paper)" }}
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Phone size={14} style={{ color: "var(--stamp)" }} /> {menu.storePhone}
            </span>
            <span className="text-xs font-bold" style={{ color: "var(--stamp)" }}>點此撥打</span>
          </a>
        )}

        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "var(--till-bg)" }}>
          {!editingPayer ? (
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-2 min-w-0">
                <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--till)" }}>
                  <Wallet size={15} className="shrink-0" />
                  <span>請把錢轉給付款人：{payerName}</span>
                </span>
                {payerLineLink && (
                  <a
                    href={payerLineLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold w-fit"
                    style={{ background: "#06C755", color: "#FFFFFF" }}
                  >
                    <MessageCircle size={13} /> 用 LINE 聯絡 {payerName}
                  </a>
                )}
              </div>
              {canEdit && (
                <button
                  onClick={() => { setPayerDraft(payerName); setEditingPayer(true); }}
                  className="p-1 shrink-0"
                  style={{ color: "var(--till)" }}
                  aria-label="修改付款人"
                >
                  <PencilLine size={14} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold" style={{ color: "var(--till)" }}>這攤實際上是誰付的錢？</label>
              <ChipPicker
                options={Array.from(new Set([group.creatorName, ...entries.map(([p]) => p)].filter(Boolean)))}
                value={payerDraft}
                onChange={setPayerDraft}
              />
              <div className="flex gap-2">
                <button onClick={() => setEditingPayer(false)} disabled={savingPayer} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
                <button onClick={savePayerName} disabled={savingPayer || !payerDraft.trim()} className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5">
                  {savingPayer ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  儲存
                </button>
              </div>
            </div>
          )}

          {profile === undefined ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin" style={{ color: "var(--till)" }} /></div>
          ) : payerLineLink ? null : isMe ? (
            <button onClick={onGoToProfile} className="text-xs font-bold flex items-center justify-center gap-1.5 py-2" style={{ color: "var(--stamp)" }}>
              <Wallet size={13} /> 你還沒設定 LINE 連結，點此設定
            </button>
          ) : null}
        </div>

        <div className="goa-divider pt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>付款狀態</span>
            {entries.length > 0 && (
              <span className="text-xs font-bold" style={{ color: allPaid ? "var(--till)" : "var(--ink-soft)" }}>
                {paidCount} / {entries.length} 人已付款
              </span>
            )}
          </div>
          {entries.length === 0 && (
            <div className="text-sm text-center py-4" style={{ color: "var(--ink-soft)" }}>這團沒有任何人點餐就結單了</div>
          )}
          {entries.map(([person, order]) => {
            const personExtra = computePersonExtra(person, extraCharges, entries.length);
            const adjustedTotal = (Number(order.total) || 0) + personExtra;
            const isPaid = !!paidStatus[person];
            return (
              <div key={person}>
                <div className="flex items-center justify-between w-full gap-2">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [person]: !p[person] }))}
                    className="flex items-center justify-between flex-1 min-w-0 gap-2"
                  >
                    <span className="flex items-center gap-1.5 font-bold text-sm truncate">
                      <UserRound size={14} style={{ color: "var(--stamp)" }} className="shrink-0" /> {person}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="goa-mono font-black text-base">{currency(adjustedTotal)}</span>
                      {expanded[person] ? <EyeOff size={14} /> : <Eye size={14} style={{ color: "var(--ink-soft)" }} />}
                    </span>
                  </button>
                </div>
                <div className="mt-1 pl-5">
                  {isMe ? (
                    <button
                      onClick={() => togglePaid(person)}
                      disabled={togglingPerson === person}
                      className="text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                      style={
                        isPaid
                          ? { background: "var(--till)", color: "#fff" }
                          : { background: "transparent", border: "1.5px dashed var(--stamp)", color: "var(--stamp)" }
                      }
                    >
                      {togglingPerson === person ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : isPaid ? (
                        <CheckCircle2 size={11} />
                      ) : (
                        <Circle size={11} />
                      )}
                      {isPaid ? "已付款" : "尚未付款・點我標記"}
                    </button>
                  ) : (
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                      style={
                        isPaid
                          ? { background: "var(--till-bg)", color: "var(--till)" }
                          : { background: "transparent", border: "1.5px solid var(--line)", color: "var(--ink-soft)" }
                      }
                    >
                      {isPaid ? <CheckCircle2 size={11} /> : <Circle size={11} />}
                      {isPaid ? "已付款" : "尚未付款"}
                    </span>
                  )}
                </div>
                {expanded[person] && (
                  <div className="mt-1.5 pl-5 flex flex-col gap-1">
                    {(order.items || []).map((it) => (
                      <div key={it.itemId} className="flex items-center justify-between text-xs" style={{ color: "var(--ink-soft)" }}>
                        <span>{it.name} × {it.qty}{formatOrderItemDetails(it)}</span>
                        <span className="goa-mono">{currency(it.price * it.qty)}</span>
                      </div>
                    ))}
                    {personExtra !== 0 && (
                      <div className="flex items-center justify-between text-xs" style={{ color: personExtra < 0 ? "var(--till)" : "var(--stamp)" }}>
                        <span>{personExtra < 0 ? "折扣分攤" : "額外費用分攤"}</span>
                        <span className="goa-mono">{personExtra < 0 ? `- ${currency(Math.abs(personExtra))}` : currency(personExtra)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {entries.length > 0 && (
            <div className="text-xs text-center" style={{ color: "var(--ink-soft)" }}>
              {isMe ? "點每個人下面的標籤，標記他有沒有付錢給你" : `付款狀態由付款人 ${payerName} 標記`}
            </div>
          )}
          <SkipNotice names={skippedPeople} className="mt-1" />
        </div>

        <div className="goa-divider pt-3 flex items-center justify-between">
          <span className="goa-display font-bold">總計</span>
          <span className="goa-mono font-black text-xl" style={{ color: "var(--stamp)" }}>{currency(grandTotal)}</span>
        </div>
      </div>

      <div className="pt-3">
        <OrderSummaryCard storeName={group.storeName} members={entries} menuItems={menu?.items} />
      </div>

      <div className="pt-3">
        <button
          onClick={shareImage}
          disabled={sharingImage}
          className="goa-btn-primary w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
        >
          {sharingImage ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
          分享帳單圖片
        </button>
        {shareHint && (
          <div className="text-xs text-center mt-1.5" style={{ color: "var(--till)" }}>{shareHint}</div>
        )}
      </div>

      <div className="pt-3">
        <LineBillPanel group={group} />
      </div>

      <div className="pt-3">
        <ExtraChargesEditor
          group={group}
          canEdit={canEdit}
          peopleNames={entries.map(([p]) => p)}
          onUpdated={onGroupUpdated}
        />
      </div>

      <div className="flex items-center justify-center gap-1.5 text-xs pt-1" style={{ color: "var(--ink-soft)" }}>
        <Lock size={12} /> 這團已結單，僅供對帳查看
      </div>

      <div className="pt-3">
        {!confirmReopen ? (
          <button
            onClick={() => setConfirmReopen(true)}
            className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "transparent", border: "1.5px solid var(--till)", color: "var(--till)" }}
          >
            <RefreshCw size={15} /> 取消結單，讓大家繼續點餐
          </button>
        ) : (
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
            <div className="text-sm text-center font-bold">要取消結單嗎？大家就可以繼續點餐或修改，付款人與付款紀錄會保留。</div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmReopen(false)} disabled={reopening} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
              <button
                onClick={reopenGroup}
                disabled={reopening}
                className="rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
                style={{ background: "var(--till)", color: "#fff" }}
              >
                {reopening ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                確定取消結單
              </button>
            </div>
          </div>
        )}
      </div>

      {group.menuId && (
        <div className="pt-3">
          {!confirmNewGroup ? (
            <button
              onClick={() => setConfirmNewGroup(true)}
              className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: "transparent", border: "1.5px solid var(--ink)", color: "var(--ink)" }}
            >
              <Plus size={15} /> 在這家店開新一團
            </button>
          ) : (
            <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
              <div className="text-sm text-center font-bold">要在「{group.storeName}」開新的一團嗎？這張收據會保留。</div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmNewGroup(false)} disabled={startingNew} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
                <button
                  onClick={startNewGroup}
                  disabled={startingNew}
                  className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
                >
                  {startingNew ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  開新一團
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 text-sm p-3 rounded-xl mt-3" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{actionError}</span>
        </div>
      )}

      {isMe && (
        <div className="pt-3">
          {!confirmAllPaid ? (
            <button
              onClick={() => setConfirmAllPaid(true)}
              className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: "var(--till)", color: "#fff" }}
            >
              <CheckCircle2 size={15} /> 錢全部都收齊，刪除這團
            </button>
          ) : (
            <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
              <div className="text-sm text-center font-bold">確定大家的錢都收齊了嗎？這會把所有人標記為已付款，並直接刪除這團紀錄，無法復原。</div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmAllPaid(false)} disabled={deleting} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
                <button
                  onClick={markAllPaidAndDelete}
                  disabled={deleting}
                  className="rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
                  style={{ background: "var(--till)", color: "#fff" }}
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  確定收齊並刪除
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!isMe && canEdit && allPaid && (
        <div className="pt-3">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: "transparent", border: "1.5px solid var(--stamp)", color: "var(--stamp)" }}
            >
              <Trash2 size={15} /> 全部付款完成，刪除這團紀錄
            </button>
          ) : (
            <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
              <div className="text-sm text-center font-bold">確定要刪除這團嗎？刪除後無法復原。</div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
                <button
                  onClick={deleteThisGroup}
                  disabled={deleting}
                  className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
                  style={{ background: "var(--stamp)" }}
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  確定刪除
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================== Group View (open) ============================== */

function GroupView({ groupId, me, onBack, onChangedStatus, onGoToProfile, onGoToGroup }) {
  const [group, setGroup] = useState(null);
  const [skipping, setSkipping] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReasonDraft, setCancelReasonDraft] = useState("");
  const [menu, setMenu] = useState(null);
  const [myQty, setMyQty] = useState({});
  const [myOptions, setMyOptions] = useState({}); // { [itemId]: { [groupId]: choice } }
  const [myNotes, setMyNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [payerDraft, setPayerDraft] = useState("");
  const [shareStatus, setShareStatus] = useState("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedCats, setExpandedCats] = useState(() => new Set());
  const menuRef = useRef(null);
  const pollRef = useRef(null);

  const toggleCat = (cat) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const fetchAll = useCallback(async (initQty) => {
    try {
      const g = await api.getGroup(groupId);
      if (!g) return;
      setGroup(g);
      if (!menuRef.current && g.menuId) {
        const m = await api.getMenu(g.menuId);
        menuRef.current = m;
        setMenu(m);
      }
      if (initQty) {
        const mine = g.memberOrders?.[me];
        const q = {};
        const n = {};
        const o = {};
        (mine?.items || []).forEach((it) => {
          q[it.itemId] = it.qty;
          n[it.itemId] = it.note || "";
          if (it.options && it.options.length) {
            o[it.itemId] = {};
            it.options.forEach((opt) => { o[it.itemId][opt.groupId] = opt.choice; });
          }
        });
        setMyQty(q);
        setMyNotes(n);
        setMyOptions(o);
        const menuData = menuRef.current;
        if (menuData && mine?.items?.length) {
          const orderedIds = new Set(mine.items.map((it) => it.itemId));
          const catsToExpand = new Set();
          menuData.items.forEach((it) => {
            if (orderedIds.has(it.id)) catsToExpand.add((it.category || "").trim() || "其他");
          });
          setExpandedCats(catsToExpand);
        }
      }
    } catch (e) {
      setError(e.message || "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [groupId, me]);

  useEffect(() => {
    fetchAll(true);
    pollRef.current = setInterval(() => fetchAll(false), 4000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const changeQty = (itemId, delta) => {
    setMyQty((prev) => {
      const next = Math.max(0, (prev[itemId] || 0) + delta);
      return { ...prev, [itemId]: next };
    });
  };

  const myTotal = menu ? menu.items.reduce((s, it) => s + (myQty[it.id] || 0) * it.price, 0) : 0;

  const markSkip = async () => {
    setSkipping(true);
    setError("");
    try {
      const updated = await api.submitOrder(groupId, {
        person: me,
        order: { skipped: true, items: [], total: 0 },
      });
      setGroup(updated);
      setMyQty({});
      setMyNotes({});
      setMyOptions({});
    } catch (e) {
      setError(e.message || "設定失敗");
    } finally {
      setSkipping(false);
    }
  };

  const cancelSkip = async () => {
    setSkipping(true);
    setError("");
    try {
      const updated = await api.submitOrder(groupId, { person: me, order: null });
      setGroup(updated);
    } catch (e) {
      setError(e.message || "取消失敗");
    } finally {
      setSkipping(false);
    }
  };

  const cancelGroup = async () => {
    setCancelling(true);
    setError("");
    try {
      const updated = await api.cancelGroup(groupId, { reason: cancelReasonDraft.trim() });
      setGroup(updated);
      setConfirmCancel(false);
      onChangedStatus?.();
    } catch (e) {
      setError(e.message || "取消失敗");
    } finally {
      setCancelling(false);
    }
  };

  const submitOrder = async () => {
    setError("");
    // 驗證：有數量的品項，如果底下有必選項目，一定要選過才能送出
    for (const it of menu.items) {
      const qty = myQty[it.id] || 0;
      if (qty <= 0) continue;
      for (const group of it.optionGroups || []) {
        if (!group.choices?.length) continue;
        if (!myOptions[it.id]?.[group.id]) {
          setError(`「${it.name}」還需要選擇「${group.name || "必選項目"}」才能送出`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const items = menu.items
        .filter((it) => (myQty[it.id] || 0) > 0)
        .map((it) => ({
          itemId: it.id,
          name: it.name,
          price: it.price,
          qty: myQty[it.id],
          note: (myNotes[it.id] || "").trim(),
          options: (it.optionGroups || [])
            .filter((g) => myOptions[it.id]?.[g.id])
            .map((g) => ({ groupId: g.id, groupName: g.name || "必選", choice: myOptions[it.id][g.id] })),
        }));
      const total = items.reduce((s, it) => s + it.price * it.qty, 0);
      const order = items.length === 0 ? null : { items, total };
      const updated = await api.submitOrder(groupId, { person: me, order });
      setGroup(updated);
    } catch (e) {
      setError(e.message || "送出失敗");
    } finally {
      setSaving(false);
    }
  };

  const closeGroup = async () => {
    setClosing(true);
    setError("");
    try {
      const updated = await api.closeGroup(groupId, { payerName: payerDraft.trim() || group.creatorName });
      setGroup(updated);
      onChangedStatus?.();
    } catch (e) {
      setError(e.message || "結單失敗");
    } finally {
      setClosing(false);
    }
  };

  const deleteGroup = async () => {
    await api.deleteGroup(groupId);
    onChangedStatus?.();
    onBack?.();
  };

  const doShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch (e) {
      setShareStatus("fallback");
    }
  };

  if (loading || !group) {
    return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} /></div>;
  }

  if (group.status !== "closed" && !menu) {
    return (
      <div className="pb-10">
        <TopBar title={group.groupName} subtitle={group.storeName} onBack={onBack} />
        <EmptyState icon={<AlertCircle size={32} />} title="找不到這份菜單" hint="原始菜單可能已被刪除或更新，無法繼續點餐" />
      </div>
    );
  }


  if (group.status === "cancelled") {
    return (
      <div className="pb-10">
        <TopBar title={group.groupName} subtitle={group.storeName} onBack={onBack} />
        <div className="px-4">
          <div className="goa-card p-5 flex flex-col items-center gap-3 text-center goa-pop">
            <XCircle size={40} style={{ color: "var(--stamp)" }} />
            <div className="goa-display font-black text-lg">這團已取消</div>
            {group.cancelReason && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
                原因：{group.cancelReason}
              </div>
            )}
            <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
              大家點的餐都不算數，這筆紀錄兩天後會自動清除。
            </div>
            {group.menuId && (
              <button
                onClick={async () => {
                  try {
                    const res = await api.startGroup(group.menuId, { creatorName: me, force: true });
                    onGoToGroup?.(res.group.id);
                  } catch (e) {
                    setError(e.message || "開新團失敗");
                  }
                }}
                className="goa-btn-outline rounded-xl px-4 py-2 text-sm font-bold mt-1"
              >
                在這家店開新一團
              </button>
            )}
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm p-3 rounded-xl mt-3" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (group.status === "closed") {
    return (
      <div className="pb-10">
        <TopBar
          title={group.groupName}
          subtitle={group.storeName}
          onBack={onBack}
          right={
            <button onClick={onGoToProfile} className="p-2" style={{ color: "var(--ink-soft)" }} aria-label="我的收款設定">
              <Wallet size={16} />
            </button>
          }
        />
        <ReceiptView
          group={group}
          menu={menu}
          me={me}
          canEdit={true}
          onGroupUpdated={setGroup}
          onGoToProfile={onGoToProfile}
          onDeleteGroup={deleteGroup}
          onGoToGroup={onGoToGroup}
          onReopened={() => { setConfirmingClose(false); onChangedStatus?.(); }}
        />
      </div>
    );
  }

  const { ordering: members, skipped: skippedMembers } = splitMembers(group.memberOrders);
  const iAmSkipping = skippedMembers.includes(me);
  const groupedMenuItems = groupItemsByCategory(menu.items);
  const showMenuCategoryHeaders = groupedMenuItems.length > 1;

  return (
    <div className="pb-10">
      <TopBar
        title={group.groupName}
        subtitle={`${group.storeName} ・ 發起人 ${group.creatorName}`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-1">
            {shareStatus === "copied" && (
              <span className="text-xs font-bold mr-1" style={{ color: "var(--till)" }}>已複製連結</span>
            )}
            <button onClick={onGoToProfile} className="p-2" style={{ color: "var(--ink-soft)" }} aria-label="我的收款設定">
              <Wallet size={16} />
            </button>
            <button onClick={doShare} className="p-2" style={{ color: "var(--ink-soft)" }} aria-label="分享">
              <Share2 size={16} />
            </button>
            <button onClick={() => fetchAll(false)} className="p-2" style={{ color: "var(--ink-soft)" }} aria-label="重新整理">
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />
      {shareStatus === "fallback" && (
        <div className="px-4 mb-4">
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
            <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>自動複製失敗，點下面網址全選後手動複製</div>
            <input
              readOnly
              value={typeof window !== "undefined" ? window.location.href : ""}
              onFocus={(e) => e.target.select()}
              className="goa-input goa-mono text-xs rounded-lg px-2.5 py-2 w-full"
            />
            <button onClick={() => setShareStatus("idle")} className="goa-btn-outline rounded-lg py-1.5 text-xs font-bold">關閉</button>
          </div>
        </div>
      )}
      <div className="px-4 flex items-center gap-2 mb-3 flex-wrap">
        <StatusChip status={group.status} />
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{members.length} 人已點餐</span>
      </div>

      {menu.storePhone && (
        <div className="px-4 mb-4">
          <a
            href={`tel:${menu.storePhone.replace(/[^0-9+]/g, "")}`}
            className="goa-card p-3 flex items-center justify-between"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Phone size={15} style={{ color: "var(--stamp)" }} /> {menu.storePhone}
            </span>
            <span className="text-xs font-bold" style={{ color: "var(--stamp)" }}>點此撥打訂餐</span>
          </a>
        </div>
      )}

      {error && (
        <div className="px-4 mb-4">
          <div className="flex items-start gap-2 text-sm p-3 rounded-xl" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        </div>
      )}

      <div className="px-4 flex flex-col gap-4">
        <div className="goa-card p-4">
          <div className="text-xs font-bold mb-2" style={{ color: "var(--ink-soft)" }}>我要點的餐</div>
          {groupedMenuItems.map((group, gi) => {
            const isOpen = !showMenuCategoryHeaders || expandedCats.has(group.category);
            const pickedCount = group.items.reduce((s, it) => s + (myQty[it.id] || 0), 0);
            return (
              <div key={group.category} className={gi > 0 ? "goa-divider pt-2 mt-2" : ""}>
                {showMenuCategoryHeaders ? (
                  <button
                    onClick={() => toggleCat(group.category)}
                    className="flex items-center justify-between w-full py-1"
                  >
                    <span className="text-sm font-black flex items-center gap-1.5" style={{ color: "var(--stamp)" }}>
                      {group.category}
                      <span className="font-normal" style={{ color: "var(--ink-soft)" }}>（{group.items.length}）</span>
                      {pickedCount > 0 && (
                        <span
                          className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: "var(--till-bg)", color: "var(--till)" }}
                        >
                          已選 {pickedCount}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      size={16}
                      style={{ color: "var(--ink-soft)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
                    />
                  </button>
                ) : null}
                {isOpen && (
                  <div className={showMenuCategoryHeaders ? "mt-1.5" : ""}>
                    {group.items.map((it, i) => (
                      <div key={it.id} className={`py-2.5 ${i > 0 ? "goa-divider" : ""}`}>
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm truncate">{it.name}</div>
                            <div className="goa-mono text-xs" style={{ color: "var(--ink-soft)" }}>{currency(it.price)}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => changeQty(it.id, -1)} className="goa-stepper-btn rounded-full w-7 h-7 flex items-center justify-center">
                              <Minus size={13} />
                            </button>
                            <span className="goa-mono font-bold w-5 text-center">{myQty[it.id] || 0}</span>
                            <button onClick={() => changeQty(it.id, 1)} className="goa-stepper-btn rounded-full w-7 h-7 flex items-center justify-center">
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>
                        {(myQty[it.id] || 0) > 0 && (it.optionGroups || []).filter((g) => g.choices?.length).map((group) => (
                          <div key={group.id} className="mt-1.5">
                            <div className="text-xs font-bold mb-1 flex items-center gap-1">
                              <span>{group.name || "必選項目"}</span>
                              <span style={{ color: "var(--stamp)" }}>必選</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.choices.map((choice) => {
                                const selected = myOptions[it.id]?.[group.id] === choice;
                                return (
                                  <button
                                    key={choice}
                                    onClick={() =>
                                      setMyOptions((prev) => ({ ...prev, [it.id]: { ...prev[it.id], [group.id]: choice } }))
                                    }
                                    className="text-xs font-bold px-2.5 py-1 rounded-full"
                                    style={
                                      selected
                                        ? { background: "var(--stamp)", color: "#fff" }
                                        : { background: "transparent", border: "1.5px solid var(--line)", color: "var(--ink-soft)" }
                                    }
                                  >
                                    {choice}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {(myQty[it.id] || 0) > 0 && (
                          <input
                            value={myNotes[it.id] || ""}
                            onChange={(e) => setMyNotes((prev) => ({ ...prev, [it.id]: e.target.value }))}
                            placeholder="備註（例如：少冰半糖、加辣、不要湯）"
                            className="goa-input w-full rounded-lg px-2.5 py-1.5 text-xs mt-1.5"
                            maxLength={40}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="goa-divider pt-3 flex items-center justify-between">
            <span className="text-sm font-bold">我的小計</span>
            <span className="goa-mono font-black text-lg" style={{ color: "var(--stamp)" }}>{currency(myTotal)}</span>
          </div>
          <button
            onClick={submitOrder}
            disabled={saving}
            className="goa-btn-primary w-full rounded-xl py-2.5 font-bold mt-3 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            送出我的點餐
          </button>

          {iAmSkipping ? (
            <button
              onClick={cancelSkip}
              disabled={skipping}
              className="w-full rounded-xl py-2 text-sm font-bold mt-2 flex items-center justify-center gap-2"
              style={{ background: "var(--till-bg)", color: "var(--till)" }}
            >
              {skipping ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
              你這次不用餐（點此改成要點）
            </button>
          ) : (
            <button
              onClick={markSkip}
              disabled={skipping}
              className="w-full rounded-xl py-2 text-sm font-bold mt-2 flex items-center justify-center gap-2"
              style={{ background: "transparent", border: "1.5px solid var(--line)", color: "var(--ink-soft)" }}
            >
              {skipping ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
              我這餐不用
            </button>
          )}
        </div>

        <div className="goa-card p-4">
          <div className="text-xs font-bold mb-2" style={{ color: "var(--ink-soft)" }}>大家吃什麼</div>
          {members.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: "var(--ink-soft)" }}>目前還沒有人點餐</div>
          ) : (
            members.map(([person, order], i) => {
              const personExtra = computePersonExtra(person, group.extraCharges, members.length);
              return (
                <div key={person} className={`py-2.5 ${i > 0 ? "goa-divider" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-sm">
                      <UserRound size={13} style={{ color: person === me ? "var(--stamp)" : "var(--ink-soft)" }} />
                      {person}{person === me ? "（我）" : ""}
                    </span>
                    <span className="goa-mono font-bold text-sm">{currency(order.total + personExtra)}</span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
                    {(order.items || []).map((it) => `${it.name}×${it.qty}${formatOrderItemDetails(it)}`).join("、")}
                    {personExtra !== 0 && `${(order.items || []).length ? "、" : ""}${personExtra < 0 ? `折扣分攤 -${currency(Math.abs(personExtra))}` : `額外費用分攤 ${currency(personExtra)}`}`}
                  </div>
                </div>
              );
            })
          )}
          {members.length > 0 && (
            <>
              <div className="goa-divider pt-3 flex items-center justify-between">
                <span className="text-sm font-bold">目前總計</span>
                <span className="goa-mono font-black text-lg">
                  {currency(members.reduce((s, [, o]) => s + o.total, 0) + (group.extraCharges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0))}
                </span>
              </div>
              <div className="text-xs text-right mt-1" style={{ color: "var(--ink-soft)" }}>
                付款人會在結單時標註
              </div>
            </>
          )}
          <SkipNotice names={skippedMembers} className="mt-3" />
        </div>

        <OrderSummaryCard storeName={group.storeName} members={members} menuItems={menu?.items} />

        <ExtraChargesEditor
          group={group}
          canEdit={true}
          peopleNames={members.map(([p]) => p)}
          onUpdated={setGroup}
        />
      </div>

      <div className="px-4 pt-4 flex flex-col gap-2">
        {!confirmingClose && !confirmCancel && (
          <button
            onClick={() => { setCancelReasonDraft(""); setConfirmCancel(true); }}
            className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "transparent", border: "1.5px solid var(--stamp)", color: "var(--stamp)" }}
          >
            <Ban size={15} /> 取消這團（店家沒開等）
          </button>
        )}

        {confirmCancel && (
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
            <div className="text-sm text-center font-bold">要取消整團嗎？大家點的餐都會作廢。</div>
            <input
              value={cancelReasonDraft}
              onChange={(e) => setCancelReasonDraft(e.target.value)}
              placeholder="原因（選填，例如：店家今天沒開）"
              className="goa-input rounded-xl px-3 py-2 text-sm"
              maxLength={40}
            />
            <div className="flex gap-2">
              <button onClick={() => setConfirmCancel(false)} disabled={cancelling} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">先不要</button>
              <button
                onClick={cancelGroup}
                disabled={cancelling}
                className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
              >
                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                確定取消整團
              </button>
            </div>
          </div>
        )}

        {!confirmCancel && !confirmingClose ? (
          <button
            onClick={() => { setPayerDraft(group.creatorName || me || ""); setConfirmingClose(true); }}
            className="w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2"
            style={{ background: "transparent", border: "1.5px solid var(--ink)", color: "var(--ink)" }}
          >
            <Receipt size={15} />
            結單
          </button>
        ) : confirmingClose ? (
          <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
            <div className="text-sm text-center font-bold">確定要結單嗎？結單後大家就不能再修改點餐了。</div>
            <div>
              <label className="text-xs font-bold flex items-center gap-1 mb-1.5" style={{ color: "var(--ink-soft)" }}>
                <Wallet size={12} /> 這攤是誰付的錢？
              </label>
              <ChipPicker
                options={Array.from(new Set([group.creatorName, ...members.map(([p]) => p)].filter(Boolean)))}
                value={payerDraft}
                onChange={setPayerDraft}
              />
              <div className="text-xs mt-1.5 flex items-start gap-1" style={{ color: "var(--ink-soft)" }}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>還不確定誰付錢也沒關係，先隨便選一個，結單後在收據上隨時可以改。</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingClose(false)} disabled={closing} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
              <button
                onClick={closeGroup}
                disabled={closing || !payerDraft.trim()}
                className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1 flex items-center justify-center gap-1.5"
              >
                {closing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                確定結單
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================== App Root ============================== */

export default function GroupOrderApp({ initialNav }) {
  const [me, setMe] = useState(undefined);
  const [nav, setNav] = useState(initialNav || { screen: "home", tab: "groups" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const router = useRouter();

  useEffect(() => {
    setMe(getMyName());
    // Vercel 免費方案的排程最快一天只能跑一次，所以每次有人打開網站時
    // 也順手請伺服器檢查一下有沒有超過 3 小時該自動結單的團。
    fetch("/api/cron/auto-close?self=1").catch(() => {});
  }, []);

  // 把目前畫面同步到網址列：看揪團時是 /groups/{id}，看菜單時是 /menus/{id}。
  // 這樣「分享」複製的網址，才會是真正連到那一團/那份菜單，而不是永遠都是首頁。
  // 注意：只有這三種畫面會動網址；像「更新菜單」「收款設定」這類暫時性畫面不改網址，
  // 否則會把使用者強制拉回首頁，畫面就跳掉了。
  useEffect(() => {
    let path = null;
    if (nav.screen === "group" && nav.groupId) path = `/groups/${nav.groupId}`;
    else if (nav.screen === "menuDetail" && nav.menuId) path = `/menus/${nav.menuId}`;
    else if (nav.screen === "home") path = "/";
    if (path && typeof window !== "undefined" && window.location.pathname !== path) {
      router.replace(path, { scroll: false });
    }
  }, [nav.screen, nav.groupId, nav.menuId, router]);

  const openSwitchIdentity = () => {
    setNameDraft(me || "");
    setEditingName(true);
  };
  const saveSwitchIdentity = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setMe(trimmed);
    setEditingName(false);
  };

  if (me === undefined) {
    return (
      <div className="goa-root flex items-center justify-center" style={{ minHeight: "100vh" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} />
      </div>
    );
  }
  if (me === null) {
    return <NameGate onDone={setMe} />;
  }

  return (
    <div className="goa-root" style={{ maxWidth: 480, margin: "0 auto" }}>
      {nav.screen === "home" && (
        <>
          <TopBar
            title="揪呷團"
            subtitle={`哈囉，${me}`}
            right={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setNav({ screen: "paymentProfile" })}
                  className="text-xs font-bold px-2 py-1 flex items-center gap-1"
                  style={{ color: "var(--ink-soft)" }}
                >
                  <Wallet size={13} /> 收款設定
                </button>
                <button onClick={openSwitchIdentity} className="text-xs font-bold px-2 py-1" style={{ color: "var(--ink-soft)" }}>
                  切換身分
                </button>
              </div>
            }
          />
          {editingName && (
            <div className="px-4 mb-3">
              <div className="goa-card p-3 flex flex-col gap-2 goa-pop">
                <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>新的稱呼</label>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveSwitchIdentity()}
                  className="goa-input rounded-xl px-3 py-2 text-sm"
                  maxLength={12}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setEditingName(false)} className="goa-btn-outline rounded-xl py-2 text-sm font-bold flex-1">取消</button>
                  <button onClick={saveSwitchIdentity} disabled={!nameDraft.trim()} className="goa-btn-primary rounded-xl py-2 text-sm font-bold flex-1">確定</button>
                </div>
              </div>
            </div>
          )}
          <div className="px-4 flex gap-2 mb-3">
            {[
              { key: "groups", label: "揪團" },
              { key: "menus", label: "菜單庫" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setNav((n) => ({ ...n, tab: t.key }))}
                className="flex-1 rounded-xl py-2 text-sm font-bold"
                style={
                  nav.tab === t.key
                    ? { background: "var(--ink)", color: "var(--card)" }
                    : { background: "transparent", color: "var(--ink-soft)", border: "1.5px solid var(--line)" }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          {nav.tab === "menus" ? (
            <MenuLibrary
              refreshKey={refreshKey}
              onOpenMenu={(menuId) => setNav({ screen: "menuDetail", menuId })}
              onUpload={() => setNav({ screen: "upload" })}
            />
          ) : (
            <GroupList
              refreshKey={refreshKey}
              onOpenGroup={(groupId) => setNav({ screen: "group", groupId })}
            />
          )}
        </>
      )}

      {nav.screen === "upload" && (
        <UploadMenuFlow
          existingMenu={nav.editMenu}
          onBack={() => setNav({ screen: nav.editMenu ? "menuDetail" : "home", tab: "menus", menuId: nav.editMenu?.id })}
          onSaved={(menuId) => { setRefreshKey((k) => k + 1); setNav({ screen: "menuDetail", menuId }); }}
        />
      )}

      {nav.screen === "menuDetail" && (
        <MenuDetail
          menuId={nav.menuId}
          onBack={() => setNav({ screen: "home", tab: "menus" })}
          onGroupCreated={(groupId) => { setRefreshKey((k) => k + 1); setNav({ screen: "group", groupId }); }}
          onUpdateMenu={(menu) => setNav({ screen: "upload", editMenu: menu })}
        />
      )}

      {nav.screen === "paymentProfile" && (
        <PaymentProfileEditor me={me} onBack={() => setNav({ screen: "home", tab: "groups" })} />
      )}

      {nav.screen === "group" && (
        <GroupView
          groupId={nav.groupId}
          me={me}
          onBack={() => setNav({ screen: "home", tab: "groups" })}
          onChangedStatus={() => setRefreshKey((k) => k + 1)}
          onGoToProfile={() => setNav({ screen: "paymentProfile" })}
          onGoToGroup={(gid) => { setRefreshKey((k) => k + 1); setNav({ screen: "group", groupId: gid }); }}
        />
      )}
    </div>
  );
}
