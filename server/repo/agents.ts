// @ts-nocheck
// 智能体 = 一条 SQLite 记录 + 一个绑定的真实文件夹(workdir)。
// 磁盘上不再有 .agent.json —— 对话是过程,不该落进用户的资产目录。
// uuid 稳定寻址(messages / calls / call_agent 都按它),workdir 只是一条可改的数据。
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db.js";
import { ensureRoot, listWorkspaces } from "./tree.js";

// 新对话默认叫这个;首条消息跑完后由 runs 层请模型取正式名字
const DEFAULT_TITLE = "未命名对话";

const now = () => getDb().prepare("SELECT datetime('now') AS t").get().t;

/** 行 → 统一 Node 形状(kind='agent'),UI 的标签页/聊天面板照旧吃它。 */
const toNode = (row) => row && ({
  id: row.id,
  parent_id: null,
  kind: "agent",
  title: row.title,
  system: row.system ?? null,
  content: null,
  position: null,
  workdir: row.workdir,
  pinned: !!row.pinned,
  last_read_at: row.last_read_at ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const getAgent = (id) => toNode(getDb().prepare("SELECT * FROM agents WHERE id = ?").get(String(id || "")));

const listAgents = () =>
  getDb().prepare("SELECT * FROM agents ORDER BY pinned DESC, updated_at DESC, created_at DESC").all().map(toNode);

const createAgent = ({ title, system = null, workdir } = {}) => {
  const id = randomUUID();
  const home = String(workdir || "").trim() || (listWorkspaces()[0]?.path || ensureRoot());
  getDb().prepare(`
    INSERT INTO agents (id, title, system, workdir) VALUES (?, ?, ?, ?)
  `).run(id, String(title || DEFAULT_TITLE).trim() || DEFAULT_TITLE, system == null ? null : String(system), home);
  return getAgent(id);
};

const updateAgent = (id, { title, system, workdir, pinned } = {}) => {
  const db = getDb();
  if (title !== undefined) db.prepare("UPDATE agents SET title = ? WHERE id = ?").run(String(title || "").trim() || DEFAULT_TITLE, String(id));
  if (system !== undefined) db.prepare("UPDATE agents SET system = ? WHERE id = ?").run(system == null ? null : String(system), String(id));
  if (workdir !== undefined) db.prepare("UPDATE agents SET workdir = ? WHERE id = ?").run(String(workdir), String(id));
  if (pinned !== undefined) db.prepare("UPDATE agents SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, String(id));
  return getAgent(id);
};

/** 邮箱有动静:浮到最近组顶部。 */
const touchAgent = (id) => { getDb().prepare("UPDATE agents SET updated_at = ? WHERE id = ?").run(now(), String(id)); };

const markRead = (id) => {
  getDb().prepare("UPDATE agents SET last_read_at = ? WHERE id = ?").run(now(), String(id));
  return getAgent(id);
};

/** 删除:记录 + 邮箱 + 调用关系一起走,不留孤儿。 */
const deleteAgent = (id) => {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE agent_id = ?").run(String(id));
  db.prepare("DELETE FROM calls WHERE caller_id = ? OR callee_id = ?").run(String(id), String(id));
  return db.prepare("DELETE FROM agents WHERE id = ?").run(String(id)).changes > 0;
};

/** 一组 id → { id: 有未读 }(有比 last_read_at 更新的消息)。 */
const unreadMap = (ids) => {
  if (!ids?.length) return {};
  const db = getDb();
  const ph = ids.map(() => "?").join(",");
  const latest = {};
  for (const r of db.prepare(`SELECT agent_id, MAX(created_at) AS m FROM messages WHERE agent_id IN (${ph}) GROUP BY agent_id`).all(...ids.map(String))) {
    latest[r.agent_id] = r.m;
  }
  const reads = {};
  for (const r of db.prepare(`SELECT id, last_read_at FROM agents WHERE id IN (${ph})`).all(...ids.map(String))) {
    reads[r.id] = r.last_read_at || null;
  }
  const map = {};
  for (const id of ids) {
    const m = latest[String(id)] || null;
    const lr = reads[String(id)] ?? null;
    map[id] = !!(m && (!lr || m > lr));
  }
  return map;
};

/** 运行时的家:workdir 没了(被删/盘未挂载)就退回第一个工作区根,任务不至于无处落脚。 */
const resolveWorkdir = (agent) => {
  const dir = agent?.workdir || "";
  try { if (dir && fs.statSync(dir).isDirectory()) return dir; } catch { /* fallthrough */ }
  return listWorkspaces()[0]?.path || ensureRoot();
};

// ── 一次性迁移:磁盘上的 <uuid>.agent.json / <uuid>.conv.json → agents 表,然后删文件 ──
const AGENT_EXT = ".agent.json";
const LEGACY_EXT = ".conv.json";
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "vendor",
  ".git", ".next", ".cache", ".turbo", ".gradle", ".venv", "__pycache__",
]);

const migrateAgentFiles = () => {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO agents (id, title, system, workdir, last_read_at, created_at)
    VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `);
  let moved = 0;
  const walk = (dir) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(abs); continue; }
      const ext = e.name.endsWith(AGENT_EXT) ? AGENT_EXT : e.name.endsWith(LEGACY_EXT) ? LEGACY_EXT : null;
      if (!ext) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(abs, "utf8")); } catch { /* 空元数据也照迁 */ }
      const id = meta.id || e.name.slice(0, -ext.length);
      insert.run(id, String(meta.title || DEFAULT_TITLE), meta.system ?? null, dir, meta.last_read_at ?? null, meta.created_at ?? null);
      try { fs.rmSync(abs, { force: true }); moved += 1; } catch { /* 删不掉就留着,下次再试 */ }
    }
  };
  for (const row of listWorkspaces()) walk(row.path);
  if (moved) console.log(`[agents] 已把 ${moved} 个 .agent.json 迁入 SQLite,磁盘副本已清`);
  return moved;
};

export {
  DEFAULT_TITLE,
  listAgents, getAgent, createAgent, updateAgent, deleteAgent,
  markRead, touchAgent, unreadMap, resolveWorkdir, migrateAgentFiles,
};
