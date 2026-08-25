// @ts-nocheck
// 后台进程四件套:启动 / 列出 / 读日志 / 停止。实体在 server/processes.ts,这里只是工具面。
import { getProcess, listProcesses, startProcess, stopProcess } from "../processes.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProcess = (record, prefix = "process") => {
  if (!record) return "process not found";
  const lines = [
    `${prefix}: id=${record.id}${record.pid ? ` pid=${record.pid}` : ""} status=${record.status}`,
    `command: ${record.command}`,
  ];
  if (record.preview_url) lines.push(`preview: ${record.preview_url}`);
  if (record.output) lines.push(`\nlatest output:\n${record.output.slice(-4000)}`);
  return lines.join("\n");
};

export const runProcessDef = {
  type: "function",
  name: "run_process",
  description:
    "启动一个后台进程,用于 dev server、静态文件服务、watcher 等长驻命令。立即返回进程 id、日志片段和可能的 preview URL,不阻塞。" +
    "例如 npm run dev、python -m http.server、vite、next dev 都用它。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明启动它做什么(界面会显示)" },
      command: { type: "string", description: "要启动的命令" },
    },
    required: ["summary", "command"],
    additionalProperties: false,
  },
};

export const run_process = async ({ command, summary }, ctx) => {
  const proc = startProcess({ command, cwd: ctx.cwd, reason: summary || "" });
  await wait(1200);
  return formatProcess(getProcess(proc.id), "started background process");
};

export const listProcessesDef = {
  type: "function",
  name: "list_processes",
  description: "列出当前 Arbor 后台进程,包括状态、命令、日志片段和 preview URL。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么查看(界面会显示)" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

export const list_processes = () => {
  const rows = listProcesses();
  if (!rows.length) return "(no background processes)";
  return rows
    .map((record) => [
      `${record.id}  ${record.status}${record.pid ? `  pid=${record.pid}` : ""}`,
      `  command: ${record.command}`,
      record.preview_url ? `  preview: ${record.preview_url}` : "",
      record.output ? `  tail: ${record.output.slice(-500).replace(/\n/g, "\n        ")}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
};

export const readProcessOutputDef = {
  type: "function",
  name: "read_process_output",
  description: "读取某个后台进程的最新日志输出。用于检查 dev server 是否启动成功、端口是多少、有没有报错。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么读(界面会显示)" },
      process_id: { type: "string", description: "run_process 返回的进程 id" },
      tail: { type: "number", description: "可选:最多返回多少字符(默认 8000,上限 40000)" },
    },
    required: ["summary", "process_id"],
    additionalProperties: false,
  },
};

export const read_process_output = ({ process_id, tail }) => {
  const record = getProcess(process_id, { tail: Math.min(Number(tail) || 8000, 40_000) });
  if (!record) return `process not found: ${process_id}`;
  return formatProcess(record);
};

export const stopProcessDef = {
  type: "function",
  name: "stop_process",
  description: "停止一个后台进程。用于关闭 dev server、watcher 等。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明为什么停止(界面会显示)" },
      process_id: { type: "string", description: "要停止的进程 id" },
    },
    required: ["summary", "process_id"],
    additionalProperties: false,
  },
};

export const stop_process = ({ process_id }) => formatProcess(stopProcess(process_id), "stop requested for process");
