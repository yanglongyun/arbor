// 对话面板:一个智能体的邮箱 + 输入器。
// 行数组是可变结构(流式原地改行,tick 触发重渲染),事件按 agentId 认领 ——
// 同一面板体系下,几个智能体各开各的标签互不干扰,切走的运行在服务端继续转。
import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, Send, Settings, Square } from "lucide-react";

import type { Node } from "../../api";
import { api } from "../../api";
import { EVENTS } from "../../../../server/shared/events";
import { MessageStream } from "./MessageStream";
import { setupStream } from "./stream";
import { mkKey, renderRows, type Row } from "./thread";

export function ChatPanel({
  node,
  onSelect: _onSelect,
  socket,
  onOpenNav: _onOpenNav,
  onOpenSettings,
}: {
  node: Node;
  onSelect: (n: Node) => void;
  socket: { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };
  onOpenNav?: () => void;
  onOpenSettings?: () => void;
}) {
  // 可变行数组 + tick:流式增量不换数组,只改行再摇铃
  const rowsRef = useRef<Row[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(node.status === "running");
  const [viewSeq, setViewSeq] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [configured, setConfigured] = useState(true); // 先假设已配置,避免初次闪现引导
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const bump = useCallback(() => setTick((n) => n + 1), []);
  const pushRow = useCallback((row: Row) => { rowsRef.current.push(row); return row; }, []);

  // 没配模型的话发消息会一片空白 → 显示引导
  useEffect(() => {
    api.getSettings()
      .then((r) => { const s = r.settings || ({} as any); setConfigured(!!(s.model && s.apiUrl)); })
      .catch(() => {});
  }, [node.id]);

  // 工作目录芯片:标签页恢复的 node 可能没带 workdir,补拉一次
  const [workdir, setWorkdir] = useState(node.workdir || "");
  useEffect(() => {
    setWorkdir(node.workdir || "");
    if (!node.workdir) api.getAgent(node.id).then((r) => setWorkdir(r.node.workdir || "")).catch(() => {});
  }, [node.id]);
  const shortWorkdir = workdir.replace(/^\/Users\/[^/]+/, "~");

  const refresh = useCallback(async () => {
    const result = await api.listMessages(node.id).catch(() => null);
    if (!result) return;
    const next = renderRows(result.rows || []);
    // 同位置同类的行复用旧 key:React 原地复用 DOM,不整屏重挂
    const prev = rowsRef.current;
    for (let i = 0; i < next.length && i < prev.length; i++) {
      if (next[i].kind === prev[i].kind) next[i].key = prev[i].key;
    }
    rowsRef.current = next;
    bump();
  }, [node.id, bump]);

  // 草稿按智能体落 localStorage,切走再回来不丢
  const draftKey = `arbor.draft:${node.id}`;
  useEffect(() => {
    try { setPrompt(localStorage.getItem(draftKey) || ""); } catch { setPrompt(""); }
  }, [node.id]);
  const persistDraft = (value: string) => {
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch { /* 私隐模式存不了就算了 */ }
  };

  // 流 reducer 跟着 node.id 走
  const streamRef = useRef<ReturnType<typeof setupStream> | null>(null);
  useEffect(() => {
    rowsRef.current = [];
    setBusy(node.status === "running");
    bump();
    streamRef.current = setupStream({
      agentId: node.id,
      getRows: () => rowsRef.current,
      pushRow,
      setBusy,
      refresh: () => { void refresh(); },
      bump,
    });
    void refresh().then(() => setViewSeq((n) => n + 1));
    // busy 以服务端为准对一次账(node.status 可能是十秒前的)
    void api.listRuns().then((r) => setBusy((r.ids || []).includes(node.id))).catch(() => {});
    api.markAgentRead(node.id).catch(() => {});
    return () => { streamRef.current = null; };
  }, [node.id]);

  // 订阅对话事件(广播全量,reducer 按 agentId 认领)
  useEffect(() => {
    const names = Object.values(EVENTS) as string[];
    const offs = names.map((name) => socket.on(name, (payload: any) => {
      streamRef.current?.onEvent(payload);
      if (name === EVENTS.INPUT && payload.agentId === node.id) api.markAgentRead(node.id).catch(() => {});
    }));
    return () => { offs.forEach((off) => off()); };
  }, [node.id, socket]);

  // 自动撑高
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = Math.min(element.scrollHeight, 240) + "px";
  }, [prompt]);

  const send = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!configured) { onOpenSettings?.(); return; }
    setPrompt("");
    persistDraft("");
    // 乐观入画;服务端广播回来的那份由 reducer 跳过一次
    pushRow({ key: mkKey("u"), kind: "user", source: "user", content: text, at: Date.now() });
    streamRef.current?.armLocalEcho();
    setBusy(true);
    setViewSeq((n) => n + 1);
    bump();
    socket.send({ type: "send", agentId: node.id, prompt: text });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-bg">
      {/* 工作目录芯片:这段对话住在哪个文件夹;点击去文件树里定位它 */}
      {workdir && (
        <div className="shrink-0 flex items-center px-4 md:px-8 py-1.5 border-b border-border bg-bg-raised/60">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("arbor:reveal-path", { detail: { path: workdir } }))}
            title={`工作目录:${workdir}\n点击在文件树中定位`}
            className="inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded text-[12px] text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
          >
            <Folder size={12} className="shrink-0 text-accent" />
            <span className="truncate font-mono">{shortWorkdir}</span>
          </button>
        </div>
      )}
      <MessageStream rows={rowsRef.current} busy={busy} tick={tick} viewSeq={viewSeq} />

      {/* 输入区 — 固定底部 */}
      <div className="p-4 md:p-6 border-t border-border bg-bg">
        {!configured && (
          <div className="flex items-center gap-1.5 mb-2 text-[12.5px] text-warning">
            <Settings size={13} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate">还没配置模型,智能体无法运行。</span>
            <button onClick={() => onOpenSettings?.()} className="shrink-0 font-medium hover:underline">
              去设置 →
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-border bg-white px-3 py-2 focus-within:border-accent transition-colors">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 bg-transparent text-[15px] text-text placeholder:text-text-faint outline-none resize-none leading-relaxed py-1 overflow-y-auto"
            placeholder="发送消息… (Enter 发送 · Shift+Enter 换行)"
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); persistDraft(e.target.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(e) => {
              // 中文/日文/韩文 IME 组词期间(选词按 Enter)不触发 send
              if (composingRef.current || (e.nativeEvent as any).isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          {busy ? (
            <button
              title="停止"
              onClick={() => socket.send({ type: "stop", agentId: node.id })}
              className="w-8 h-8 rounded flex items-center justify-center text-text-faint hover:text-danger hover:bg-bg-hover transition-colors shrink-0"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              title="发送"
              onClick={send}
              disabled={!prompt.trim()}
              className="w-8 h-8 rounded flex items-center justify-center bg-accent text-white hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
