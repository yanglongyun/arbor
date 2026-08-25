// @ts-nocheck
// 文件系统监听:树的另一半事实来源。
//
// 自己的工具(shell/write_file/…)改文件会手动广播 tree_changed;但 Finder、终端、
// dev server、git、别的进程改磁盘时没人说话 —— 树就静默过期。VS Code 的资源管理器
// 之所以"总是新的",是向内核注册文件事件(macOS FSEvents / Win ReadDirectoryChangesW /
// Linux inotify)。Node 的 fs.watch({recursive}) 在 libuv 底下用的正是同一套内核 API,
// 零依赖 —— 这里对每个工作区根挂一个递归监听,事件节流后广播 tree_changed。
import fs from "fs";
import path from "path";
import { emit } from "./bus.js";
import { IGNORE_DIRS, ensureRoot, listWorkspaces } from "./repo/tree.js";

const watchers = new Map(); // root -> fs.FSWatcher

// npm install / git checkout 是几千个事件的风暴:节流成每 400ms 至多一次广播。
// 树的刷新是幂等的整树重拉,合并多少事件都不丢信息。
const INTERVAL_MS = 400;
let lastFired = 0;
let timer = null;

const fire = () => {
  lastFired = Date.now();
  emit({ type: "tree_changed", reason: "fs" });
};

const schedule = () => {
  if (timer) return;
  const wait = Math.max(50, INTERVAL_MS - (Date.now() - lastFired));
  timer = setTimeout(() => { timer = null; fire(); }, wait);
};

/** 忽略树本来就不显示的目录(node_modules/.git/…)里的抖动,少刷无谓的一轮。 */
const ignorable = (filename) => {
  if (!filename) return false; // 拿不到路径就宁可刷一次
  return String(filename).split(path.sep).some((part) => IGNORE_DIRS.has(part));
};

const watchRoot = (root) => {
  if (watchers.has(root)) return;
  try {
    const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (ignorable(filename)) return;
      schedule();
    });
    // 根被删/权限变化:收掉,等下次 sync 重试
    watcher.on("error", () => { watcher.close(); watchers.delete(root); });
    watchers.set(root, watcher);
  } catch {
    // 根暂时不可用(如外置盘未挂载),下次 sync 再试
  }
};

/** 对齐监听集合与当前工作区列表。启动时和工作区增删后各调一次。 */
const syncWatchers = () => {
  const roots = new Set([ensureRoot(), ...listWorkspaces().map((row) => row.path)]);
  for (const [root, watcher] of watchers) {
    if (!roots.has(root)) { watcher.close(); watchers.delete(root); }
  }
  for (const root of roots) watchRoot(root);
};

const startWatcher = () => syncWatchers();

export { startWatcher, syncWatchers };
