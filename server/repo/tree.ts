// @ts-nocheck
// 文件系统即树。app 托管根目录 workspaces/(不导入任何已有目录,自己长出来):
//   目录            = 空间(space)         —— 唯一会无限自嵌套的容器
//   真实文件        = 文件(file)         —— 内容就是文件内容
//   <uuid>.agent.json = 智能体(agent) —— 元数据:title / system / last_read_at / created_at
//
// id 规则:
//   space / file  = 绝对路径(改名/移动即变,前端每次重拉树,无需 fs↔DB 同步)
//   agent         = 文件名里的 uuid(稳定)—— messages / calls / call_agent 都按它寻址
// SQLite 只存运行时状态(messages / calls / settings)。

import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ARBOR_WORKSPACES || path.join(__dirname, "../../workspaces"));
const AGENT_EXT = ".agent.json";
const LEGACY_AGENT_EXT = ".conv.json";
const SEP = path.sep;

const ensureRoot = () => { fs.mkdirSync(ROOT, { recursive: true }); return ROOT; };

const isPathId = (id) => typeof id === "string" && id.startsWith("/");
const normalizeAbs = (p) => path.resolve(String(p || "").trim());
const withSep = (abs) => abs.endsWith(SEP) ? abs : abs + SEP;
const isUnder = (abs, root) => abs === root || abs.startsWith(withSep(root));
const workspaceIdForPath = (abs) => createHash("sha1").update(abs).digest("hex").slice(0, 16);
let defaultWorkspaceReady = false;
const ensureDefaultWorkspace = () => {
  ensureRoot();
  if (defaultWorkspaceReady) return;
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, title, path, enabled)
    VALUES (?, ?, ?, 1)
  `).run(workspaceIdForPath(ROOT), "workspace", ROOT);
  db.prepare(`
    UPDATE workspaces SET title = 'workspace'
    WHERE path = ? AND title = 'Arbor'
  `).run(ROOT);
  defaultWorkspaceReady = true;
};
const workspaceRows = () => {
  ensureDefaultWorkspace();
  const rows = getDb().prepare(`
    SELECT id, title, path, enabled, created_at, last_opened_at
    FROM workspaces
    WHERE enabled = 1
    ORDER BY created_at, id
  `).all();
  const enabledRows = rows
    .map((r) => ({ ...r, path: normalizeAbs(r.path) }))
    .filter((r) => {
      try { return fs.statSync(r.path).isDirectory(); }
      catch { return false; }
    });
  if (!legacyAgentFilesMigrated) {
    migrateLegacyAgentFiles(enabledRows.map((r) => r.path));
    legacyAgentFilesMigrated = true;
  }
  return enabledRows;
};
const workspacePaths = () => workspaceRows().map((r) => r.path);
const rootOf = (abs) => {
  const full = normalizeAbs(abs);
  return workspacePaths()
    .filter((root) => isUnder(full, root))
    .sort((a, b) => b.length - a.length)[0] || null;
};
const isAllowedPath = (abs) => !!rootOf(abs);
const isWorkspaceRoot = (abs) => rootOf(abs) === normalizeAbs(abs);
const workspaceForPath = (abs) => workspaceRows().find((r) => r.path === normalizeAbs(abs)) || null;
const parentAbsOf = (abs) => isWorkspaceRoot(abs) ? null : path.dirname(normalizeAbs(abs));
const isHidden = (name) => name.startsWith(".");
let legacyAgentFilesMigrated = false;
// 递归(智能体索引 / 删除子树)时跳过的重目录 —— 跟 VSCode 一样不索引它们,
// 否则 AI 一 npm install,node_modules 几万文件会拖垮一切。
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "vendor",
  ".git", ".next", ".cache", ".turbo", ".gradle", ".venv", "__pycache__",
]);
const isAgentFile = (name) => name.endsWith(AGENT_EXT) || name.endsWith(LEGACY_AGENT_EXT);
const agentIdOfFile = (name) =>
  name.endsWith(AGENT_EXT)
    ? name.slice(0, -AGENT_EXT.length)
    : name.slice(0, -LEGACY_AGENT_EXT.length);
const migrateLegacyAgentFiles = (roots) => {
  let changed = false;
  const walk = (dir) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(abs); continue; }
      if (!e.name.endsWith(LEGACY_AGENT_EXT)) continue;
      const next = path.join(dir, `${agentIdOfFile(e.name)}${AGENT_EXT}`);
      if (fs.existsSync(next)) continue;
      fs.renameSync(abs, next);
      changed = true;
    }
  };
  for (const root of roots || []) walk(root);
  if (changed) invalidateIdx();
};
const sanitize = (title) =>
  String(title || "").trim().replace(/[/\\]/g, "-").replace(/^\.+/, "") || "未命名";

const dbNow = () => getDb().prepare("SELECT datetime('now') AS t").get().t;
const statCreatedAt = (abs) => {
  try { const s = fs.statSync(abs); return new Date(s.birthtimeMs || s.mtimeMs).toISOString(); }
  catch { return null; }
};

// ── agent uuid → 绝对路径 索引(避免每次全树扫描)──
let _idx = null, _idxAt = 0;
const invalidateIdx = () => { _idx = null; };
const buildIdx = () => {
  const map = {};
  const stack = workspacePaths();
  while (stack.length) {
    const dir = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) stack.push(abs); }
      else if (isAgentFile(e.name)) map[agentIdOfFile(e.name)] = abs;
    }
  }
  return map;
};
const findAgentFile = (uuid) => {
  const now = Date.now();
  if (!_idx || now - _idxAt > 3000) { _idx = buildIdx(); _idxAt = now; }
  const abs = _idx[uuid];
  if (abs && !fs.existsSync(abs)) { _idx = buildIdx(); _idxAt = now; return _idx[uuid] || null; }
  return abs || null;
};

const readAgentMeta = (abs) => { try { return JSON.parse(fs.readFileSync(abs, "utf8")) || {}; } catch { return {}; } };

// ── 构造统一 item ──
const spaceItem = (abs) => {
  const full = normalizeAbs(abs);
  const ws = isWorkspaceRoot(full) ? workspaceForPath(full) : null;
  return {
    id: full, parent_id: parentAbsOf(full), kind: "space",
    title: ws?.title || path.basename(full), system: null, content: null, position: null, last_read_at: null, created_at: null,
    workspace: !!ws,
  };
};
const agentItem = (abs) => {
  const m = readAgentMeta(abs);
  return {
    id: m.id || agentIdOfFile(path.basename(abs)),
    parent_id: parentAbsOf(abs), kind: "agent",
    title: m.title || "新智能体", system: m.system ?? null, content: null, position: null,
    last_read_at: m.last_read_at ?? null, created_at: m.created_at || null,
  };
};
const MAX_TEXT = 2_000_000;
const fileItem = (abs, withContent = false) => {
  const node = {
    id: abs, parent_id: parentAbsOf(abs), kind: "file",
    title: path.basename(abs), system: null, content: null, position: null, last_read_at: null, created_at: null,
    size: 0, binary: false, tooLarge: false,
  };
  if (!withContent) return node;
  node.created_at = statCreatedAt(abs);
  try { node.size = fs.statSync(abs).size; } catch {}
  if (node.size > MAX_TEXT) { node.tooLarge = true; return node; }
  let buf; try { buf = fs.readFileSync(abs); } catch { return node; }
  if (buf.subarray(0, 8192).includes(0)) { node.binary = true; return node; } // 二进制(NUL 字节)
  node.content = buf.toString("utf8");
  return node;
};

// 把 file id 解析成磁盘绝对路径(给 /api/file/raw 用);非文件返回 null
const resolveFileAbs = (id) => {
  const hit = locate(id);
  return hit && hit.kind === "file" ? hit.abs : null;
};

// 任意节点 → 磁盘绝对路径(文件夹=目录,文件=文件,智能体=.agent.json)。仅工作区内有效。
const pathForId = (id) => { const hit = locate(id); return hit ? hit.abs : null; };

// SKILL.md → { name, description }:优先 frontmatter,回退到首个标题 / 首行
const parseSkill = (content, fallbackName) => {
  let name = fallbackName, description = "";
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const n = fm[1].match(/^name:\s*(.+)$/m); if (n) name = n[1].trim().replace(/^["']|["']$/g, "");
    const d = fm[1].match(/^description:\s*(.+)$/m); if (d) description = d[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!description) {
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const h = body.match(/^#\s+(.+)$/m); if (h && !name) name = h[1].trim();
    const firstPara = body.split(/\n\s*\n/).map((s) => s.replace(/^#+\s*/, "").trim()).find((s) => s.length > 0);
    description = (firstPara || "").slice(0, 200);
  }
  return { name, description };
};

// 智能体上下文:只看智能体「自己所在的那个文件夹」—— 同级的 AGENTS.md / CLAUDE.md(指令)
// 和 skills/<名>/SKILL.md(可用技能)。不向上继承、不向下穿透:作用范围仅同级。
// 这些都只是树里的文件,放哪个文件夹就只对那个文件夹里的智能体生效。
const CONTEXT_DOC_NAMES = ["AGENTS.md", "CLAUDE.md"];
const agentContext = (startDir) => {
  const dir = normalizeAbs(startDir);
  if (!isAllowedPath(dir)) return { docs: [], skills: [] };
  const docs = [], skills = [];
  for (const nm of CONTEXT_DOC_NAMES) {
    const p = path.join(dir, nm);
    try {
      if (fs.statSync(p).isFile()) docs.push({ name: nm, rel: nm, content: fs.readFileSync(p, "utf8").slice(0, 6000) });
    } catch {}
  }
  const skillsDir = path.join(dir, "skills");
  try {
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHidden(e.name)) continue;
      const sp = path.join(skillsDir, e.name, "SKILL.md");
      try {
        const meta = parseSkill(fs.readFileSync(sp, "utf8"), e.name);
        skills.push({ ...meta, rel: path.join("skills", e.name, "SKILL.md") });
      } catch {}
    }
  } catch {}
  return { docs, skills };
};

// 递归列出整棵树所有节点(给 ⌘P 快速打开用),跳过 IGNORE_DIRS / 隐藏。不读文件内容。
const listAll = () => {
  const out = [];
  const walk = (dir) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) { out.push(spaceItem(abs)); walk(abs); } }
      else if (isAgentFile(e.name)) out.push(agentItem(abs));
      else out.push(fileItem(abs));
    }
  };
  for (const root of workspacePaths()) {
    out.push(spaceItem(root));
    walk(root);
  }
  return out;
};

// ── 定位 id 在磁盘上是什么 → { kind, abs } ──
const locate = (id) => {
  if (id == null || id === "") return null;
  const sid = String(id);
  if (isPathId(sid)) {
    const abs = normalizeAbs(sid);
    if (!isAllowedPath(abs)) return null;
    let st; try { st = fs.statSync(abs); } catch { return null; }
    return { kind: st.isDirectory() ? "space" : "file", abs };
  }
  const abs = findAgentFile(sid);
  return abs ? { kind: "agent", abs } : null;
};

// 取某 id 对应的「目录」:space=自身;agent/file=其所在目录
const dirOf = (id) => {
  const hit = locate(id);
  if (!hit) return workspacePaths()[0] || ensureRoot();
  return hit.kind === "space" ? hit.abs : path.dirname(hit.abs);
};
const agentDir = (id) => dirOf(id); // agent 的 shell 工作目录
const terminalCwd = (id) => {
  if (!id) return workspacePaths()[0] || ensureRoot();
  const hit = locate(id);
  if (hit) return hit.kind === "space" ? hit.abs : path.dirname(hit.abs);
  if (isPathId(String(id))) {
    const abs = normalizeAbs(id);
    if (!isAllowedPath(abs)) throw new Error(`path outside workspaces: ${abs}`);
    const st = fs.statSync(abs);
    return st.isDirectory() ? abs : path.dirname(abs);
  }
  return workspacePaths()[0] || ensureRoot();
};

// ════════════════ 公开 API(统一树 facade)════════════════

const listChildren = (parentId) => {
  let dirAbs;
  if (!parentId) {
    const out = workspaceRows().map((row) => spaceItem(row.path));
    out.forEach((n, i) => { n.position = i + 1; });
    return out;
  }
  else {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "space") return [];
    dirAbs = hit.abs;
  }
  let entries; try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(spaceItem(abs));
    else if (isAgentFile(e.name)) out.push(agentItem(abs));
    else out.push(fileItem(abs));
  }
  // 排序:智能体最前 → 和 AI 相关的上下文(AGENTS.md / CLAUDE.md / skills 目录)→ 其它文件夹 → 其它文件
  const isContextItem = (n) =>
    (n.kind === "space" && n.title === "skills") ||
    (n.kind === "file" && (n.title === "AGENTS.md" || n.title === "CLAUDE.md"));
  const rank = (n) =>
    n.kind === "agent" ? 0 : isContextItem(n) ? 1 : n.kind === "space" ? 2 : 3;
  out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  out.forEach((n, i) => { n.position = i + 1; });
  return out;
};

const getItem = (id) => {
  const hit = locate(id);
  if (!hit) return null;
  if (hit.kind === "space") return spaceItem(hit.abs);
  if (hit.kind === "agent") return agentItem(hit.abs);
  return fileItem(hit.abs, true);
};

const createItem = ({ kind, parentId = null, title, system = null, content = null }) => {
  let parentDir;
  if (parentId) {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "space") throw new Error(`父级必须是文件夹: ${parentId}`);
    parentDir = hit.abs;
  } else parentDir = workspacePaths()[0] || ensureRoot();

  if (kind === "agent") {
    const id = randomUUID();
    const abs = path.join(parentDir, `${id}${AGENT_EXT}`);
    fs.writeFileSync(abs, JSON.stringify({ id, title: String(title || "新智能体").trim() || "新智能体", system: system ? String(system) : null, last_read_at: null, created_at: dbNow() }, null, 2));
    invalidateIdx();
    return agentItem(abs);
  }
  if (kind === "space") {
    const abs = path.join(parentDir, sanitize(title));
    fs.mkdirSync(abs, { recursive: true });
    return spaceItem(abs);
  }
  if (kind === "file") {
    const abs = path.join(parentDir, sanitize(title));
    fs.writeFileSync(abs, content != null ? String(content) : "");
    return fileItem(abs, true);
  }
  throw new Error(`未知类型: ${kind}`);
};

const updateItem = (id, { title, system, content } = {}) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);

  if (hit.kind === "space" && isWorkspaceRoot(hit.abs)) {
    if (title !== undefined) {
      getDb().prepare("UPDATE workspaces SET title = ? WHERE path = ?").run(String(title || "").trim() || path.basename(hit.abs), hit.abs);
    }
    return spaceItem(hit.abs);
  }

  if (hit.kind === "agent") {
    const m = readAgentMeta(hit.abs);
    if (title !== undefined) m.title = String(title || "").trim() || m.title || "新智能体";
    if (system !== undefined) m.system = system == null ? null : String(system);
    fs.writeFileSync(hit.abs, JSON.stringify(m, null, 2));
    return agentItem(hit.abs);
  }
  if (hit.kind === "file") {
    let abs = hit.abs;
    if (content !== undefined) fs.writeFileSync(abs, content == null ? "" : String(content));
    if (title !== undefined) {
      const next = path.join(path.dirname(abs), sanitize(title));
      if (next !== abs) { fs.renameSync(abs, next); abs = next; }
    }
    return fileItem(abs, true);
  }
  // space:改名 = 目录改名
  let abs = hit.abs;
  if (title !== undefined) {
    const next = path.join(path.dirname(abs), sanitize(title));
    if (next !== abs) { fs.renameSync(abs, next); abs = next; invalidateIdx(); }
  }
  return spaceItem(abs);
};

// 清掉某智能体在 SQLite 里的消息/调用残留
const purgeAgent = (uuid) => {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE agent_id = ?").run(String(uuid));
  db.prepare("DELETE FROM calls WHERE caller_id = ? OR callee_id = ?").run(String(uuid), String(uuid));
};

const deleteItem = (id) => {
  const hit = locate(id);
  if (!hit) return;
  if (hit.kind === "agent") {
    fs.rmSync(hit.abs, { force: true });
    purgeAgent(agentIdOfFile(path.basename(hit.abs)));
    invalidateIdx();
    return;
  }
  if (hit.kind === "file") { fs.rmSync(hit.abs, { force: true }); return; }
  if (isWorkspaceRoot(hit.abs)) throw new Error("工作区根不能删除,请从 Arbor 移除工作区");
  // space:先清掉子树里所有智能体的 SQLite 残留,再整目录删
  const stack = [hit.abs];
  while (stack.length) {
    const dir = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!isHidden(e.name) && !IGNORE_DIRS.has(e.name)) stack.push(path.join(dir, e.name)); }
      else if (isAgentFile(e.name)) purgeAgent(agentIdOfFile(e.name));
    }
  }
  fs.rmSync(hit.abs, { recursive: true, force: true });
  invalidateIdx();
};

// 移到某空间下(newParentId 必须是空间或 null=根)。position 忽略(按名排序)。
const moveItem = (id, newParentId, _position = undefined) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);
  if (hit.kind === "space" && isWorkspaceRoot(hit.abs)) throw new Error("工作区根不能移动");
  let targetDir;
  if (newParentId) {
    const ph = locate(newParentId);
    if (!ph || ph.kind !== "space") throw new Error("目标必须是一个文件夹");
    targetDir = ph.abs;
  } else targetDir = workspacePaths()[0] || ensureRoot();

  if (hit.kind === "space") {
    if (targetDir === hit.abs || targetDir.startsWith(withSep(hit.abs))) throw new Error("不能把文件夹移进自己的子孙");
  }
  const next = path.join(targetDir, path.basename(hit.abs));
  if (next !== hit.abs) fs.renameSync(hit.abs, next);
  invalidateIdx();
  if (hit.kind === "space") return spaceItem(next);
  if (hit.kind === "agent") return agentItem(next);
  return fileItem(next, true);
};

const ancestry = (id) => {
  const chain = [];
  let cur = getItem(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_id != null ? getItem(cur.parent_id) : null;
  }
  return chain;
};

// 标记智能体已读
const markRead = (id) => {
  const hit = locate(id);
  if (!hit || hit.kind !== "agent") return getItem(id);
  const m = readAgentMeta(hit.abs);
  m.last_read_at = dbNow();
  fs.writeFileSync(hit.abs, JSON.stringify(m, null, 2));
  return agentItem(hit.abs);
};

// 一组智能体 id → {id -> unread}(有比 last_read_at 更新的消息)
const unreadMap = (ids) => {
  if (!ids?.length) return {};
  const db = getDb();
  const ph = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT agent_id, MAX(created_at) AS m FROM messages WHERE agent_id IN (${ph}) GROUP BY agent_id`).all(...ids.map(String));
  const latest = {};
  for (const r of rows) latest[r.agent_id] = r.m;
  const map = {};
  for (const id of ids) {
    const abs = findAgentFile(String(id));
    const lr = abs ? (readAgentMeta(abs).last_read_at || null) : null;
    const m = latest[String(id)] || null;
    map[id] = !!(m && (!lr || m > lr));
  }
  return map;
};

