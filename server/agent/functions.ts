// @ts-nocheck
// agent 工具实现:
//   shell                               — 跑任意命令(无限制,在智能体的工作目录里)
//   read_file / edit_file / write_file  — 有界读 / 精确替换 / 带护栏写(比纯 shell 对 LLM 更友好)
//   web_fetch                           — 联网:抓取一个已知 URL 的正文
//   create_agent / call_agent           — 派生子智能体 / 给已存在智能体发消息
// 文件类工具的相对路径都相对智能体的工作目录(ctx.cwd = 它所在空间目录)解析,跟 shell 一致。

import { exec } from "child_process";
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "fs";
import { resolve, isAbsolute, dirname } from "path";
import { getProcess, listProcesses, looksLongRunning, startProcess, stopProcess } from "../processes.js";

const resolvePath = (p, ctx) => {
  const rel = String(p || "");
  if (!rel) return ctx?.cwd || process.cwd();
  return isAbsolute(rel) ? rel : resolve(ctx?.cwd || process.cwd(), rel);
};

// ─── shell:跑会结束的命令;常见 dev server 会自动转后台 ───
const SHELL_CANDIDATES = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
const resolveShell = () => {
  for (const s of SHELL_CANDIDATES) {
    const v = String(s || "").trim();
    if (v && existsSync(v)) return v;
  }
  return undefined;
};
const SHELL_TIMEOUT_MS = Math.max(5000, Number(process.env.ARBOR_SHELL_TIMEOUT_MS) || 120_000);

