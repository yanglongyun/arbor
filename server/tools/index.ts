// @ts-nocheck
// 工具装配:定义表(发给模型)与执行映射(注入内核)在这里合拢。
// 内核(ai/)只认 tools 数组 + executors Map,不知道 Arbor 是什么;
// Arbor 的外部能力(树、邮箱、进程、多智能体)全部通过 ctx 闭包进执行器。
import { shell, shellDef } from "./shell.js";
import { edit_file, editFileDef, read_file, readFileDef, write_file, writeFileDef } from "./files.js";
import {
  list_processes, listProcessesDef,
  read_process_output, readProcessOutputDef,
  run_process, runProcessDef,
  stop_process, stopProcessDef,
} from "./processTools.js";
import { web_fetch, webFetchDef } from "./webFetch.js";
import { call_agent, callAgentDef, create_agent, createAgentDef } from "./agentTools.js";

export const tools = [
  shellDef,
  runProcessDef,
  listProcessesDef,
  readProcessOutputDef,
  stopProcessDef,
  readFileDef,
  editFileDef,
  writeFileDef,
  webFetchDef,
  createAgentDef,
  callAgentDef,
];

const IMPLS = {
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

/** 给模型的结果统一截断:留头留尾,中间标注截掉多少。 */
export const truncateToolResult = (text, maxChars = 12000) => {
  const limit = Math.max(1000, Math.min(50000, Number(maxChars) || 12000));
  const value = String(text || "");
  if (value.length <= limit) return value;
  const head = value.slice(0, Math.floor(limit * 0.7));
  const tail = value.slice(-Math.floor(limit * 0.3));
  return `${head}\n... [truncated ${value.length - head.length - tail.length} chars] ...\n${tail}`;
};

/**
 * 按本次运行的 ctx 生成执行映射。
 * 内核每次调用只带 {signal, cwd, env};Arbor 的能力在这里合并进去,
 * 结果在这里统一截断 —— 截断只写一处,工具实现不用各自操心。
 */
export const buildExecutors = (ctx) => {
  const executors = new Map();
  for (const [name, impl] of Object.entries(IMPLS)) {
    executors.set(name, async (args, kernelCtx = {}) => {
      const result = await impl(args, { ...ctx, signal: kernelCtx.signal });
      return truncateToolResult(result, ctx.toolResultMaxChars);
    });
  }
  return executors;
};
