// 统一的一个 item:kind 区分它是空间 / 智能体 / 文件。
// 文件夹和文件在文件树上;智能体是会话(住 SQLite),只通过 workdir 绑定一个目录。
export type Node = {
  id: string;
  parent_id: string | null;                                      // 所在空间(根 = null;agent 恒为 null)
  kind: "space" | "agent" | "file";
  title: string;
  system: string | null;                                         // 仅 agent:人格
  content: string | null;                                        // 仅 file:内容
  position: number | null;
  last_read_at: string | null;                                   // 仅 agent
  created_at: string;
  workdir?: string;                                              // 仅 agent:绑定的工作目录
  pinned?: boolean;                                              // 仅 agent:置顶
  status?: "idle" | "running" | "done" | "error" | "cancelled";  // 仅 agent(界面按运行事件维护)
  unread?: boolean;                                              // 仅 agent
  size?: number;                                                 // 仅 file:字节数
  binary?: boolean;                                              // 仅 file:二进制,无法当文本预览
  tooLarge?: boolean;                                            // 仅 file:超过文本预览上限
  workspace?: boolean;                                           // node 且 parent_id=null 时表示工作区 root
};

export type SearchMatch = { line: number; text: string };
export type SearchResult = { id: string; title: string; matches: SearchMatch[] };

/** 侧栏「网站」页收藏的链接。 */
export type Site = { id: string; title: string; url: string; created_at: string };

/** 落库的 Responses item(body 解析后):user/system 消息、reasoning、message、function_call、function_call_output。 */
export type StoredItem = {
  type?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }> | null;
  summary?: Array<{ text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
};

/** 邮箱里的一行:一行一个 item。 */
export type MessageRow = {
  id: number;
  item: StoredItem;
  meta: Record<string, any> | null;
  usage: Record<string, any> | null;
  created_at: string;
};

export type Call = {
  id: number;
  caller_id: string | null;
  callee_id: string;
  request_msg_id: number | null;
  response_msg_id: number | null;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  callerTitle?: string | null;
  calleeTitle?: string | null;
};

export type Settings = {
  apiUrl: string;
  apiKey: string;
  model: string;
  system: string;
  compressThreshold?: string;
  compactPrompt?: string;
  toolResultMaxChars?: string;
};

export type ManagedProcess = {
  id: string;
  command: string;
  cwd: string;
  reason: string;
  pid: number | null;
  status: "running" | "exited" | "error" | "stopped";
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  signal: string | null;
  ports: number[];
  preview_url: string | null;
  output: string;
};

export type WorkspaceRoot = {
  id: string;
  title: string;
  path: string;
  enabled: number;
  created_at: string;
  last_opened_at: string | null;
};

export type GitFileStatus = {
  path: string;
  absPath: string;
  originalPath: string | null;
  index: string;
  worktree: string;
  status: "untracked" | "staged+modified" | "staged" | "modified" | "changed" | "conflict";
  renamed: boolean;
  staged: boolean;
  unstaged: boolean;
};

export type GitRepositoryStatus = {
  workspaceId: string;
  workspaceTitle: string;
  workspacePath: string;
  root: string | null;
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
};

export type GitBranches = {
  current: string;
  branches: string[];
};

const request = async <T>(path: string, opts: RequestInit = {}) => {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `${res.status}`);
  return data as T;
};

const jsonBody = (body: any): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// 后端返回 { item } / { items },这里统一映射成 { node } / { nodes } 供组件沿用
const one = (d: any) => ({ node: d.item as Node });
const many = (d: any) => ({ nodes: (d.items || []) as Node[] });

