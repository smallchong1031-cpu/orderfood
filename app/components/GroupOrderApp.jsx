"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, Minus, ChevronLeft, Loader2, Users, Receipt,
  Check, Store, RefreshCw, Eye, EyeOff, AlertCircle, Sparkles,
  UserRound, Lock, ImagePlus, Trash2, PencilLine, Wallet, QrCode,
  Circle, CheckCircle2, Share2, Upload,
} from "lucide-react";
import { api } from "./api";
import { getMyName, setMyName } from "./identity";

/* ============================== helpers ============================== */

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const currency = (n) => `NT$ ${Number(n || 0).toLocaleString("zh-TW")}`;

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
  const [contact, setContact] = useState("");
  const [qrImage, setQrImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await api.getPaymentProfile(me);
        if (!alive) return;
        setContact(p?.contact || "");
        setQrImage(p?.qrImage || null);
        setSavedAt(p?.updatedAt || null);
      } catch (e) {
        if (alive) setError(e.message || "讀取失敗");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [me]);

  const pickQrFile = async (f) => {
    if (!f) return;
    setError("");
    try {
      const { previewUrl } = await resizeImageToBase64(f, 500);
      setQrImage(previewUrl);
    } catch (e) {
      setError(e.message || "圖片讀取失敗");
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await api.savePaymentProfile(me, { contact: contact.trim() || null, qrImage: qrImage || null });
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
      setContact("");
      setQrImage(null);
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
          <span>設定好之後，只要你被指定為某一團的付款人，這裡的收款方式跟 QR Code 就會自動出現在那團的收據上，不用每次重新上傳。</span>
        </div>

        <div className="goa-card p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>收款方式（例如 LINE Pay 轉帳代碼、銀行帳戶）</label>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="goa-input w-full rounded-xl px-3 py-2 text-sm mt-1"
              placeholder="例如：LINE Pay 轉帳代碼 123456"
            />
          </div>
          <div>
            <label className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--ink-soft)" }}>
              <QrCode size={12} /> 收款 QR Code（可上傳 LINE Pay 個人收款碼截圖）
            </label>
            {!qrImage ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="goa-card w-full flex flex-col items-center justify-center gap-1 py-8 mt-1"
                style={{ borderStyle: "dashed" }}
              >
                <ImagePlus size={22} style={{ color: "var(--stamp)" }} />
                <span className="text-xs font-bold">點此上傳收款 QR Code 截圖</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 mt-1">
                <img src={qrImage} alt="收款 QR Code 預覽" className="rounded-lg" style={{ width: 88, height: 88, objectFit: "contain", background: "#fff", border: "1px solid var(--line)" }} />
                <div className="flex flex-col gap-1.5 flex-1">
                  <button onClick={() => fileInputRef.current?.click()} className="goa-btn-outline rounded-lg py-1.5 text-xs font-bold">重新上傳</button>
                  <button onClick={() => setQrImage(null)} className="text-xs font-bold" style={{ color: "var(--stamp)" }}>移除這張圖片</button>
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickQrFile(e.target.files?.[0])} />
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
        <div className="grid grid-cols-2 gap-3">
          {menus.map((m) => (
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
}

/* ============================== Upload Flow ============================== */

function UploadMenuFlow({ onBack, onSaved, existingMenu }) {
  const isEditMode = !!existingMenu;
  const [preview, setPreview] = useState(existingMenu?.image || null);
  const [pending, setPending] = useState(null);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [storeName, setStoreName] = useState(existingMenu?.storeName || "");
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
    try {
      const result = await api.recognizeMenu({ base64: pending.base64, mediaType: pending.mediaType });
      setStoreName((prev) => result.storeName || prev);
      setItems(
        (result.items || []).map((it) => ({
          id: uid("it"),
          name: it.name || "未命名品項",
          price: Number(it.price) || 0,
        }))
      );
    } catch (e) {
      setError("辨識失敗，可以重試，或手動輸入品項：" + (e.message || ""));
    } finally {
      setRecognizing(false);
    }
  };

  const updateItem = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));
  const addBlankItem = () => setItems((prev) => [...prev, { id: uid("it"), name: "", price: 0 }]);

  const canSave = storeName.trim() && items.length > 0 && items.every((it) => it.name.trim());

  const save = async () => {
    setSaving(true);
    setError("");
    const payload = {
      storeName: storeName.trim(),
      items: items.map((it) => ({ id: it.id, name: it.name.trim(), price: Number(it.price) || 0 })),
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
            <div className="goa-divider pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>品項與金額（可修改）</span>
                <button onClick={addBlankItem} className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--stamp)" }}>
                  <Plus size={13} /> 新增品項
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <input
                      value={it.name}
                      onChange={(e) => updateItem(it.id, { name: e.target.value })}
                      placeholder="品項名稱"
                      className="goa-input flex-1 rounded-lg px-2.5 py-2 text-sm"
                    />
                    <input
                      value={it.price}
                      onChange={(e) => updateItem(it.id, { price: e.target.value.replace(/[^0-9]/g, "") })}
                      inputMode="numeric"
                      placeholder="0"
                      className="goa-input goa-mono rounded-lg px-2.5 py-2 text-sm text-right"
                      style={{ width: 76 }}
                    />
                    <button onClick={() => removeItem(it.id)} className="p-1.5 shrink-0" style={{ color: "var(--ink-soft)" }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-sm text-center py-4" style={{ color: "var(--ink-soft)" }}>尚無品項，請先辨識或手動新增</div>
                )}
              </div>
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
  const me = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const doc = await api.getMenu(menuId);
        setMenu(doc);
        if (doc) setGroupName(`${doc.storeName} 午餐揪團`);
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
          <button
            onClick={() => onUpdateMenu(menu)}
            className="text-xs font-bold px-2 py-1 flex items-center gap-1"
            style={{ color: "var(--ink-soft)" }}
          >
            <Upload size={13} /> 更新菜單
          </button>
        }
      />
      <div className="px-4 flex flex-col gap-3">
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
          {menu.items.map((it, i) => (
            <div key={it.id} className={`flex items-center justify-between py-2.5 ${i > 0 ? "goa-divider" : ""}`}>
              <span className="text-sm">{it.name}</span>
              <span className="goa-mono font-bold text-sm">{currency(it.price)}</span>
            </div>
          ))}
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
  const closed = groups.filter((g) => g.status !== "open");
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
    </div>
  );
}

