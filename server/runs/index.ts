// @ts-nocheck
// 运行编排:一个智能体同一时刻只有一轮在跑。
//   - 压缩水位判断 → 组装历史与 system → 调 ai/ 内核 → **逐条落库** → 事件广播
//   - 管 calls 表(开始/结束/错误)与树上的状态点
//   - 停止/出错收尾:悬空 function_call 补输出(Responses 要求成对,缺了下一轮请求被拒),
//     落 [stopped]/[error] 留痕 —— 给用户看,也给模型看
//   - 异步回信给 caller 并唤醒它;失败也回信,别让调用链干等一个永远不来的结果
//
// ai/ 内核完全不知道树/邮箱/进程/调用,所有状态在这里管。
import { complete, runAgent as runAi } from "../../ai/index.js";
import { EVENTS } from "../shared/events.js";
import { buildExecutors, tools } from "../tools/index.js";
import { buildSystem } from "./system.js";
import { maybeCompact } from "./compact.js";
import { DEFAULT_TITLE, createAgent, getAgent, resolveWorkdir, touchAgent, updateAgent } from "../repo/agents.js";
import { appendItem, listRows } from "../repo/messages.js";
import { getLatestCompaction } from "../repo/compactions.js";
import { createCall, markCallDone, markCallError, markCallRunning } from "../repo/calls.js";
import { getSettings } from "../repo/settings.js";
import { emit } from "../bus.js";

const MAX_ROUNDS = 64;
const ERROR_MAX_CHARS = 4000;

// ── 智能体级运行注册:stop 对任意 agentId 都生效 ──
const running = new Map();
const isAgentRunning = (agentId) => running.has(String(agentId));
const runningIds = () => [...running.keys()];
const stopAgent = (agentId) => { running.get(String(agentId))?.abort(); };

const parseArgs = (value) => {
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
};

const messageText = (item) => {
  if (typeof item?.content === "string") return item.content;
  if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || "").join("");
  return "";
};

/**
 * 首条消息跑完后给对话取名 —— 独立的一次补全调用,和对话运行完全分离,
 * 失败退回机械截断(用户消息前 24 字),保证一定脱离「未命名对话」。
 */
const autoTitle = async (agentId, rows, finalText, settings) => {
  const lastUser = [...rows].reverse().find((r) => r.item?.role === "user" && r.meta?.kind === "message")
    || [...rows].reverse().find((r) => r.item?.role === "user");
  const ask = String(lastUser?.item?.content || "").replace(/\s+/g, " ").trim();
  let title = "";
  try {
    const result = await complete({
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      errorMaxChars: ERROR_MAX_CHARS,
      instructions: "为这段对话起一个不超过 16 个字的标题,概括用户想做的事。只输出标题本身,不要引号和句号。",
      input: [{ role: "user", content: `用户:${ask.slice(0, 1200)}\n\n助手:${String(finalText || "").slice(0, 1200)}` }],
    });
    title = String(result.text).replace(/\s+/g, " ").trim().slice(0, 32);
  } catch { /* 模型起不出来就机械截断 */ }
  if (!title) title = ask.slice(0, 24);
  if (!title) return;
  updateAgent(agentId, { title });
  emit({ type: "agents_changed" });
};

/** 停止/出错后,给没等到结果的 function_call 补一条输出,落库并广播。 */
const settleDanglingCalls = (agentId, items, reason) => {
  const pending = new Map();
  for (const item of items) {
    if (item?.type === "function_call") pending.set(item.call_id, item);
    else if (item?.type === "function_call_output") pending.delete(item.call_id);
  }
  for (const call of pending.values()) {
    const output = { type: "function_call_output", call_id: call.call_id, output: `error: ${reason}` };
    appendItem(agentId, output);
    emit({ type: EVENTS.CALL_OUTPUT, agentId, callId: call.call_id, result: output.output });
  }
};

