// 过程体系:思考 / 工具各是一行(图标位悬停换 chevron,展开转 90°),
// 相邻的已完成常规工具收成一行摘要,完成的一轮整体收进「已工作X」折叠条。
// 运行中的工具标签走扫光;整轮进行中时底部是转圈 + 「正在工作」。
// create_agent / call_agent 不进分组 —— 多智能体动作是 Arbor 的招牌,永远单独可见。
import { useState, type ReactNode } from "react";
import {
  ChevronRight, FilePlus2, FileText, Globe, ListTree, Loader2,
  Pencil, PhoneCall, Play, ScrollText, Sparkles, Square, Terminal,
} from "lucide-react";

import { renderMarkdown } from "../../lib/markdown";
import type { Row } from "./thread";

/** 一轮里按序排布的条目:过程(思考/工具)与中间文本。 */
export type TurnEntry = { kind: "think" | "tool" | "text"; row: Row };

const basename = (value: unknown) => String(value ?? "").split("/").filter(Boolean).pop() || "";

const toolMeta = (row: Row): { icon: ReactNode; label: string; pill: string; wide: boolean } => {
  const args = row.args || {};
  const summary = String(args.summary ?? "");
  switch (row.name) {
    case "shell":
      return { icon: <Terminal size={14} />, label: "执行", pill: summary || String(args.command ?? ""), wide: true };
    case "run_process":
      return { icon: <Play size={14} />, label: "启动进程", pill: summary || String(args.command ?? ""), wide: true };
    case "list_processes":
      return { icon: <ListTree size={14} />, label: "查看进程", pill: summary, wide: false };
    case "read_process_output":
      return { icon: <ScrollText size={14} />, label: "读进程日志", pill: String(args.process_id ?? "") || summary, wide: false };
    case "stop_process":
      return { icon: <Square size={13} />, label: "停止进程", pill: String(args.process_id ?? "") || summary, wide: false };
    case "read_file":
      return { icon: <FileText size={14} />, label: "读取", pill: basename(args.path) || summary, wide: false };
    case "edit_file":
      return { icon: <Pencil size={13} />, label: "修改", pill: basename(args.path) || summary, wide: false };
    case "write_file":
      return { icon: <FilePlus2 size={14} />, label: "写入", pill: basename(args.path) || summary, wide: false };
    case "web_fetch":
      return { icon: <Globe size={14} />, label: "抓取网页", pill: summary || String(args.url ?? ""), wide: true };
    case "create_agent":
      return { icon: <Sparkles size={14} />, label: "创建智能体", pill: String(args.title ?? "") || summary, wide: false };
    case "call_agent":
      return { icon: <PhoneCall size={14} />, label: "呼叫智能体", pill: summary || String(args.message ?? "").slice(0, 60), wide: true };
    default:
      return { icon: <Terminal size={14} />, label: row.name || "tool", pill: summary, wide: true };
  }
};

/** 失败判定:结果的常见错误开头。整行淡掉,不另立红旗。 */
const isFailed = (row: Row) =>
  /^(error|tool error|exit code|aborted|agent not found|process not found)/i.test(String(row.result || ""));

/** 展开的「参数」:summary 已在标题露过,去掉。 */
const fmtArgs = (args: Record<string, any> | undefined) => {
  const { summary: _s, ...rest } = args || {};
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "(无参数)";
};

/* ── 行骨架:图标位(图形 ⇄ chevron)+ 标签,思考与工具共用 ── */

function StepIcon({ icon }: { icon: ReactNode }) {
  return (
    <span className="relative w-4 h-4 shrink-0">
      <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-data-[open=true]:opacity-0">{icon}</span>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-all group-hover:opacity-100 group-data-[open=true]:opacity-100 group-data-[open=true]:rotate-90">
        <ChevronRight size={12} />
      </span>
    </span>
  );
}

