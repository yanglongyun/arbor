// 邮箱行的渲染模型:落库的 Responses item → 用户看得懂的行。
//
// 行是**可变对象**:流式增量直接改字段,再靠 tick 触发重渲染。
// React 用 key 复用 DOM,原地改内容不重挂(不闪、不丢滚动、不断选中)。
import type { MessageRow, StoredItem } from "../../api";

export type Row = {
  key: string;
  kind: "user" | "assistant" | "tool" | "chip";
  /** 行时间(ms),日期条和轮时长用。 */
  at?: number;

  // user(邮箱语义:普通消息 / agent 来信 / 子 agent 回信 / 压缩摘要)
  content?: string;
  source?: "user" | "call" | "call_result" | "compaction";
  from?: string;

  // assistant:思考与正文同一行(思考先流,正文后到)
  reasoning?: string;
  streaming?: boolean;

  // tool
  callId?: string;
  name?: string;
  args?: Record<string, any>;
  result?: string;
  status?: "running" | "done";

  // chip(系统留痕)
  code?: "stopped" | "error" | "compacting" | "compacted";
};

let keySeq = 0;
export const mkKey = (prefix = "r") => {
  keySeq += 1;
  return `${prefix}:${keySeq}`;
};

const parseArgs = (value: unknown): Record<string, any> => {
  if (value && typeof value === "object") return value as Record<string, any>;
  try { return JSON.parse(String(value ?? "{}")); } catch { return {}; }
};

/** item 里的纯文本:content 可能是串或分段;思考在 summary/content 里。 */
export const itemText = (item: StoredItem): string => {
  if (item.type === "reasoning") {
    const parts = [...(item.summary || []), ...(Array.isArray(item.content) ? item.content : [])];
    return parts.map((part) => String(part?.text || "")).join("");
  }
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .filter((part) => part?.type === "output_text" || part?.type === "input_text")
    .map((part) => String(part.text || ""))
    .join("");
};

export const toolRow = (
  call: { call_id?: string; callId?: string; name?: string; args?: unknown; arguments?: unknown },
  status: "running" | "done",
): Row => ({
  key: mkKey("t"),
  kind: "tool",
  callId: call.call_id || call.callId || mkKey("cid"),
  name: call.name || "tool",
  args: parseArgs(call.args ?? call.arguments),
  result: "",
  status,
});

/** 剥掉后端拼的 [CALL_RESULT from "X" (call#N)] 前缀,正文归正文。 */
export const stripCallResultPrefix = (text: string) => text.replace(/^\[CALL_RESULT[^\]]*\]\n?/, "");

/**
 * 历史行 → 渲染行。
 * 思考是独立 item,但界面上它属于紧随其后的那条正文 —— 先攥在手里,
 * 遇到 assistant 正文就并进去;只思考没说话(直接去调工具)就单独成行。
 * 工具结果回填到对应调用行;发起调用被压缩切掉的孤儿结果单独成行,不吞。
 */
export const renderRows = (raw: MessageRow[]): Row[] => {
  const rows: Row[] = [];
  const calls = new Map<string, Row>();
  let pendingReasoning = "";

  const flushReasoning = (at?: number) => {
    if (!pendingReasoning.trim()) { pendingReasoning = ""; return; }
    rows.push({ key: mkKey("a"), kind: "assistant", content: "", reasoning: pendingReasoning.trim(), at });
    pendingReasoning = "";
  };

  for (const record of raw) {
    const item = record.item || {};
    const meta = record.meta || {};
    const at = Date.parse(record.created_at) || undefined;

    if (item.type === "reasoning") {
      pendingReasoning += itemText(item);
      continue;
    }
    if (item.type === "function_call") {
      flushReasoning(at);
      const row = toolRow(item, "done");
      row.at = at;
      calls.set(row.callId!, row);
      rows.push(row);
      continue;
    }
    if (item.type === "function_call_output") {
      const row = calls.get(item.call_id || "");
      if (row) {
        row.result = item.output || "";
        row.status = "done";
      } else {
        rows.push({ ...toolRow(item, "done"), result: item.output || "", at });
      }
      continue;
    }
    if (item.role === "user") {
      flushReasoning(at);
      const kind = String(meta.kind || meta.source || "");
      const source: Row["source"] =
        kind === "compaction" ? "compaction"
        : kind === "call_result" || meta.source === "call_result" ? "call_result"
        : kind === "call" || meta.source === "call" ? "call"
        : "user";
      rows.push({ key: mkKey("u"), kind: "user", content: itemText(item), source, from: meta.from, at });
      continue;
    }
    if (item.role === "system") {
      flushReasoning(at);
      const text = itemText(item);
      if (/^\[stopped\]/.test(text)) rows.push({ key: mkKey("c"), kind: "chip", code: "stopped", content: "", at });
      else if (/^\[error\]/.test(text)) {
        rows.push({ key: mkKey("c"), kind: "chip", code: "error", content: text.replace(/^\[error\]\s*/, ""), at });
      }
      // 其余系统条目是给模型看的,不进画面
      continue;
    }
    if (item.role === "assistant") {
      const content = itemText(item).trim();
      const reasoning = pendingReasoning.trim();
      pendingReasoning = "";
      if (content || reasoning) {
        rows.push({ key: mkKey("a"), kind: "assistant", content, reasoning, at });
      }
    }
  }
  flushReasoning();
  return rows;
};
