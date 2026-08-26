import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Message } from "../../api";
import { api } from "../../api";
import { Send, Square, Bot, PhoneCall, Sparkles, Settings } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { ToolBlock, type ToolPair } from "./ToolBlock";

export function ChatPanel({
  node,
  onSelect,
  socket,
  onOpenNav,
  onOpenSettings,
}: {
  node: Node;
  onSelect: (n: Node) => void;
  socket: { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };
  onOpenNav?: () => void;
  onOpenSettings?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");      // 当前正在流式生成的 assistant 文本
  const streamingRef = useRef("");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [configured, setConfigured] = useState(true);  // 先假设已配置,避免初次闪现引导
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false); // 中文 IME 组词中

  // 没配模型的话发消息会一片空白 → 显示引导
  useEffect(() => {
    api.getSettings()
      .then((r) => { const s = r.settings || ({} as any); setConfigured(!!(s.model && s.apiUrl)); })
      .catch(() => {});
  }, [node.id]);

  const loadMessages = useCallback(async () => {
    const result = await api.listMessages(node.id);
    setMessages(result.messages || []);
  }, [node.id]);

  // 切到这个 agent → 立即 mark-read
  useEffect(() => {
    setMessages([]);
    setStreaming("");
    loadMessages();
    api.markNodeRead(node.id).catch(() => {});
  }, [node.id, loadMessages]);

  useEffect(() => {
    socket.send({ type: "subscribe", agentId: node.id });
    const matchesAgent = (p: any) => p.agentId === node.id;
    const offText = socket.on("message", (p: any) => {
      if (!matchesAgent(p)) return;
      if (p.content) {
        streamingRef.current += p.content;
        setStreaming(streamingRef.current);
      }
    });
    const offInput = socket.on("input", (p: any) => {
      if (!matchesAgent(p)) return;
      setMessages((prev) => [...prev, { ...p.message, _meta: p.meta }]);
      api.markNodeRead(node.id).catch(() => {});
    });
    const offToolCalls = socket.on("tool_calls", (p: any) => {
      if (!matchesAgent(p)) return;
      const msg = { role: "assistant", content: streamingRef.current || null, tool_calls: p.toolCalls || [] };
      streamingRef.current = "";
      setStreaming("");
      setMessages((prev) => [...prev, msg as Message]);
    });
    const offToolResults = socket.on("tool_results", (p: any) => {
      if (!matchesAgent(p)) return;
      const toolMessages = (p.results || []).map((r: any) => r.message || { role: "tool", tool_call_id: r.toolCallId, content: r.content || "" });
      setMessages((prev) => [...prev, ...toolMessages]);
    });
    const offDone = socket.on("done", (p: any) => {
      if (!matchesAgent(p)) return;
      setSending(false);
      streamingRef.current = "";
      setStreaming("");
      loadMessages();
      api.markNodeRead(node.id).catch(() => {});
    });
    const offAborted = socket.on("aborted", (p: any) => {
      if (!matchesAgent(p)) return;
      setSending(false);
      streamingRef.current = "";
      setStreaming("");
      loadMessages();
    });
    const offErr = socket.on("error", (p: any) => {
      if (!matchesAgent(p)) return;
      setSending(false);
      streamingRef.current = "";
      setStreaming("");
    });
    return () => {
      offText(); offInput(); offToolCalls(); offToolResults(); offDone(); offAborted(); offErr();
      socket.send({ type: "unsubscribe", agentId: node.id });
    };
  }, [node.id, socket, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 自动撑高:每次 prompt 变化重算 textarea 高度
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = 240; // 最高 ~10 行
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [prompt]);

  const send = () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (!configured) { onOpenSettings?.(); return; } // 没配模型:引导去设置,不空发
    setSending(true);
    setPrompt("");
    socket.send({ type: "send", agentId: node.id, prompt: text });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-bg">
      {/* 滚动区:直接是消息(标题/路径在标签栏里已有,不再重复)*/}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 md:px-12 pt-6 pb-8 flex flex-col gap-4">
          {messages.length === 0 && !sending && (
            <div className="text-text-faint text-[14px]">给这个智能体发条消息…</div>
          )}
          {groupMessages(messages).map((item, i) => (
            <GroupedItem key={item._id || i} item={item} />
          ))}
          {streaming && <StreamingBubble text={streaming} />}
          {sending && !streaming && (
            <div className="flex items-center gap-2 text-text-faint text-[13px]">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              正在思考…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入框 — 固定底部(四边等距内边距) */}
      <div className="p-4 md:p-6 border-t border-border bg-bg">
        {/* 未配置模型:贴着输入框上方的一行轻提示(不再是独立描边卡片) */}
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
            onChange={(e) => setPrompt(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(e) => {
              // 中文/日文/韩文 IME 组词期间(选词按 Enter)不触发 send
              // 三层兜底:React 的 nativeEvent.isComposing / keyCode 229 / 自己维护的 ref
              if (
                composingRef.current ||
                (e.nativeEvent as any).isComposing ||
                e.keyCode === 229
              ) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={sending}
          />
          {sending ? (
            <button
              onClick={() => socket.send({ type: "stop", agentId: node.id })}
              className="w-8 h-8 rounded flex items-center justify-center text-text-faint hover:text-danger hover:bg-bg-hover transition-colors shrink-0"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
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

// ──────────────────────────────────────────────────────────
// 把 messages 按 tool_call_id 配对成渲染项,每个工具单独一条。
// ──────────────────────────────────────────────────────────
type GroupedItem =
  | { _id: string; type: "user"; message: Message }
  | { _id: string; type: "assistant_text"; content: string }
  | { _id: string; type: "compaction"; content: string }
  | { _id: string; type: "tool"; pair: ToolPair };

function groupMessages(messages: Message[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  const pairIdx = new Map<string, ToolPair>(); // tool_call_id -> pair object (mutable)

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      const p = pairIdx.get(String(msg.tool_call_id || ""));
      if (p) p.result = msg;
      continue;
    }

    if (msg.role === "user") {
      if (msg._meta?.kind === "compaction") {
        items.push({ _id: `c:${msg._id}`, type: "compaction", content: String(msg.content || "") });
        continue;
      }
      items.push({ _id: `u:${msg._id}`, type: "user", message: msg });
      continue;
    }

    if (msg.role === "assistant") {
      // 先文本后工具:assistant 通常先说一句,再去调工具(顺序必须文本在前)
      if (msg.content) {
        items.push({ _id: `a:${msg._id}`, type: "assistant_text", content: msg.content });
      }
      const tcs = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (tcs.length > 0) {
        tcs.forEach((tc: any, i: number) => {
          const p: ToolPair = { call: tc, result: null };
          if (tc.id) pairIdx.set(String(tc.id), p);
          items.push({ _id: `t:${msg._id}:${i}`, type: "tool", pair: p });
        });
      }
      continue;
    }
  }
  return items;
}

function GroupedItem({ item }: { item: GroupedItem }) {
  if (item.type === "user") {
    const msg = item.message;
    const meta = msg._meta;
    if (meta?.source === "call_result") {
      // 剥掉后端拼的前缀 [CALL_RESULT from "X" (call#N)]\n,保留正文
      const body = String(msg.content || "").replace(/^\[CALL_RESULT[^\]]*\]\n?/, "");
      return (
        <div className="flex justify-center">
          <div className="w-full max-w-2xl rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles size={12} className="text-accent" />
              <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">子 agent 回信</span>
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
          </div>
        </div>
      );
    }
    if (meta?.source === "call") {
      return (
        <div className="flex justify-center">
          <div className="w-full max-w-2xl rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <PhoneCall size={12} className="text-warning" />
              <span className="text-[11px] font-semibold text-warning uppercase tracking-wider">来自 agent 的消息</span>
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(String(msg.content || "")) }} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-lg px-4 py-2.5 text-[15px] bg-bg-panel text-text leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  if (item.type === "assistant_text") {
    return (
      <div className="flex gap-3 max-w-3xl">
        <div className="w-8 h-8 rounded bg-bg-panel border border-border flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-text-faint" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content) }} />
        </div>
      </div>
    );
  }

  if (item.type === "compaction") {
    return (
      <div className="flex gap-3 max-w-3xl">
        <div className="w-8 h-8 rounded bg-bg-panel border border-border flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-text-faint" />
        </div>
        <details className="flex-1 min-w-0 rounded-md border border-border bg-white overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-text-dim hover:bg-bg-hover">上下文压缩</summary>
          <pre className="border-t border-border bg-bg-panel px-3 py-2 text-[12px] leading-relaxed text-text-dim whitespace-pre-wrap break-words max-h-72 overflow-auto">{item.content}</pre>
        </details>
      </div>
    );
  }

  // tool
  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="w-8 h-8 rounded bg-bg-panel border border-border flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={14} className="text-text-faint" />
      </div>
      <div className="flex-1 min-w-0">
        <ToolBlock pair={item.pair} />
      </div>
    </div>
  );
}

// 流式中的"虚拟"assistant 气泡:实时显示 token 流
function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="w-8 h-8 rounded bg-bg-panel border border-accent/40 flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={14} className="text-accent animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        <span className="inline-block w-1.5 h-4 bg-accent ml-0.5 align-text-bottom animate-pulse" />
      </div>
    </div>
  );
}