function StepShell({ open, faded, disabled, onToggle, icon, children, body }: {
  open: boolean; faded?: boolean; disabled?: boolean; onToggle: () => void;
  icon: ReactNode; children: ReactNode; body?: ReactNode;
}) {
  return (
    <div className={`w-full min-w-0${faded ? " opacity-60" : ""}`}>
      <button
        data-open={open}
        disabled={disabled}
        onClick={onToggle}
        className={[
          "group w-full flex items-center gap-2 py-0.5 text-left text-[13.5px] leading-5",
          "text-text-faint transition-colors",
          disabled ? "cursor-default" : "hover:text-text-dim",
          open ? "text-text-dim" : "",
        ].join(" ")}
      >
        <StepIcon icon={icon} />
        {children}
      </button>
      {open && body}
    </div>
  );
}

const Block = ({ children }: { children: ReactNode }) => (
  <pre className="bg-bg-panel rounded-md px-3 py-2 text-[12px] leading-[18px] text-text-dim font-mono whitespace-pre-wrap break-all max-h-56 overflow-y-auto select-text cursor-text">{children}</pre>
);

/* ── 思考条目 ── */

export function ThinkItem({ row, compact }: { row: Row; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const thinking = Boolean(row.streaming && !row.content);
  return (
    <StepShell
      open={open}
      onToggle={() => setOpen(!open)}
      icon={<Sparkles size={compact ? 12 : 14} />}
      body={<div className="mt-1 pl-6 flex flex-col gap-1"><Block>{row.reasoning}</Block></div>}
    >
      <span className={thinking ? "sheen whitespace-nowrap" : "whitespace-nowrap"}>{thinking ? "思考中" : "已思考"}</span>
    </StepShell>
  );
}

/* ── 工具条目 ── */

export function ToolItem({ row, compact }: { row: Row; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(row);
  const running = row.status === "running";
  const failed = !running && isFailed(row);
  return (
    <StepShell
      open={open}
      faded={failed}
      disabled={running}
      onToggle={() => !running && setOpen(!open)}
      icon={meta.icon}
      body={(
        <div className={`mt-1 flex flex-col gap-1 ${compact ? "pl-[18px]" : "pl-6"}`}>
          <Block>{fmtArgs(row.args)}</Block>
          <Block>{row.result || "没有输出"}</Block>
        </div>
      )}
    >
      <span className={`${running ? "sheen " : ""}whitespace-nowrap shrink-0${compact ? " text-[12px]" : ""}`}>{meta.label}</span>
      {meta.pill && (
        <span
          className="inline-flex items-center min-w-0 shrink bg-bg-panel rounded-full px-2 h-[18px] text-[12px] leading-[18px] text-text-faint font-mono"
          style={meta.wide ? { maxWidth: 280 } : { maxWidth: 200 }}
        >
          <span className="truncate">{meta.pill}</span>
        </span>
      )}
    </StepShell>
  );
}

/* ── 相邻已完成常规工具 ≥2 收成一行摘要 ── */

type GroupKind = "create" | "edit" | "read" | "exec";

const groupKind = (row: Row): GroupKind => {
  if (row.name === "read_file") return "read";
  if (row.name === "write_file") return "create";
  if (row.name === "edit_file") return "edit";
  return "exec";
};

const groupCount = (rows: Row[], kind: GroupKind) => {
  if (kind === "exec") return rows.length;
  const paths = new Set<string>();
  for (const row of rows) paths.add(String(row.args?.path ?? "").trim() || row.callId || "");
  return paths.size;
};

const GROUP_TEXT: Record<GroupKind, (n: number) => string> = {
  create: (n) => `写入了 ${n} 个文件`,
  edit: (n) => `修改了 ${n} 个文件`,
  read: (n) => `读取了 ${n} 个文件`,
  exec: (n) => `执行了 ${n} 步`,
};

const groupSummary = (rows: Row[]) => {
  const parts: string[] = [];
  for (const kind of ["create", "edit", "read", "exec"] as GroupKind[]) {
    const matching = rows.filter((row) => groupKind(row) === kind);
    if (matching.length) parts.push(GROUP_TEXT[kind](groupCount(matching, kind)));
  }
  return parts.join(",");
};

const groupIcon = (rows: Row[]) => {
  const pick = rows.find((row) => groupKind(row) === "edit")
    || rows.find((row) => groupKind(row) === "create")
    || rows.find((row) => groupKind(row) === "read")
    || rows[0];
  return toolMeta(pick).icon;
};

export function ToolGroup({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const faded = rows.every(isFailed);
  return (
    <StepShell
      open={open}
      faded={faded}
      onToggle={() => setOpen(!open)}
      icon={groupIcon(rows)}
      body={(
        <div className="mt-1 flex flex-col gap-1">
          {rows.map((row) => <ToolItem key={row.key} row={row} compact />)}
        </div>
      )}
    >
      <span className="whitespace-nowrap truncate">{groupSummary(rows)}</span>
    </StepShell>
  );
}

/* ── 轮折叠条:「已工作 X ›」+ 通栏细线 ── */

const formatDuration = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
};

export function TurnFold({ durationMs, children }: { durationMs: number | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // 进折叠条的一定是已收尾的轮;算不出时长也绝不能显示成「执行中」
  const label = durationMs != null && durationMs > 0 ? `已工作 ${formatDuration(durationMs)}` : "过程";
  return (
    <div className="w-full min-w-0">
      <button onClick={() => setOpen(!open)} className="group/fold w-full flex flex-col gap-2 text-left">
        <span className="flex w-full items-center gap-1.5 py-0.5">
          <span className={`text-[13px] leading-5 transition-colors ${open ? "text-text-dim" : "text-text-faint"} group-hover/fold:text-text-dim`}>{label}</span>
          <ChevronRight
            size={12}
            className={`transition-all ${open ? "rotate-90 text-text-dim" : "text-text-faint"} group-hover/fold:text-text-dim`}
          />
        </span>
        <span className="h-px w-full rounded-full bg-border" />
      </button>
      {open && <div className="pt-2 flex flex-col gap-2 min-w-0">{children}</div>}
    </div>
  );
}

/* ── 有序渲染一串条目:常规工具做相邻分组,中间文本按 markdown 平铺 ── */

const NEVER_GROUP = new Set(["create_agent", "call_agent"]);

export function TurnEntries({ items }: { items: TurnEntry[] }) {
  const nodes: ReactNode[] = [];
  let pendingTools: Row[] = [];

  const flushTools = () => {
    if (!pendingTools.length) return;
    const rows = pendingTools;
    pendingTools = [];
    nodes.push(rows.length >= 2
      ? <ToolGroup key={`g:${rows[0].key}`} rows={rows} />
      : <ToolItem key={rows[0].key} row={rows[0]} />);
  };

  for (const item of items) {
    if (item.kind === "tool") {
      // 运行中的不进分组(要单独走扫光);多智能体动作永远单独一行
      if (item.row.status === "running" || NEVER_GROUP.has(item.row.name || "")) {
        flushTools();
        nodes.push(<ToolItem key={item.row.key} row={item.row} />);
      } else {
        pendingTools.push(item.row);
      }
      continue;
    }
    flushTools();
    if (item.kind === "think") {
      nodes.push(<ThinkItem key={`th:${item.row.key}`} row={item.row} />);
    } else {
      nodes.push(
        <div key={`tx:${item.row.key}`} className="prose w-full min-w-0" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.row.content || "") }} />,
      );
    }
  }
  flushTools();
  return <>{nodes}</>;
}

/* ── 正在工作:转圈 + 扫光 ── */

export function Working() {
  return (
    <div className="flex items-center gap-2 min-h-6">
      <Loader2 size={14} className="animate-spin text-accent shrink-0" />
      <span className="sheen text-[13.5px] leading-5 whitespace-nowrap">正在工作…</span>
    </div>
  );
}
