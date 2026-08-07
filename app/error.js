"use client";

import { useEffect } from "react";

// 任何畫面發生錯誤時顯示這一頁，把錯誤訊息直接秀出來方便回報，
// 而不是讓整個頁面變成一片空白或瀏覽器的錯誤畫面。
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error("頁面錯誤：", error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", background: "#EDE7D9", padding: 20, fontFamily: "'PingFang TC','Microsoft JhengHei',sans-serif" }}>
      <div style={{ maxWidth: 480, margin: "40px auto", background: "#FFFDF8", border: "1px solid #D5CBB4", borderRadius: 16, padding: 20 }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: "#C23B2E", marginBottom: 8 }}>這個畫面出了點問題</div>
        <div style={{ fontSize: 14, color: "#2B2620", marginBottom: 14 }}>
          可以先按下面「重新載入」試試看。如果一直出現，請把下面這段訊息截圖回報。
        </div>
        <pre style={{
          whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, color: "#9C2E23",
          background: "#F5E3DE", padding: 12, borderRadius: 10, maxHeight: 260, overflow: "auto",
        }}>
          {String(error?.message || error)}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            onClick={() => reset()}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: "#C23B2E", color: "#FFF7EF", fontWeight: 700 }}
          >
            重新載入
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1.5px solid #2B2620", background: "transparent", color: "#2B2620", fontWeight: 700 }}
          >
            回首頁
          </button>
        </div>
      </div>
    </div>
  );
}
