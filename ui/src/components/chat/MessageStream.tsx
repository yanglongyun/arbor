// 消息流 —— 按轮收纳:
//   · 一条进邮箱的消息(用户消息 / agent 来信 / 回信)起一轮;
//     轮内的思考 / 工具 / 中间文本是过程,最后那条正文是结果。
//   · 轮完成且有最终文本 → 过程整体收进「已工作X」折叠条,最终文本站在外面;
//   · 轮还在进行中(或没有最终文本,比如中途停掉)→ 平铺,过程依次直播;
//   · 用户消息右侧灰底气泡;agent 来信 / 子 agent 回信保留 Arbor 的居中卡片;
//     助理最终文本无气泡全宽 markdown,悬停出现复制钮,最后一条常显。
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, PhoneCall, Sparkles } from "lucide-react";

import { renderMarkdown } from "../../lib/markdown";
import { TurnEntries, TurnFold, Working, type TurnEntry } from "./Process";
import { stripCallResultPrefix, type Row } from "./thread";

const dayLabel = (at?: number) => {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

type Block =
  | { kind: "day"; key: string; label: string }
  | { kind: "row"; key: string; row: Row; final?: boolean }
  | { kind: "flat"; key: string; items: TurnEntry[] }
  | { kind: "turn"; key: string; items: TurnEntry[]; durationMs: number | null };

export function MessageStream({ rows, busy, tick, viewSeq }: {
  rows: Row[];
  busy: boolean;
  tick: number;
  viewSeq: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 「粘底」:贴着底部时任何高度变化都跟着走;用户上滚就不打扰,滚回底部重新粘上
  const stick = useRef(true);

  const blocks = useMemo<Block[]>(() => {
    const output: Block[] = [];
    let lastDay = "";

    let entries: TurnEntry[] = [];
    let turnStartAt: number | undefined;
    let turnLastAt: number | undefined;
    let turnKey = "__head__";

    const noteAt = (at?: number) => { if (at) turnLastAt = at; };

    /** 收掉当前这轮。live = 最后一轮且还在跑。 */
    const flushTurn = (live: boolean) => {
      if (!entries.length) { turnStartAt = undefined; turnLastAt = undefined; return; }
      const list = entries;
      entries = [];

      let finalIndex = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].kind === "text" && !list[i].row.streaming) { finalIndex = i; break; }
      }
      if (live || finalIndex < 0) {
        output.push({ kind: "flat", key: `flat:${turnKey}`, items: list });
      } else {
        const final = list[finalIndex];
        const process = list.filter((_, index) => index !== finalIndex);
        if (process.length) {
          const durationMs = turnStartAt && turnLastAt && turnLastAt > turnStartAt ? turnLastAt - turnStartAt : null;
          output.push({ kind: "turn", key: `turn:${turnKey}`, items: process, durationMs });
        }
        output.push({ kind: "row", key: final.row.key, row: final.row, final: true });
      }
      turnStartAt = undefined;
      turnLastAt = undefined;
    };

    for (const row of rows) {
      const day = dayLabel(row.at);
      if (day && day !== lastDay) {
        flushTurn(false); // 换天先收上一轮,日期条不站在折叠条中间
        output.push({ kind: "day", key: `day:${row.key}`, label: day });
        lastDay = day;
      }

      if (row.kind === "user") {
        flushTurn(false);
        turnKey = row.key;
        turnStartAt = row.at;
        output.push({ kind: "row", key: row.key, row });
        continue;
      }
      if (row.kind === "tool") {
        entries.push({ kind: "tool", row });
        noteAt(row.at);
        continue;
      }
      if (row.kind === "assistant") {
        // 同一行可能既有思考又有正文 —— 思考属于过程,正文属于文本
        if (row.reasoning) entries.push({ kind: "think", row });
        if (row.content) entries.push({ kind: "text", row });
        noteAt(row.at);
        continue;
      }
      // 系统留痕独立成块,不搅进轮里
      flushTurn(false);
      output.push({ kind: "row", key: row.key, row });
    }
    flushTurn(busy);
    return output;
    // tick 是「行内容原地变过」的信号,必须进依赖,否则流式不重算
  }, [rows, busy, tick]);

  // 最后那条最终文本:复制钮常显(其余悬停出现)
  const lastFinalKey = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.kind === "row" && block.final) return block.key;
    }
    return "";
  }, [blocks]);

  const showWorking = useMemo(() => {
    if (!busy) return false;
    const last = rows[rows.length - 1];
    // 正文在流式输出,或过程行自己带着扫光 —— 都轮不到等待动画
    if (last && last.kind === "assistant" && last.streaming && last.content) return false;
    if (last && last.kind === "tool" && last.status === "running") return false;
    return true;
  }, [busy, rows, tick]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  useEffect(() => {
    const element = scrollRef.current;
    const inner = innerRef.current;
    if (!element || !inner) return;
    element.scrollTop = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // 切智能体 / 自己发消息:强制回底并重新粘上
  useEffect(() => {
    stick.current = true;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [viewSeq]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" onScroll={onScroll}>
      <div ref={innerRef} className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-5 pb-3 flex flex-col overflow-x-hidden">
        {!rows.length && !busy && (
          <div className="text-text-faint text-[14px]">发条消息,开始这段对话…</div>
        )}

        {blocks.map((block) => {
          if (block.kind === "day") {
            return <span key={block.key} className="self-center mt-4 mb-2 text-[11px] font-medium text-text-faint">{block.label}</span>;
          }
          if (block.kind === "flat") {
            return <div key={block.key} className="pb-3 flex flex-col gap-1.5 w-full min-w-0"><TurnEntries items={block.items} /></div>;
          }
          if (block.kind === "turn") {
            return (
              <div key={block.key} className="pb-3 w-full min-w-0">
                <TurnFold durationMs={block.durationMs}>
                  <TurnEntries items={block.items} />
                </TurnFold>
              </div>
            );
          }
          return <ChatRow key={block.key} row={block.row} always={block.key === lastFinalKey && !busy} />;
        })}

        {showWorking && <div className="pb-3"><Working /></div>}
      </div>
    </div>
  );
}

/* ── 单行渲染:用户消息的四种邮箱形态 / 助理最终文本 / 系统留痕 ── */

function CopyButton({ text, always }: { text: string; always: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`mt-1 -ml-1 flex items-center transition-opacity ${always ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}>
      <button
        title="复制"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="w-7 h-7 rounded flex items-center justify-center text-text-faint hover:bg-bg-hover hover:text-text-dim transition-colors"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function ChatRow({ row, always }: { row: Row; always: boolean }) {
  if (row.kind === "user") {
    if (row.source === "call_result") {
      return (
        <div className="flex justify-center pb-3 pt-1">
          <div className="w-full max-w-2xl rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles size={12} className="text-accent" />
              <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">子 agent 回信</span>
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(stripCallResultPrefix(row.content || "")) }} />
          </div>
        </div>
      );
    }
    if (row.source === "call") {
      return (
        <div className="flex justify-center pb-3 pt-1">
          <div className="w-full max-w-2xl rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <PhoneCall size={12} className="text-warning" />
              <span className="text-[11px] font-semibold text-warning uppercase tracking-wider">来自 agent 的消息</span>
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.content || "") }} />
          </div>
        </div>
      );
    }
    if (row.source === "compaction") {
      return (
        <div className="flex justify-center pb-3">
          <details className="w-full max-w-2xl rounded-md border border-border bg-white overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-text-dim hover:bg-bg-hover">上下文压缩摘要</summary>
            <pre className="border-t border-border bg-bg-panel px-3 py-2 text-[12px] leading-relaxed text-text-dim whitespace-pre-wrap break-words max-h-72 overflow-auto">{row.content}</pre>
          </details>
        </div>
      );
    }
    return (
      <div className="flex justify-end pb-3 pt-1">
        <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] px-4 py-2.5 text-[15px] bg-bg-panel text-text leading-relaxed whitespace-pre-wrap break-words select-text cursor-text">
          {row.content}
        </div>
      </div>
    );
  }

  if (row.kind === "assistant") {
    return (
      <div className="group/msg pb-3 flex flex-col items-start w-full min-w-0">
        <div className="prose w-full min-w-0" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.content || "") }} />
        <CopyButton text={row.content || ""} always={always} />
      </div>
    );
  }

  // chip:系统留痕
  const bad = row.code === "error";
  return (
    <span className={[
      "self-center my-2 px-3 py-1 rounded-full text-[11.5px] font-medium max-w-full truncate",
      bad ? "bg-danger/10 text-danger" : "bg-bg-panel text-text-faint",
    ].join(" ")}
    >
      {row.code === "stopped" ? "已停止" : row.content}
    </span>
  );
}
