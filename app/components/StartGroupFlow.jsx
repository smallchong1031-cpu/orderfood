"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { api } from "./api";
import { getMyName, setMyName } from "./identity";

/**
 * 一鍵開團頁面：/menus/{id}/start
 * 有人點這條網址時：
 *  - 還沒設定過稱呼 → 先問稱呼
 *  - 已經有稱呼 → 直接呼叫「加入或開團」，然後跳到那一團
 */
export default function StartGroupFlow({ menuId, storeName }) {
  const router = useRouter();
  const [me, setMe] = useState(undefined);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    setMe(getMyName());
  }, []);

  useEffect(() => {
    if (!me || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await api.startGroup(menuId, { creatorName: me });
        router.replace(`/groups/${res.group.id}`);
      } catch (e) {
        setError(e.message || "開團失敗，請稍後再試");
        startedRef.current = false;
      }
    })();
  }, [me, menuId, router]);

  const submitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setMe(trimmed);
  };

  if (me === undefined) {
    return (
      <div className="goa-root flex items-center justify-center" style={{ minHeight: "100vh" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--ink-soft)" }} />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="goa-root flex items-center justify-center p-6" style={{ minHeight: "100vh" }}>
        <div className="goa-card goa-pop w-full p-7 flex flex-col items-center gap-4" style={{ maxWidth: 360 }}>
          <div className="goa-logo goa-display" style={{ width: 56, height: 56, fontSize: 24 }}>揪</div>
          <div className="text-center">
            <div className="goa-display font-black text-xl">{storeName || "揪呷團"}</div>
            <div className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>先輸入你的稱呼，就可以開始點餐</div>
          </div>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitName()}
            placeholder="例如：阿強"
            className="goa-input w-full rounded-xl px-3 py-2.5"
            maxLength={12}
            autoFocus
          />
          <button
            onClick={submitName}
            disabled={!nameDraft.trim()}
            className="goa-btn-primary w-full rounded-xl py-2.5 font-bold"
          >
            進入點餐
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="goa-root flex items-center justify-center p-6" style={{ minHeight: "100vh" }}>
      <div className="flex flex-col items-center gap-3">
        {error ? (
          <div className="goa-card p-4 flex flex-col items-center gap-3" style={{ maxWidth: 340 }}>
            <div className="flex items-start gap-2 text-sm" style={{ color: "var(--stamp-dark)" }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button onClick={() => router.replace("/")} className="goa-btn-outline rounded-xl px-4 py-2 text-sm font-bold">
              回首頁
            </button>
          </div>
        ) : (
          <>
            <Loader2 className="animate-spin" style={{ color: "var(--stamp)" }} size={28} />
            <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
              正在準備 {storeName || ""} 的揪團…
            </div>
          </>
        )}
      </div>
    </div>
  );
}
