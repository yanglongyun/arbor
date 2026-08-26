// @ts-nocheck
// 智能体服务:repo 之上的业务层 —— 富化未读、广播 agents_changed、校验工作目录。
import * as repo from "../repo/agents.js";
import { isAllowedPath } from "../repo/tree.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "agents_changed" });

const list = () => {
  const rows = repo.listAgents();
  const unread = repo.unreadMap(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, unread: !!unread[r.id] }));
};

const get = (id) => {
  const row = repo.getAgent(id);
  if (!row) return null;
  return { ...row, unread: !!repo.unreadMap([row.id])[row.id] };
};

const assertWorkdir = (workdir) => {
  if (workdir === undefined) return;
  if (!isAllowedPath(String(workdir))) throw new Error(`工作目录必须在某个工作区内: ${workdir}`);
};

const create = ({ title, system = null, workdir } = {}) => {
  if (workdir) assertWorkdir(workdir);
  const item = repo.createAgent({ title, system, workdir });
  changed();
  return item;
};

const update = (id, patch = {}) => {
  assertWorkdir(patch.workdir);
  const item = repo.updateAgent(id, patch);
  changed();
  return item;
};

const remove = (id) => {
  const ok = repo.deleteAgent(id);
  changed();
  return ok;
};

const markRead = (id) => repo.markRead(id);

/** 启动时:把磁盘上的历史 .agent.json 收进 SQLite,用户目录从此干净。 */
const migrateOnBoot = () => { try { repo.migrateAgentFiles(); } catch (e) { console.error("[agents] 迁移失败:", e?.message); } };

export { list, get, create, update, remove, markRead, migrateOnBoot };
