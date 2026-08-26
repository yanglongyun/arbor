import { useState } from "react";
import { ChevronRight, Terminal, Database, Zap, PhoneCall, Loader2, Check, X, Square, ListTree } from "lucide-react";

type Status = "running" | "done" | "error";

export type ToolPair = {
  call: any;     // { id, function: { name, arguments } }
  result: any | null;   // { content, ... } 或 null = running
};

const safeParse = (s: string) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

const iconFor = (name: string) => {
  if (name === "shell") return Terminal;
  if (name === "run_process") return Terminal;
  if (name === "stop_process") return Square;
  if (name === "list_processes" || name === "read_process_output") return ListTree;
  if (name === "sql") return Database;
  if (name === "create_agent") return Zap;
  if (name === "call_agent") return PhoneCall;
  return Terminal;
};

const colorFor = (name: string) => {
  if (name === "shell" || name === "run_process") return "text-success";
  if (name === "stop_process") return "text-danger";
  if (name === "sql") return "text-accent";
  if (name === "create_agent" || name === "call_agent") return "text-warning";
  return "text-text-faint";
};

// 摘要优先级: reason > title > query/command 首行 > agent_id
const summarize = (name: string, args: any) => {
  if (args.reason) return String(args.reason);
  if (name === "create_agent") return String(args.title || "");
  if (name === "call_agent") return `→ ${String(args.agent_id || "").slice(0, 8)} : ${String(args.message || "").slice(0, 50)}`;
  if (name === "sql") return String(args.query || "").split("\n")[0].slice(0, 100);
  if (name === "shell" || name === "run_process") return String(args.command || "").split("\n")[0].slice(0, 100);
  if (name === "stop_process" || name === "read_process_output") return String(args.process_id || "");
  return "";
};

const resultIsError = (text: string) =>
  /^(tool error|sql error|exit code|agent not found|not an agent|refused|invalid|empty query)/i.test(text || "");

export function ToolBlock({ pair }: { pair: ToolPair }) {
  const [expanded, setExpanded] = useState(false);

  const name = pair.call?.function?.name || "tool";
  const args = safeParse(pair.call?.function?.arguments);
  const Ico = iconFor(name);
  const color = colorFor(name);
  const summary = summarize(name, args);

  const resultText = pair.result?.content == null ? "" : String(pair.result.content);
  const status: Status =
    pair.result == null ? "running" :
    resultIsError(resultText) ? "error" : "done";

  // 展开时展示的"参数"(去掉 reason,因为已经在摘要里了)
  const argsForDisplay = { ...args };
  delete argsForDisplay.reason;
  const argsText = Object.keys(argsForDisplay).length
    ? JSON.stringify(argsForDisplay, null, 2)
    : "(no args)";

  return (
    <div className="rounded-md border border-border bg-white overflow-hidden max-w-3xl">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition-colors text-left"
      >
        <ChevronRight
          size={12}
          className={["text-text-faint shrink-0 transition-transform", expanded ? "rotate-90" : ""].join(" ")}
        />
        <Ico size={13} className={`shrink-0 ${color}`} />
        <span className="text-[13px] font-medium text-text shrink-0">{name}</span>
        {summary && (
          <span className="text-[13px] text-text-dim truncate flex-1 font-mono">{summary}</span>
        )}
        <StatusIcon status={status} />
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="px-3 py-2 bg-bg-panel">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint mb-1">Arguments</div>
            <pre className="text-[12.5px] text-text-dim font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">{argsText}</pre>
          </div>
          {pair.result ? (
            <div className="px-3 py-2 border-t border-border bg-bg">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint mb-1">Result</div>
              <pre className="text-[12.5px] text-text-dim font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed max-h-72 overflow-y-auto">{resultText.slice(0, 8000) || "(empty)"}</pre>
            </div>
          ) : (
            <div className="px-3 py-2 border-t border-border bg-bg flex items-center gap-2">
              <Loader2 size={12} className="text-text-faint animate-spin" />
              <span className="text-[12px] text-text-faint">运行中…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "running") {
    return <Loader2 size={12} className="text-text-faint animate-spin shrink-0" />;
  }
  if (status === "error") {
    return (
      <span className="w-4 h-4 rounded-full bg-danger/15 flex items-center justify-center shrink-0">
        <X size={9} className="text-danger" />
      </span>
    );
  }
  return (
    <span className="w-4 h-4 rounded-full bg-success/15 flex items-center justify-center shrink-0">
      <Check size={9} className="text-success" />
    </span>
  );
}
