import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getBaseUrl } from "@/lib/lineNotify";

// LINE 設定的健康檢查，用來回答「為什麼結單沒傳訊息」。
// 刻意不回傳完整的群組 ID 和任何金鑰內容，只說有沒有設定、記到幾個群組。
export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const secret = process.env.LINE_CHANNEL_SECRET || "";

  const out = {
    金鑰是否設定: !!token,
    channelSecret是否設定: !!secret,
    網站網址: getBaseUrl() || "（沒有設定 NEXT_PUBLIC_SITE_URL）",
    已記錄的LINE群組數: 0,
    群組: [],
    診斷: [],
  };

  try {
    const rows = await sql`select target_id, target_type, updated_at from line_targets order by updated_at desc`;
    out.已記錄的LINE群組數 = rows.length;
    out.群組 = rows.map((r) => ({
      類型: r.target_type,
      ID末六碼: String(r.target_id).slice(-6),
      最後活動: r.updated_at,
    }));
  } catch (e) {
    out.診斷.push(`讀取 line_targets 失敗：${e?.message || e}（資料表可能還沒建立）`);
  }

  // 金鑰真的能用嗎？問 LINE 要機器人自己的資料，這幾支查詢 API 都不花推播額度。
  if (token) {
    const ask = async (path) => {
      const res = await fetch(`https://api.line.me/v2/bot/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`LINE 回傳 ${res.status}`);
      return res.json();
    };

    try {
      const info = await ask("info");
      out.機器人名稱 = info.displayName || "(未知)";
      out.金鑰可用 = true;
    } catch (e) {
      out.金鑰可用 = false;
      out.診斷.push(`金鑰無法使用（${e?.message || e}），請在 Vercel 重新設定後按 Redeploy。`);
    }

    // 推播則數是最常見的元兇：關鍵字回覆不計費，但結單推帳單是「按收到的人數」算，
    // 推一次到 23 人的群組就扣 23 則。免費版一個月只有 200 則。
    if (out.金鑰可用) {
      try {
        const quota = await ask("message/quota");
        const used = await ask("message/quota/consumption");
        const limit = quota.type === "limited" ? quota.value : null;
        const usedCount = used.totalUsage ?? 0;

        out.本月推播 = {
          方案上限: limit === null ? "無上限（付費方案）" : limit,
          已使用: usedCount,
          剩餘: limit === null ? "—" : Math.max(0, limit - usedCount),
        };

        if (limit !== null) {
          const left = limit - usedCount;
          const groupSize = out.已記錄的LINE群組數 > 0 ? "（每推一張帳單會用掉群組人數那麼多則）" : "";
          if (left <= 0) {
            out.診斷.push(
              `本月推播則數已經用完（${usedCount}/${limit}）。這就是結單沒傳訊息的原因 —— 關鍵字回覆不計費所以還會動，但推播會被 LINE 擋下來。額度每月初重置。`
            );
          } else if (left < 50) {
            out.診斷.push(`本月推播只剩 ${left} 則${groupSize}，快用完了。`);
          }
        }
      } catch (e) {
        out.診斷.push(`查不到推播則數：${e?.message || e}`);
      }
    }
  } else {
    out.診斷.push("伺服器沒有 LINE_CHANNEL_ACCESS_TOKEN，結單一定傳不出去。");
  }

  if (out.已記錄的LINE群組數 === 0) {
    out.診斷.push("還沒記錄到任何群組。請把機器人加進群組，然後在群組裡打一次店名，它才會記住要傳到哪裡。");
  }

  if (out.診斷.length === 0) out.診斷.push("設定看起來正常，結單應該會自動傳訊息。");

  return NextResponse.json(out);
}