const runAgent = async (agentId, { callerId = null } = {}) => {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`agent not found: ${agentId}`);
  if (running.has(String(agentId))) throw new Error("already running");
  const wasUntitled = agent.title === DEFAULT_TITLE;

  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error("还没配置模型(设置 → Responses API URL / API Key / 模型)");
  }

  const controller = new AbortController();
  running.set(String(agentId), controller);
  const signal = controller.signal;

  const callId = createCall({ callerId, calleeId: agentId });
  markCallRunning(callId);
  emit({ type: "call_changed", callId, calleeId: agentId });
  emit({ type: EVENTS.START, agentId });

  const generated = [];

  /** 回信给 caller 并唤醒它 —— 成功、停止、失败都回,调用链不许空等。 */
  const replyToCaller = (text) => {
    if (!callerId) return;
    const caller = getAgent(callerId);
    if (!caller) return;
    const row = appendItem(
      callerId,
      { role: "user", content: `[CALL_RESULT from "${agent.title}" (call#${callId})]\n${text}` },
      { meta: { kind: "call_result", source: "call_result", from: agentId, call_id: callId } },
    );
    touchAgent(callerId); // 邮箱有动静,浮到最近组顶部
    emit({ type: EVENTS.INPUT, agentId: callerId, row });
    runAgent(callerId, {}).catch((error) => {
      if (!/already running/i.test(error?.message || "")) {
        console.error("[wake caller] failed:", error?.message);
      }
    });
  };

  try {
    await maybeCompact({ agentId, settings, signal, emit });

    const latest = getLatestCompaction(agentId);
    const rows = listRows(agentId, { afterId: Number(latest?.end_message_id || 0) });
    const input = rows.map((row) => row.item);
    const cwd = resolveWorkdir(agent);

    const ctx = {
      selfAgentId: agentId,
      cwd,
      emit,
      appendItem,
      getAgent,
      createAgent,
      touchAgent,
      runAgent,
      toolResultMaxChars: Number(settings.toolResultMaxChars) || 12000,
    };

    const emitKernel = (type, data) => {
      if (type === "message" && data.delta) {
        emit({ type: EVENTS.DELTA, agentId, content: data.delta });
        return;
      }
      if (type === "reasoning" && data.delta) {
        emit({ type: EVENTS.REASONING, agentId, content: data.delta });
        return;
      }
      if (type === "function_call" && data.phase === "started") {
        emit({ type: EVENTS.CALL_STARTED, agentId });
        return;
      }
      if (!data.item) return; // 内核自己的 done/error 事件,终局由本层广播
      generated.push(data.item);
      appendItem(agentId, data.item, { usage: data.usage || null });
      if (type === "function_call") {
        emit({
          type: EVENTS.CALLS,
          agentId,
          calls: [{ callId: data.item.call_id, name: data.item.name, args: parseArgs(data.item.arguments) }],
        });
      } else if (type === "function_call_output") {
        emit({ type: EVENTS.CALL_OUTPUT, agentId, callId: data.item.call_id, result: data.item.output || "" });
      }
    };

    const result = await runAi({
      runId: crypto.randomUUID(),
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      instructions: buildSystem(agent, settings),
      input,
      tools,
      executors: buildExecutors(ctx),
      maxRounds: MAX_ROUNDS,
      errorMaxChars: ERROR_MAX_CHARS,
      workdir: cwd,
      env: process.env,
      signal,
      emit: emitKernel,
    });

    const finalText = result.items
      .filter((item) => item?.type === "message")
      .map(messageText)
      .join("\n\n")
      .trim();

    markCallDone(callId, { result: finalText });
    emit({ type: "call_changed", callId, calleeId: agentId });
    emit({ type: EVENTS.DONE, agentId, usage: result.usage || null });
    if (wasUntitled) void autoTitle(agentId, rows, finalText, settings); // 取名独立走,不挡终局
    replyToCaller(finalText || "(没有正文回复)");
    return finalText;
  } catch (error) {
    const aborted = signal.aborted || error?.name === "AbortError";
    const message = String(error?.message || error).slice(0, ERROR_MAX_CHARS);
    settleDanglingCalls(agentId, generated, aborted ? "任务被用户停止,该调用未完成" : "运行出错,该调用未完成");

    const marker = aborted
      ? { role: "system", content: "[stopped] 上一条回复被用户停止,输出到此为止。" }
      : { role: "system", content: `[error] 上一轮运行失败:${message}` };
    const row = appendItem(agentId, marker, { meta: { kind: "marker" } });
    emit({ type: EVENTS.INPUT, agentId, row });

    markCallError(callId, aborted ? "aborted" : message);
    emit({ type: "call_changed", callId, calleeId: agentId });
    if (aborted) emit({ type: EVENTS.ABORTED, agentId });
    else emit({ type: EVENTS.ERROR, agentId, message });
    replyToCaller(aborted ? "(这次调用被用户停止,没有完成)" : `(这次调用运行失败:${message})`);
    throw error;
  } finally {
    running.delete(String(agentId));
  }
};

export { runAgent, stopAgent, isAgentRunning, runningIds };
