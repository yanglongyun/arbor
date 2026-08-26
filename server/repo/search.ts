// @ts-nocheck
// 全局内容搜索:在所有工作区里 grep 真实文件内容,返回按文件分组的命中行。
import fs from "fs";
import path from "path";
import { ensureRoot, IGNORE_DIRS, listWorkspaces } from "./tree.js";

const isHidden = (name) => name.startsWith(".");
const isAgentFile = (name) => name.endsWith(".agent.json");

const searchContent = (query, { maxMatchesPerFile = 50, maxTotal = 1000, maxFileSize = 1_000_000 } = {}) => {
  const roots = listWorkspaces().map((w) => w.path);
  if (!roots.length) roots.push(ensureRoot());
  const q = String(query || "");
  if (!q) return [];
  const ql = q.toLowerCase();

  const results = [];
  let total = 0;

  const walk = (dir) => {
    if (total >= maxTotal) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (total >= maxTotal) return;
      if (isHidden(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(abs); continue; }
      if (isAgentFile(e.name)) continue; // 智能体元数据不搜

      let content;
      try {
        if (fs.statSync(abs).size > maxFileSize) continue;
        content = fs.readFileSync(abs, "utf8");
      } catch { continue; }
      if (/\x00/.test(content)) continue; // 疑似二进制

      const lines = content.split(/\r?\n/);
      const matches = [];
      for (let i = 0; i < lines.length && matches.length < maxMatchesPerFile; i++) {
        if (lines[i].toLowerCase().indexOf(ql) !== -1) {
          matches.push({ line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
      if (matches.length) {
        results.push({ id: abs, title: path.basename(abs), matches });
        total += matches.length;
      }
    }
  };

  for (const root of roots) walk(root);
  return results;
};

export { searchContent };
