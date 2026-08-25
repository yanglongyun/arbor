// @ts-nocheck
// shell:在智能体的工作目录里跑会结束的命令。
// spawn + 进程组:超时和用户停止都杀整组(exec 版只能杀壳,子进程会漏)。
// 常见 dev server 命令自动转交进程管理器 —— 模型常忘记后台化,别让它卡死自己。
import { spawn } from "child_process";
import { existsSync } from "fs";
import { getProcess, looksLongRunning, startProcess } from "../processes.js";

const SHELL_CANDIDATES = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
const resolveShell = () => {
  for (const candidate of SHELL_CANDIDATES) {
    const value = String(candidate || "").trim();
    if (value && existsSync(value)) return value;
  }
  return "/bin/sh";
};

const TIMEOUT_MS = Math.max(5000, Number(process.env.ARBOR_SHELL_TIMEOUT_MS) || 120_000);
const RAW_MAX = 200_000; // 收集上限,只是内存护栏;给模型的截断在工具装配层统一做

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatProcess = (record, prefix = "started background process") => {
  if (!record) return "process not found";
  const lines = [
    `${prefix}: id=${record.id}${record.pid ? ` pid=${record.pid}` : ""} status=${record.status}`,
    `command: ${record.command}`,
  ];
  if (record.preview_url) lines.push(`preview: ${record.preview_url}`);
  if (record.output) lines.push(`\nlatest output:\n${record.output.slice(-4000)}`);
  return lines.join("\n");
};

export const shellDef = {
  type: "function",
  name: "shell",
  description:
    "在你的工作目录里执行会结束的 shell 命令并返回输出。git/build/ls/grep/装依赖用它;" +
    "长驻进程/dev server 用 run_process。读写单个文件优先用 read_file/edit_file/write_file(更省 token)。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明这次执行的目的(界面会显示)" },
      command: { type: "string", description: "要执行的命令" },
    },
    required: ["summary", "command"],
    additionalProperties: false,
  },
};

export const shell = async ({ command, summary }, ctx) => {
  const cmd = String(command || "").trim();
  if (!cmd) return "error: command 不能为空";

  // 长驻命令直接转交进程管理器:智能体立即继续,日志和预览 URL 走进程面板
  if (looksLongRunning(cmd)) {
    const proc = startProcess({ command: cmd, cwd: ctx.cwd, reason: summary || "" });
    await wait(1200);
    return formatProcess(getProcess(proc.id), "detected long-running command; started background process");
  }

  return new Promise((resolve) => {
    const child = spawn(resolveShell(), ["-lc", cmd], {
      cwd: ctx.cwd && existsSync(ctx.cwd) ? ctx.cwd : process.cwd(),
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current, chunk) => (current + chunk).slice(-RAW_MAX);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

    const stop = () => {
      if (child.exitCode !== null) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { child.kill("SIGTERM"); }
    };
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, TIMEOUT_MS);
    const onAbort = () => stop();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      ctx.emit?.({ type: "tree_changed", reason: "shell" }); // 可能建/改了文件 → 刷新树
      resolve(text);
    };

    child.on("error", (error) => finish(`error: ${error.message}`));
    child.on("close", (code, signalName) => {
      if (ctx.signal?.aborted) { finish("aborted"); return; }
      if (timedOut) {
        finish(`exit code ${code ?? 1}\ncommand exceeded ${Math.round(TIMEOUT_MS / 1000)}s and was stopped. Use run_process for dev servers or other long-running commands.\n${stderr}`);
        return;
      }
      const body = stdout || stderr || "(no output)";
      finish(code ? `exit code ${code}${signalName ? ` (${signalName})` : ""}\n${stderr || stdout || ""}` : body);
    });
  });
};
