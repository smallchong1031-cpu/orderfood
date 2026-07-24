import { NextResponse } from "next/server";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 選用模型：claude-sonnet-5 準確度較高；claude-haiku-4-5-20251001 較便宜、速度較快。
const MODEL = "claude-sonnet-5";

// 如果 AI 回應在寫到一半時被 max_tokens 截斷，嘗試把已經完整寫完的品項救回來，
// 而不是整份辨識直接失敗（品項很多的大菜單常常會遇到這種狀況）。
function tryRepairTruncatedMenu(raw) {
  const itemsIdx = raw.indexOf('"items"');
  if (itemsIdx === -1) return null;
  const arrStart = raw.indexOf("[", itemsIdx);
  if (arrStart === -1) return null;

  let storeName = null;
  const storeNameMatch = raw.match(/"storeName"\s*:\s*("(?:[^"\\]|\\.)*"|null)/);
  if (storeNameMatch) {
    try {
      storeName = JSON.parse(storeNameMatch[1]);
    } catch (e) {
      // ignore
    }
  }

  const items = [];
  let depth = 0;
  let objStart = -1;
  for (let i = arrStart; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = raw.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(objStr);
          if (obj && typeof obj.name === "string") items.push(obj);
        } catch (e) {
          // 這個物件被截斷、解析失敗，就跳過不救
        }
        objStart = -1;
      }
    }
  }
  if (items.length === 0) return null;
  return { storeName, items, truncated: true };
}

export async function POST(request) {
  return withErrorHandling(async () => {
    const { base64, mediaType } = await request.json();
    if (!base64 || !mediaType) {
      return jsonError("缺少圖片資料", 400);
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonError("伺服器尚未設定 ANTHROPIC_API_KEY，請到 Vercel 專案的 Environment Variables 加入", 500);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "disabled" },
        system:
          '你是菜單辨識引擎。只能輸出純JSON物件，不可有任何前言、說明文字或markdown符號(例如```)。格式:{"storeName": 店名字串或null, "storePhone": 電話字串或null, "items": [{"name": 品項名稱, "price": 數字, "category": 分類名稱}]}。storePhone請填菜單上印的訂餐/外送電話號碼(通常在店名附近，可能有區碼或分機)，看不到就填null。category請填菜單上原本印刷的分類標題(例如「漢堡類」「蛋餅類」「現烤吐司」「丹麥系列」「貝果系列」「飲料類」等)，同一分類底下的品項category要填一樣的文字；如果整張菜單完全看不出分類，全部填"其他"。若同一品項有多種規格或價格(例如大杯/小杯、半份/全份)，請拆成多個獨立品項並在名稱後方註明規格，這些規格通常屬於同一個category。價格看不清楚或無法判斷時，不要加入該品項。金額只寫數字，不要加NT$或逗號或任何文字。',
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "請辨識這張菜單圖片，找出店名、品項與金額，只回傳JSON。" },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return jsonError(`Anthropic API 回應錯誤 (${response.status})：${errText.slice(0, 300)}`, 502);
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      console.error("Anthropic 回應沒有文字內容，完整回應：", JSON.stringify(data));
      return jsonError(
        `AI 沒有回傳可用內容。【除錯用】完整回應：${JSON.stringify(data).slice(0, 800)}`,
        502
      );
    }
    let clean = textBlock.text.trim();
    clean = clean.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    // 保險起見：如果 AI 在 JSON 前後多加了說明文字，抓出第一個 { 到最後一個 } 之間的內容再解析
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const repaired = tryRepairTruncatedMenu(textBlock.text);
      if (repaired) {
        return NextResponse.json(repaired);
      }
      console.error("AI 回傳內容無法解析為 JSON，原始內容：", textBlock.text);
      return jsonError(
        `AI 回傳格式不是有效的 JSON。【除錯用】AI 原始回應：${textBlock.text.slice(0, 800)}`,
        502
      );
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      console.error("AI 回傳的 JSON 缺少 items 陣列，原始內容：", textBlock.text);
      return jsonError(
        `格式不符預期。【除錯用】AI 原始回應：${textBlock.text.slice(0, 800)}`,
        502
      );
    }
    return NextResponse.json(parsed);
  });
}
