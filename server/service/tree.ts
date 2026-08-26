// @ts-nocheck
// 树服务:repo 之上的业务层 —— 负责事件广播(tree_changed)+ 给智能体富化运行状态/未读,
// 并把 update+move 这类组合操作收拢。API 只管 HTTP,业务都在这。
import * as repo from "../repo/tree.js";
import { latestCallStatusMap } from "../repo/calls.js";
import { searchContent } from "../repo/search.js";
import { emit } from "../bus.js";

// 给智能体(agent)附加运行状态点 + 未读
const enrich = (items) => {
  const agentIds = items.filter((n) => n.kind === "agent").map((n) => n.id);
  if (!agentIds.length) return items;
  const statusMap = latestCallStatusMap(agentIds);
  const unread = repo.unreadMap(agentIds);
  return items.map((n) =>
    n.kind === "agent"
      ? { ...n, status: statusMap[n.id] || "idle", unread: !!unread[n.id] }
      : n,
  );
};

const listChildren = (parentId) => enrich(repo.listChildren(parentId || null));
const listAll = () => enrich(repo.listAll());
const getItem = (id) => {
  const it = repo.getItem(id);
  return it ? enrich([it])[0] : null;
};

const create = ({ kind, parentId = null, title = "", system = null, content = null } = {}) => {
  const item = repo.createItem({ kind: kind || "space", parentId: parentId || null, title, system, content });
  emit({ type: "tree_changed", item, reason: "created" });
  return item;
};

// 改名/改内容/改人格 + 移动(都可选),最后返回富化后的最新项
const update = (id, { title, system, content, parentId, position } = {}) => {
  if (title !== undefined || system !== undefined || content !== undefined) {
    repo.updateItem(id, { title, system, content });
  }
  if (parentId !== undefined || position !== undefined) {
    const cur = repo.getItem(id);
    const target = parentId !== undefined ? parentId : cur?.parent_id;
    repo.moveItem(id, target, position);
  }
  const item = getItem(id);
  emit({ type: "tree_changed", item, reason: "updated" });
  return item;
};

const remove = (id) => {
  repo.deleteItem(id);
  emit({ type: "tree_changed", id, reason: "deleted" });
};

const listWorkspaces = () => repo.listWorkspaces();

const addWorkspace = (body = {}) => {
  const item = repo.addWorkspace(body);
  emit({ type: "tree_changed", item, reason: "workspace_added" });
  return item;
};

const removeWorkspace = (id) => {
  const workspace = repo.removeWorkspace(id);
  emit({ type: "tree_changed", id, reason: "workspace_removed" });
  return workspace;
};

const markRead = (id) => {
  repo.markRead(id);
  return getItem(id);
};

const ancestry = (id) => repo.ancestry(id);
const search = (q) => (q ? searchContent(q) : []);
const fileRawAbs = (id) => repo.resolveFileAbs(id);
const pathForId = (id) => repo.pathForId(id);
const terminalCwd = (id) => repo.terminalCwd(id);

export { enrich, listChildren, listAll, getItem, create, update, remove, markRead, ancestry, search, fileRawAbs, pathForId, listWorkspaces, addWorkspace, removeWorkspace, terminalCwd };
