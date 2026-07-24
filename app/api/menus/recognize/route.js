import { NextResponse } from "next/server";
import { withErrorHandling, jsonError } from "@/lib/apiHelpers";

// 選用模型：claude-sonnet-5 準確度較高；claude-haiku-4-5-20251001 較便宜、速度較快。
const MODEL = "claude-sonnet-5";

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
        max_tokens: 1000,
        system:
          '你是菜單辨識引擎。只能輸出純JSON物件，不可有任何前言、說明文字或markdown符號(例如```)。格式:{"storeName": 店名字串或null, "items": [{"name": 品項名稱, "price": 數字}]}。若同一品項有多種規格或價格(例如大杯/小杯、半份/全份)，請拆成多個獨立品項並在名稱後方註明規格。價格看不清楚或無法判斷時，不要加入該品項。金額只寫數字，不要加NT$或逗號或任何文字。',
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
      return jsonError("AI 沒有回傳可用內容", 502);
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