/* ============================== Receipt (closed group) ============================== */

function ReceiptView({ group, me, canEdit, onGroupUpdated, onGoToProfile, onDeleteGroup }) {
  const [expanded, setExpanded] = useState({});
  const [editingPayer, setEditingPayer] = useState(false);
  const [payerDraft, setPayerDraft] = useState("");
  const [savingPayer, setSavingPayer] = useState(false);
  const [profile, setProfile] = useState(undefined);
  const [togglingPerson, setTogglingPerson] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const entries = Object.entries(group.memberOrders || {});
  const grandTotal = entries.reduce((s, [, o]) => s + (o.total || 0), 0);
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

  const displayContact = profile?.contact || group.payerContact || null;
  const displayQr = profile?.qrImage || group.payerQrImage || null;

  return (
    <div className="px-4">
      <div className="receipt-ticket rounded-2xl p-5 flex flex-col gap-4 goa-pop" style={{ marginTop: 4, marginBottom: 4 }}>
        <div className="flex items-center justify-between">
          <div className="goa-display font-black text-lg">{group.groupName}</div>
          <span className="stamp-badge text-xs">已結單</span>
        </div>
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{group.storeName}・共 {entries.length} 人</div>

        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "var(--till-bg)" }}>
          {!editingPayer ? (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--till)" }}>
                <Wallet size={15} /> 請把錢轉給付款人：{payerName}
              </span>
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
              <input
                value={payerDraft}
                onChange={(e) => setPayerDraft(e.target.value)}
                className="goa-input rounded-xl px-3 py-2 text-sm"
                autoFocus
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
          ) : displayContact || displayQr ? (
            <>
              {displayContact && (
                <input
                  readOnly
                  value={displayContact}
                  onFocus={(e) => e.target.select()}
                  className="goa-mono text-xs rounded-lg px-2 py-1.5 w-full"
                  style={{ background: "#FFFFFF", border: "1px dashed var(--till)", color: "var(--till)" }}
                />
              )}
              {displayQr && (
                <div className="flex flex-col items-center gap-1 pt-1">
                  <img src={displayQr} alt="付款人收款 QR Code" className="rounded-lg" style={{ width: 160, height: 160, objectFit: "contain", background: "#fff" }} />
                  <span className="text-xs flex items-center gap-1" style={{ color: "var(--till)" }}>
                    <QrCode size={12} /> 用 LINE 或行動支付掃描這組碼直接付款
                  </span>
                </div>
              )}
            </>
          ) : isMe ? (
            <button onClick={onGoToProfile} className="text-xs font-bold flex items-center justify-center gap-1.5 py-2" style={{ color: "var(--stamp)" }}>
              <Wallet size={13} /> 你還沒設定收款資料，點此立即設定
            </button>
          ) : (
            <div className="text-xs text-center py-1" style={{ color: "var(--ink-soft)" }}>付款人尚未提供收款資料，請直接私訊詢問</div>
          )}
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
          {entries.map(([person, order]) => (
            <div key={person}>
              <div className="flex items-center justify-between w-full gap-2">
                {isMe ? (
                  <button
                    onClick={() => togglePaid(person)}
                    disabled={togglingPerson === person}
                    className="p-0.5 shrink-0"
                    style={{ color: paidStatus[person] ? "var(--till)" : "var(--ink-soft)" }}
                    aria-label={paidStatus[person] ? "標記為未付款" : "標記為已付款"}
                  >
                    {togglingPerson === person ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : paidStatus[person] ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Circle size={16} />
                    )}
                  </button>
                ) : paidStatus[person] ? (
                  <CheckCircle2 size={16} style={{ color: "var(--till)" }} className="shrink-0" />
                ) : (
                  <Circle size={16} style={{ color: "var(--line)" }} className="shrink-0" />
                )}
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [person]: !p[person] }))}
                  className="flex items-center justify-between flex-1 min-w-0"
                >
                  <span className="flex items-center gap-1.5 font-bold text-sm truncate">
                    <UserRound size={14} style={{ color: "var(--stamp)" }} className="shrink-0" /> {person}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="goa-mono font-black text-base">{currency(order.total)}</span>
                    {expanded[person] ? <EyeOff size={14} /> : <Eye size={14} style={{ color: "var(--ink-soft)" }} />}
                  </span>
                </button>
              </div>
              {expanded[person] && (
                <div className="mt-1.5 pl-7 flex flex-col gap-1">
                  {(order.items || []).map((it) => (
                    <div key={it.itemId} className="flex items-center justify-between text-xs" style={{ color: "var(--ink-soft)" }}>
                      <span>{it.name} × {it.qty}{it.note ? `（${it.note}）` : ""}</span>
                      <span className="goa-mono">{currency(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {entries.length > 0 && (
            <div className="text-xs text-center" style={{ color: "var(--ink-soft)" }}>
              {isMe ? "點左邊的圈圈標記誰已經付款給你" : "圈圈是付款人幫大家標記的付款狀態"}
            </div>
          )}
        </div>

        <div className="goa-divider pt-3 flex items-center justify-between">
          <span className="goa-display font-bold">總計</span>
          <span className="goa-mono font-black text-xl" style={{ color: "var(--stamp)" }}>{currency(grandTotal)}</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5 text-xs pt-1" style={{ color: "var(--ink-soft)" }}>
        <Lock size={12} /> 這團已結單，僅供對帳查看
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-sm p-3 rounded-xl mt-3" style={{ background: "#F5E3DE", color: "var(--stamp-dark)" }}>
          <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{actionError}</span>
        </div>
      )}

      {canEdit && allPaid && (
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

function GroupView({ groupId, me, onBack, onChangedStatus, onGoToProfile }) {
  const [group, setGroup] = useState(null);
  const [menu, setMenu] = useState(null);
  const [myQty, setMyQty] = useState({});
  const [myNotes, setMyNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [payerDraft, setPayerDraft] = useState("");
  const [shareStatus, setShareStatus] = useState("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const menuRef = useRef(null);
  const pollRef = useRef(null);

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
        (mine?.items || []).forEach((it) => { q[it.itemId] = it.qty; n[it.itemId] = it.note || ""; });
        setMyQty(q);
        setMyNotes(n);
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

  const submitOrder = async () => {
    setSaving(true);
    setError("");
    try {
      const items = menu.items
        .filter((it) => (myQty[it.id] || 0) > 0)
        .map((it) => ({ itemId: it.id, name: it.name, price: it.price, qty: myQty[it.id], note: (myNotes[it.id] || "").trim() }));
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

  const isCreator = me === group.creatorName;

  if (group.status === "closed") {
    return (
      <div className="pb-10">
        <TopBar title={group.groupName} subtitle={group.storeName} onBack={onBack} />
        <ReceiptView group={group} me={me} canEdit={isCreator} onGroupUpdated={setGroup} onGoToProfile={onGoToProfile} onDeleteGroup={deleteGroup} />
      </div>
    );
  }

  const members = Object.entries(group.memberOrders || {});

  return (
    <div className="pb-28">
      <TopBar
        title={group.groupName}
        subtitle={`${group.storeName} ・ 發起人 ${group.creatorName}`}
        onBack={onBack}
        right={
          <div className="flex items-center gap-2">
            {shareStatus === "copied" && (
              <span className="text-xs font-bold" style={{ color: "var(--till)" }}>已複製連結</span>
            )}
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
      <div className="px-4 flex items-center gap-2 mb-4 flex-wrap">
        <StatusChip status={group.status} />
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{members.length} 人已點餐</span>
      </div>

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
          {menu.items.map((it, i) => (
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
        </div>

        <div className="goa-card p-4">
          <div className="text-xs font-bold mb-2" style={{ color: "var(--ink-soft)" }}>大家吃什麼</div>
          {members.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: "var(--ink-soft)" }}>目前還沒有人點餐</div>
          ) : (
            members.map(([person, order], i) => (
              <div key={person} className={`py-2.5 ${i > 0 ? "goa-divider" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold text-sm">
                    <UserRound size={13} style={{ color: person === me ? "var(--stamp)" : "var(--ink-soft)" }} />
                    {person}{person === me ? "（我）" : ""}
                  </span>
                  <span className="goa-mono font-bold text-sm">{currency(order.total)}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>
                  {(order.items || []).map((it) => it.note ? `${it.name}×${it.qty}（${it.note}）` : `${it.name}×${it.qty}`).join("、")}
                </div>
              </div>
            ))
          )}
          {members.length > 0 && (
            <>
              <div className="goa-divider pt-3 flex items-center justify-between">
                <span className="text-sm font-bold">目前總計</span>
                <span className="goa-mono font-black text-lg">{currency(members.reduce((s, [, o]) => s + o.total, 0))}</span>
              </div>
              <div className="text-xs text-right mt-1" style={{ color: "var(--ink-soft)" }}>
                付款人會在結單時標註
              </div>
            </>
          )}
        </div>
      </div>

      {isCreator && (
        <div className="fixed left-0 right-0 bottom-0 p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
          {!confirmingClose ? (
            <button
              onClick={() => { setPayerDraft(group.creatorName || me || ""); setConfirmingClose(true); }}
              className="w-full rounded-xl py-3 font-bold flex items-center justify-center gap-2 shadow-lg"
              style={{ background: "var(--ink)", color: "var(--card)" }}
            >
              <Receipt size={16} />
              結單
            </button>
          ) : (
            <div className="goa-card p-3 flex flex-col gap-2 goa-pop shadow-lg">
              <div className="text-sm text-center font-bold">確定要結單嗎？結單後大家就不能再修改點餐了。</div>
              <div>
                <label className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--ink-soft)" }}>
                  <Wallet size={12} /> 這攤是誰付的錢？
                </label>
                <input
                  value={payerDraft}
                  onChange={(e) => setPayerDraft(e.target.value)}
                  className="goa-input w-full rounded-xl px-3 py-2 text-sm mt-1"
                  placeholder="填付款人的稱呼"
                />
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
          )}
        </div>
      )}
    </div>
  );
}

/* ============================== App Root ============================== */

export default function GroupOrderApp() {
  const [me, setMe] = useState(undefined);
  const [nav, setNav] = useState({ screen: "home", tab: "menus" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    setMe(getMyName());
  }, []);

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
              { key: "menus", label: "菜單庫" },
              { key: "groups", label: "揪團" },
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
        <PaymentProfileEditor me={me} onBack={() => setNav({ screen: "home", tab: "menus" })} />
      )}

      {nav.screen === "group" && (
        <GroupView
          groupId={nav.groupId}
          me={me}
          onBack={() => setNav({ screen: "home", tab: "groups" })}
          onChangedStatus={() => setRefreshKey((k) => k + 1)}
          onGoToProfile={() => setNav({ screen: "paymentProfile" })}
        />
      )}
    </div>
  );
}