export const api = {
  health: () => request<{ ok: boolean }>("/health"),

  listRoots: () => request<{ items: Node[] }>("/api/tree?parentId=").then(many),
  listChildren: (parentId: string) =>
    request<{ items: Node[] }>(`/api/tree?parentId=${encodeURIComponent(parentId)}`).then(many),
  listAllNodes: () => request<{ items: Node[] }>("/api/tree/all").then(many),
  searchContent: (q: string) =>
    request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  getNode: (id: string) =>
    request<{ item: Node }>(`/api/tree/get?id=${encodeURIComponent(id)}`).then(one),
  createNode: (opts: { kind: "space" | "file"; title: string; parentId?: string; content?: string }) =>
    request<{ item: Node }>("/api/tree", { method: "POST", ...jsonBody(opts) }).then(one),
  updateNode: (id: string, patch: { title?: string; content?: string; parentId?: string | null }) =>
    request<{ item: Node }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }).then(one),
  moveNode: (id: string, newParentId: string | null, position?: number) =>
    request<{ item: Node }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody({ parentId: newParentId, position }) }).then(one),
  deleteNode: (id: string) =>
    request<{ ok: boolean }>(`/api/tree?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  ancestry: (id: string) =>
    request<{ ancestry: Node[] }>(`/api/ancestry?id=${encodeURIComponent(id)}`),

  // ── 智能体(会话列表)──
  listAgents: () => request<{ agents: Node[] }>("/api/agents").then((d) => ({ agents: (d.agents || []) as Node[] })),
  getAgent: (id: string) =>
    request<{ item: Node }>(`/api/agents/get?id=${encodeURIComponent(id)}`).then(one),
  createAgent: (opts: { title: string; workdir?: string; system?: string }) =>
    request<{ item: Node }>("/api/agents", { method: "POST", ...jsonBody(opts) }).then(one),
  updateAgent: (id: string, patch: { title?: string; system?: string; workdir?: string; pinned?: boolean }) =>
    request<{ item: Node }>(`/api/agents?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }).then(one),
  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  markAgentRead: (id: string) =>
    request<{ item: Node }>(`/api/agents/read?id=${encodeURIComponent(id)}`, { method: "POST" }).then(one),

  // ── 网站收藏 ──
  listSites: () => request<{ sites: Site[] }>("/api/sites"),
  createSite: (opts: { url: string; title?: string }) =>
    request<{ item: Site }>("/api/sites", { method: "POST", ...jsonBody(opts) }),
  updateSite: (id: string, patch: { title?: string; url?: string }) =>
    request<{ item: Site }>(`/api/sites?id=${encodeURIComponent(id)}`, { method: "PATCH", ...jsonBody(patch) }),
  deleteSite: (id: string) =>
    request<{ ok: boolean }>(`/api/sites?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  listWorkspaces: () => request<{ workspaces: WorkspaceRoot[] }>("/api/workspaces"),
  pickWorkspaceDirectory: () => request<{ path: string | null }>("/api/workspaces/pick", { method: "POST" }),
  addWorkspace: (opts: { path: string; title?: string }) =>
    request<{ item: Node }>("/api/workspaces", { method: "POST", ...jsonBody(opts) }).then(one),
  removeWorkspace: (id: string) =>
    request<{ ok: boolean; workspace: WorkspaceRoot | null }>(`/api/workspaces?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  listMessages: (agentId: string) =>
    request<{ rows: MessageRow[] }>(`/api/messages?agentId=${encodeURIComponent(agentId)}`),

  listRuns: () => request<{ ids: string[] }>("/api/runs"),

  listCalls: (params: { callerId?: string; calleeId?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.callerId) qs.set("callerId", params.callerId);
    if (params.calleeId) qs.set("calleeId", params.calleeId);
    if (params.status) qs.set("status", params.status);
    const tail = qs.toString() ? `?${qs}` : "";
    return request<{ calls: Call[] }>(`/api/calls${tail}`);
  },

  gitStatus: () => request<{ repositories: GitRepositoryStatus[] }>("/api/git/status"),
  gitRepository: (path: string) =>
    request<{ repository: GitRepositoryStatus | null }>(`/api/git/repository?path=${encodeURIComponent(path)}`),
  gitDiff: (opts: { root: string; path: string; staged?: boolean }) =>
    request<{ diff: string }>(`/api/git/diff?root=${encodeURIComponent(opts.root)}&path=${encodeURIComponent(opts.path)}${opts.staged ? "&staged=1" : ""}`),
  gitBranches: (root: string) =>
    request<GitBranches>(`/api/git/branches?root=${encodeURIComponent(root)}`),
  gitStage: (opts: { root: string; path?: string; all?: boolean }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/stage", { method: "POST", ...jsonBody(opts) }),
  gitUnstage: (opts: { root: string; path?: string; all?: boolean }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/unstage", { method: "POST", ...jsonBody(opts) }),
  gitDiscard: (opts: { root: string; path: string }) =>
    request<{ repository: GitRepositoryStatus }>("/api/git/discard", { method: "POST", ...jsonBody(opts) }),
  gitCommit: (opts: { root: string; message: string }) =>
    request<{ output: string; repository: GitRepositoryStatus }>("/api/git/commit", { method: "POST", ...jsonBody(opts) }),
  gitRemote: (opts: { root: string; action: "fetch" | "pull" | "push" }) =>
    request<{ output: string; repository: GitRepositoryStatus }>("/api/git/remote", { method: "POST", ...jsonBody(opts) }),
  gitCheckout: (opts: { root: string; branch: string }) =>
    request<{ output: string; repository: GitRepositoryStatus; branches: GitBranches }>("/api/git/checkout", { method: "POST", ...jsonBody(opts) }),
  gitInit: (opts: { workspacePath: string }) =>
    request<{ output: string; repository: GitRepositoryStatus }>("/api/git/init", { method: "POST", ...jsonBody(opts) }),

  getSettings: () => request<{ settings: Settings }>("/api/settings"),
  saveSettings: (s: Settings) =>
    request<{ settings: Settings }>("/api/settings", { method: "POST", ...jsonBody(s) }),

  listProcesses: () => request<{ processes: ManagedProcess[] }>("/api/processes"),
  getProcess: (id: string) =>
    request<{ process: ManagedProcess }>(`/api/processes/get?id=${encodeURIComponent(id)}`),
  stopProcess: (id: string) =>
    request<{ process: ManagedProcess }>(`/api/processes/stop?id=${encodeURIComponent(id)}`, { method: "POST" }),

  // 在系统文件管理器(Finder / 资源管理器)里显示该节点
  revealNode: (id: string) =>
    request<{ ok: boolean; path: string }>(`/api/reveal?id=${encodeURIComponent(id)}`, { method: "POST" }),
};