// agent.ts / functions.ts 用的别名
const getAgent = (id) => { const it = getItem(id); return it && it.kind === "agent" ? it : null; };
const createAgent = ({ spaceId = null, title, system = null } = {}) =>
  createItem({ kind: "agent", parentId: spaceId, title, system });

const addWorkspace = ({ path: rawPath, title } = {}) => {
  if (!String(rawPath || "").trim()) throw new Error("path is required");
  const abs = normalizeAbs(rawPath);
  let st; try { st = fs.statSync(abs); } catch { throw new Error(`目录不存在: ${abs}`); }
  if (!st.isDirectory()) throw new Error(`不是文件夹: ${abs}`);
  const name = String(title || "").trim() || path.basename(abs) || abs;
  const id = workspaceIdForPath(abs);
  getDb().prepare(`
    INSERT INTO workspaces (id, title, path, enabled, last_opened_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      enabled = 1,
      last_opened_at = datetime('now')
  `).run(id, name, abs);
  migrateLegacyAgentFiles([abs]);
  invalidateIdx();
  return spaceItem(abs);
};

const removeWorkspace = (idOrPath) => {
  const key = String(idOrPath || "");
  const rows = workspaceRows();
  const row = rows.find((r) => r.id === key || r.path === normalizeAbs(key));
  if (!row) return null;
  if (rows.length <= 1) throw new Error("至少保留一个工作区");
  getDb().prepare("UPDATE workspaces SET enabled = 0 WHERE id = ?").run(row.id);
  invalidateIdx();
  return row;
};

const listWorkspaces = () => workspaceRows();

export {
  ROOT, ensureRoot, IGNORE_DIRS,
  listChildren, listAll, getItem, createItem, updateItem, deleteItem, moveItem, ancestry,
  markRead, unreadMap, agentDir, getAgent, createAgent, resolveFileAbs, pathForId, agentContext,
  listWorkspaces, addWorkspace, removeWorkspace, isWorkspaceRoot, terminalCwd,
};