const formatProcess = (p, prefix = "started background process") => {
  if (!p) return "process not found";
  const lines = [
    `${prefix}: id=${p.id}${p.pid ? ` pid=${p.pid}` : ""} status=${p.status}`,
    `command: ${p.command}`,
  ];
  if (p.preview_url) lines.push(`preview: ${p.preview_url}`);
  if (p.output) lines.push(`\nlatest output:\n${p.output.slice(-4000)}`);
  return lines.join("\n");
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shell = ({ command, reason }, ctx) =>
  new Promise((resolve) => {
    const cmd = String(command || "").trim();
    if (!cmd) { resolve("error: command 不能为空"); return; }

    // 模型常忘记把 dev server 放后台。常见长驻命令直接转交给进程管理器,
    // 让智能体立即继续,日志和预览 URL 通过 process panel/工具查看。
    if (looksLongRunning(cmd)) {
      const proc = startProcess({ command: cmd, cwd: ctx?.cwd, reason });
      wait(1200).then(() => resolve(formatProcess(getProcess(proc.id), "detected long-running command; started background process")));
      return;
    }

    // maxBuffer 只是 exec 的临时内存上限;真正给 LLM 的内容由 truncateToolResult 截到 ~32k。
    const options = { maxBuffer: 1024 * 1024 * 8, timeout: SHELL_TIMEOUT_MS, killSignal: "SIGTERM" };
    const shellPath = resolveShell();
    if (shellPath) options.shell = shellPath;
    if (ctx?.cwd && existsSync(ctx.cwd)) options.cwd = ctx.cwd;
    if (ctx?.signal) options.signal = ctx.signal;
    exec(cmd, options, (error, stdout, stderr) => {
      ctx?.emit?.({ type: "tree_changed", reason: "shell" }); // 可能建/改了文件 → 刷新树
      if (error) {
        if (error.name === "AbortError") {
          resolve("aborted");
          return;
        }
        if (error.killed || /timed out/i.test(error.message || "")) {
          resolve(`exit code ${error.code ?? 1}\ncommand exceeded ${Math.round(SHELL_TIMEOUT_MS / 1000)}s and was stopped. Use run_process for dev servers or other long-running commands.\n${stderr || error.message}`);
          return;
        }
        resolve(`exit code ${error.code ?? 1}\n${stderr || error.message}`);
        return;
      }
      resolve(stdout || stderr || "(no output)");
    });
  });

// ─── run_process:显式启动后台进程(dev server 等)───
const run_process = async ({ command, reason }, ctx) => {
  const proc = startProcess({ command, cwd: ctx?.cwd, reason });
  await wait(1200);
  return formatProcess(getProcess(proc.id));
};

const list_processes = () => {
  const rows = listProcesses();
  if (!rows.length) return "(no background processes)";
  return rows
    .map((p) => [
      `${p.id}  ${p.status}${p.pid ? `  pid=${p.pid}` : ""}`,
      `  command: ${p.command}`,
      p.preview_url ? `  preview: ${p.preview_url}` : "",
      p.output ? `  tail: ${p.output.slice(-500).replace(/\n/g, "\n        ")}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
};

const read_process_output = ({ process_id, tail }) => {
  const p = getProcess(process_id, { tail: Math.min(Number(tail) || 8000, 40_000) });
  if (!p) return `process not found: ${process_id}`;
  return formatProcess(p, "process");
};

const stop_process = ({ process_id }) => formatProcess(stopProcess(process_id), "stop requested for process");

// ─── read_file:有界读,带行号 ───
const read_file = ({ path: p, offset, limit }, ctx) => {
  const abs = resolvePath(p, ctx);
  let stat;
  try { stat = statSync(abs); } catch { return `error: 文件不存在: ${p}`; }
  if (stat.isDirectory()) return `error: ${p} 是目录(列目录用 shell 的 ls)`;
  if (stat.size > 5_000_000) return `error: 文件过大(${stat.size} 字节),请用 shell 处理`;
  let buf;
  try { buf = readFileSync(abs); } catch (e) { return `error: ${e.message}`; }
  if (buf.subarray(0, 8192).includes(0)) return `(二进制文件,${stat.size} 字节,无法按文本读)`;
  const lines = buf.toString("utf8").split("\n");
  const start = Math.max(1, Number(offset) || 1);
  const count = Math.min(Number(limit) || 2000, 2000);
  const slice = lines.slice(start - 1, start - 1 + count);
  if (!slice.length) return `(超出文件范围,共 ${lines.length} 行)`;
  const numbered = slice.map((l, i) => `${String(start + i).padStart(5)}\t${l}`).join("\n");
  const rest = lines.length - (start - 1 + count);
  return numbered + (rest > 0 ? `\n… (还有 ${rest} 行,用 offset=${start + count} 继续读)` : "");
};

// ─── edit_file:精确替换(要求唯一匹配)───
const edit_file = ({ path: p, old, old_string, new: nw, new_string, replace_all }, ctx) => {
  const oldStr = old != null ? old : old_string;
  const newStr = (nw != null ? nw : new_string) ?? "";
  if (oldStr == null || oldStr === "") return "error: old(要替换的原文)不能为空";
  const abs = resolvePath(p, ctx);
  let content;
  try { content = readFileSync(abs, "utf8"); } catch { return `error: 读不到文件: ${p}`; }
  const occ = content.split(oldStr).length - 1;
  if (occ === 0) return "error: 没找到要替换的内容(old 在文件里不存在)。先用 read_file 确认原文。";
  if (occ > 1 && !replace_all) return `error: old 出现了 ${occ} 次,不唯一。请带上更长、唯一的上下文,或设 replace_all=true。`;
  const updated = replace_all ? content.split(oldStr).join(String(newStr)) : content.replace(oldStr, String(newStr));
  try { writeFileSync(abs, updated); } catch (e) { return `error: 写回失败 ${e.message}`; }
  ctx?.emit?.({ type: "tree_changed", reason: "edit_file" });
  return `已编辑 ${p}(替换 ${replace_all ? occ : 1} 处)`;
};

// ─── write_file:带护栏写(创建父目录,报告新建/覆盖)───
const write_file = ({ path: p, content }, ctx) => {
  if (!p) return "error: path 不能为空";
  const abs = resolvePath(p, ctx);
  const existed = existsSync(abs);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content != null ? String(content) : "");
  } catch (e) { return `error: ${e.message}`; }
  ctx?.emit?.({ type: "tree_changed", reason: "write_file" });
  const bytes = Buffer.byteLength(content != null ? String(content) : "");
  return `${existed ? "已覆盖" : "已创建"} ${p}(${bytes} 字节)`;
};

// ─── web:去标签提取正文 ───
const stripHtml = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

const fetchWithTimeout = async (url, ms = 15000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)" },
    });
  } finally { clearTimeout(t); }
};

// ─── web_fetch:抓网页并提取正文 ───
const web_fetch = async ({ url }) => {
  const u = String(url || "").trim();
  if (!/^https?:\/\//.test(u)) return "error: url 必须以 http(s):// 开头";
  try {
    const res = await fetchWithTimeout(u);
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    const text = /html|xml/.test(ct) || /^\s*</.test(body) ? stripHtml(body) : body;
    const max = 8000;
    return `[${res.status}] ${u}\n\n${text.slice(0, max)}${text.length > max ? `\n…(已截断,正文共 ${text.length} 字符)` : ""}`;
  } catch (e) {
    return `error: 抓取失败 ${e?.name === "AbortError" ? "超时" : e?.message}`;
  }
};

// ─── create_agent (异步):在自己所在空间里派生一个兄弟智能体 ───
const create_agent = ({ title, message, system }, ctx) => {
  const newAgent = ctx.createAgent({
    spaceId: ctx.spaceIdOf(ctx.selfAgentId),
    title: String(title || "new agent"),
    system: system ? String(system) : null,
  });
  ctx.emit({ type: "tree_changed", item: newAgent, reason: "created" });

  if (message != null && String(message).trim()) {
    ctx.appendMessage(
      newAgent.id,
      { role: "user", content: String(message) },
      { source: "call", from: ctx.selfAgentId },
    );
    ctx.runAgent(newAgent.id, { callerId: ctx.selfAgentId }).catch((e) =>
      console.error(`[create_agent] wake failed:`, e?.message),
    );
    return `created agent "${newAgent.title}" (id=${newAgent.id}). initial message dispatched; reply will arrive in your mailbox.`;
  }
  return `created agent "${newAgent.title}" (id=${newAgent.id}).`;
};

// ─── call_agent (异步) ───
const call_agent = ({ agent_id, message }, ctx) => {
  const targetId = String(agent_id || "").trim();
  if (!targetId) return "agent_id is required";
  const target = ctx.getAgent(targetId);
  if (!target) return `agent not found: ${targetId}`;

  ctx.appendMessage(
    targetId,
    { role: "user", content: String(message || "") },
    { source: "call", from: ctx.selfAgentId },
  );
  ctx.runAgent(targetId, { callerId: ctx.selfAgentId }).catch((e) =>
    console.error(`[call_agent] wake failed:`, e?.message),
  );
  return `dispatched to "${target.title}" (id=${targetId}). reply will arrive in your mailbox as a new message.`;
};

export {
  shell,
  run_process,
  list_processes,
  read_process_output,
  stop_process,
  read_file,
  edit_file,
  write_file,
  web_fetch,
  create_agent,
  call_agent,
};
