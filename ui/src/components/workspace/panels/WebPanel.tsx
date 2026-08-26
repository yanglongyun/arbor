// 网页标签:Electron 壳里是真 <webview>(真会话、真登录态);
// 纯浏览器里没有这个标签,给一块诚实的兜底(日常站点普遍禁 iframe,不装能行)。
// 面板由 WorkspaceGroup 常驻挂载、CSS 控显隐 —— 卸载 = 断网重载,登录态全丢。
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Globe, RotateCw } from "lucide-react";
import type { WebTab } from "../types";

const IN_ELECTRON = navigator.userAgent.includes("Electron");

const normalizeInput = (raw: string) => {
  const value = raw.trim();
  if (!value) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
};

export function WebPanel({ tab, onPatch }: {
  tab: WebTab;
  onPatch: (patch: Partial<Pick<WebTab, "title" | "url">>) => void;
}) {
  const viewRef = useRef<HTMLElement | null>(null);
  const [address, setAddress] = useState(tab.url);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  // webview 事件:标题/地址跟着页面走,标签栏与地址栏同步
  useEffect(() => {
    const view = viewRef.current as any;
    if (!view) return;
    const onTitle = (e: any) => { if (e.title) onPatch({ title: e.title }); };
    const onNavigate = (e: any) => {
      if (!e.url) return;
      setEditing((editing) => { if (!editing) setAddress(e.url); return editing; });
      onPatch({ url: e.url });
    };
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    view.addEventListener("page-title-updated", onTitle);
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    return () => {
      view.removeEventListener("page-title-updated", onTitle);
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
    };
  }, [onPatch]);

  const go = () => {
    const url = normalizeInput(address);
    if (!url) return;
    setEditing(false);
    (viewRef.current as any)?.loadURL?.(url);
  };

  const openExternal = () => window.open(tab.url, "_blank");

  if (!IN_ELECTRON) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <Globe size={28} className="text-text-faint" />
        <div className="text-[14px] text-text">网页标签需要在桌面壳(Electron)里打开</div>
        <div className="text-[12px] text-text-faint max-w-md truncate font-mono">{tab.url}</div>
        <button
          onClick={openExternal}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
        >
          <ExternalLink size={13} /> 在浏览器打开
        </button>
      </div>
    );
  }

  const navBtn = "w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-30";

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* 工具栏:后退 / 前进 / 刷新 / 地址 / 复制 / 系统浏览器 */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
        <button className={navBtn} title="后退" onClick={() => (viewRef.current as any)?.goBack?.()}><ArrowLeft size={14} /></button>
        <button className={navBtn} title="前进" onClick={() => (viewRef.current as any)?.goForward?.()}><ArrowRight size={14} /></button>
        <button className={navBtn} title="刷新" onClick={() => (viewRef.current as any)?.reload?.()}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => { setEditing(true); e.target.select(); }}
          onBlur={() => { setEditing(false); setAddress(tab.url); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { go(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setEditing(false); setAddress(tab.url); (e.target as HTMLInputElement).blur(); }
          }}
          spellCheck={false}
          className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-white text-[12.5px] font-mono text-text-dim focus:text-text focus:border-accent outline-none transition-colors"
        />
        <button className={navBtn} title="复制链接" onClick={() => navigator.clipboard.writeText(tab.url).catch(() => {})}><Copy size={13} /></button>
        <button className={navBtn} title="在系统浏览器打开" onClick={openExternal}><ExternalLink size={13} /></button>
      </div>
      <webview
        ref={(el) => { viewRef.current = el; }}
        src={tab.url}
        className="flex-1 min-h-0"
        style={{ display: "flex" }}
      />
    </div>
  );
}
