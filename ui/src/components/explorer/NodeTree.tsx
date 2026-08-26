import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepositoryStatus, Node } from "../../api";
import { api } from "../../api";
import { NodeRow, InlineCreateRow, iconFor, colorFor, type TreeControls } from "./NodeRow";
import { ContextMenu, type MenuItem } from "../ui";
import { Settings, Folder, FolderPlus, FolderOpen, FileText, Bot, Trash2, Pencil, Plus, X, Copy, PanelRight, Terminal, GitBranch, Radio } from "lucide-react";

const REVEAL_LABEL = /Mac/i.test(navigator.platform) ? "在 Finder 中显示"
  : /Win/i.test(navigator.platform) ? "在资源管理器中显示" : "在文件管理器中显示";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { useTreeDnd, ROOT_ID } from "./useTreeDnd";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

export function NodeTree({
  selectedId,
  onSelect,
  onOpenSide,
  onOpenTerminal,
  onOpenGit,
  createParentId,
  refreshKey,
  settingsActive,
  onOpenSettings,
  activityActive,
  onOpenActivity,
  mobileOpen = false,
  desktopOpen = true,
  onCloseMobile,
  onChanged,
}: {
  selectedId: string;
  onSelect: (n: Node | null) => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  activityActive?: boolean;
  onOpenActivity?: () => void;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  const [roots, setRoots] = useState<Node[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("arbor.sidebarWidth") || "");
    return Number.isFinite(saved) && saved >= 220 && saved <= 420 ? saved : 260;
  });
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [workspacePathDraft, setWorkspacePathDraft] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const autoExpandedWorkspaces = useRef<Set<string>>(new Set());

  // 展开集
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setExpanded = (id: string, on: boolean) =>
    setExpandedIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  // 创建
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<Node["kind"]>("space");
  const [draftTitle, setDraftTitle] = useState("");

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 菜单
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(async () => {
    const result = await api.listRoots();
    setRoots(result.nodes || []);
  }, []);

  // 变更后:既刷新根,又冒泡到 App 让 refreshKey 自增 → 所有展开的子节点立即重载
  const refresh = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  // 拖拽:状态 + 落库都在 hook 里
  const { sensors, activeNode, overInfo, overRoot, dndHandlers } = useTreeDnd({ refresh, setExpanded });

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const nextIds = roots.filter((root) => root.workspace && !autoExpandedWorkspaces.current.has(root.id)).map((root) => root.id);
    if (!nextIds.length) return;
    nextIds.forEach((id) => autoExpandedWorkspaces.current.add(id));
    setExpandedIds((current) => {
      const next = new Set(current);
      nextIds.forEach((id) => next.add(id));
      return next;
    });
  }, [roots]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(220, Math.min(420, startWidth + ev.clientX - startX));
      currentWidth = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      localStorage.setItem("arbor.sidebarWidth", String(Math.round(currentWidth)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── 创建 ──
  const startCreate = (parentId: string | null, kind: Node["kind"]) => {
    setCreatingUnder(parentId === null ? "" : parentId);
    setCreatingKind(kind);
    setDraftTitle("");
    if (parentId) setExpanded(parentId, true);
  };
  const currentCreateParentId = () => createParentId || roots[0]?.id || null;
  const commitCreate = async () => {
    const title = draftTitle.trim();
    if (creatingUnder === null) return;
    if (!title) { setCreatingUnder(null); setDraftTitle(""); return; }
    const parentId = creatingUnder === "" ? undefined : creatingUnder;
    const result = await api.createNode({ kind: creatingKind, title, parentId });
    setCreatingUnder(null);
    setDraftTitle("");
    handleSelect(result.node);
    refresh();
  };
  const cancelCreate = () => { setCreatingUnder(null); setDraftTitle(""); };

  const openAddWorkspace = () => {
    setWorkspacePathDraft("");
    setWorkspaceError(null);
    setAddWorkspaceOpen(true);
  };
  useEffect(() => {
    const open = () => openAddWorkspace();
    window.addEventListener("arbor:add-workspace", open);
    return () => window.removeEventListener("arbor:add-workspace", open);
  }, []);

  const addWorkspace = async () => {
    const workspacePath = workspacePathDraft.trim();
    if (!workspacePath) return;
    setAddingWorkspace(true);
    setWorkspaceError(null);
    try {
      const result = await api.addWorkspace({ path: workspacePath });
      setExpanded(result.node.id, true);
      handleSelect(result.node);
      setAddWorkspaceOpen(false);
      setWorkspacePathDraft("");
      refresh();
    } catch (e: any) {
      setWorkspaceError(e.message || "添加工作区失败");
    } finally {
      setAddingWorkspace(false);
    }
  };

  const pickWorkspace = async () => {
    setPickingWorkspace(true);
    setWorkspaceError(null);
    try {
      const result = await api.pickWorkspaceDirectory();
      if (result.path) setWorkspacePathDraft(result.path);
    } catch (e: any) {
      setWorkspaceError(e.message || "选择目录失败");
    } finally {
      setPickingWorkspace(false);
    }
  };

  // ── 重命名 ──
  const startRename = (n: Node) => { setRenamingId(n.id); setRenameDraft(n.title); };
  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    await api.updateNode(id, { title });
    refresh();
  };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(""); };

  // ── 右键 ──
  const onNodeContext = async (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [];
    let gitRepo: GitRepositoryStatus | null = null;
    if (node.kind === "space" && onOpenGit) {
      try {
        gitRepo = (await api.gitRepository(node.id)).repository;
      } catch {
        gitRepo = null;
      }
    }
    if (node.kind === "space") {
      items.push(
        { label: "新建智能体", icon: <Bot size={13} className="text-warning" />,
          onClick: () => startCreate(node.id, "agent") },
        "divider",
        { label: "新建文件夹", icon: <Folder size={13} className="text-accent" />,
          onClick: () => startCreate(node.id, "space") },
        { label: "新建文件", icon: <FileText size={13} className="text-text-faint" />,
          onClick: () => startCreate(node.id, "file") },
        "divider",
      );
    }
    // 智能体:复制稳定 uuid(给 call_agent 用);空间/文件:复制相对 workspaces 的干净路径
    const isConv = node.kind === "agent";
    const copyText = isConv ? node.id : node.id.replace(/^.*\/workspaces\//, "");
    if (node.kind !== "space" && onOpenSide) {
      items.push(
        { label: "打开到侧边", icon: <PanelRight size={13} />, onClick: () => onOpenSide(node) },
        "divider",
      );
    }
    items.push(
      { label: "重命名", icon: <Pencil size={13} />, onClick: () => startRename(node) },
      { label: isConv ? "复制 ID" : "复制路径", icon: <Copy size={13} />,
        onClick: async () => {
          try { await navigator.clipboard.writeText(copyText); }
          catch {
            const ta = document.createElement("textarea");
            ta.value = copyText; document.body.appendChild(ta);
            ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
          }
        },
      },
      { label: REVEAL_LABEL, icon: <FolderOpen size={13} />, onClick: () => { api.revealNode(node.id).catch(() => {}); } },
      "divider",
      { label: "打开终端", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node), disabled: !onOpenTerminal },
      { label: "启动 Codex", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "codex", titlePrefix: "Codex" }), disabled: !onOpenTerminal },
      { label: "启动 Claude Code", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "claude", titlePrefix: "Claude Code" }), disabled: !onOpenTerminal },
      "divider",
    );
    if (gitRepo?.root) {
      items.push(
        {
          label: `Git 变更 (${gitRepo.files.length})`,
          icon: <GitBranch size={13} className="text-accent" />,
          onClick: () => onOpenGit?.(gitRepo!),
        },
        "divider",
      );
    }
    items.push(
      { label: node.workspace ? "移除工作区" : "删除", icon: <Trash2 size={13} />, danger: true,
        onClick: async () => {
          if (node.workspace) {
            if (!confirm(`从 Arbor 移除工作区「${node.title}」?\n不会删除磁盘文件。`)) return;
            await api.removeWorkspace(node.id);
          } else {
            if (!confirm(`删除「${node.title}」?${node.kind === "space" ? "\n里面所有内容也会一起删除。" : ""}`)) return;
            await api.deleteNode(node.id);
          }
          if (selectedId === node.id) onSelect(null);
          refresh();
        },
      },
    );
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onBlankContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "添加工作区", icon: <FolderPlus size={13} className="text-accent" />, onClick: openAddWorkspace },
      ],
    });
  };

  const handleSelect = (n: Node | null) => {
    onSelect(n);
    if (mobileOpen && n?.kind !== "space") onCloseMobile?.();
  };
  const handleToggleActivity = () => {
    onOpenActivity?.();
    if (mobileOpen) onCloseMobile?.();
  };
  const handleToggleSettings = () => {
    onOpenSettings();
    if (mobileOpen) onCloseMobile?.();
  };

  // 「新建」下拉:智能体 / 空间 / 文件(锚在按钮下方,复用 ContextMenu)
  const openNewMenu = (e: React.MouseEvent, parentId: string | null = currentCreateParentId()) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 4,
      items: [
        { label: "新建智能体", icon: <Bot size={13} className="text-warning" />, onClick: () => startCreate(parentId, "agent") },
        "divider",
        { label: "新建文件夹", icon: <Folder size={13} className="text-accent" />, onClick: () => startCreate(parentId, "space") },
        { label: "新建文件", icon: <FileText size={13} className="text-text-faint" />, onClick: () => startCreate(parentId, "file") },
        "divider",
        { label: "添加工作区", icon: <FolderPlus size={13} className="text-accent" />, onClick: openAddWorkspace },
      ],
    });
  };

  const controls: TreeControls = {
    expandedIds, toggleExpand, setExpanded,
    creatingUnder, creatingKind, draftTitle, setDraftTitle, commitCreate, cancelCreate,
    renamingId, renameDraft, setRenameDraft, commitRename, cancelRename,
    activeId: activeNode?.id || null, overNodeId: overInfo?.nodeId || null, dropPos: overInfo?.pos || null,
  };
  return (
    <DndContext sensors={sensors} {...dndHandlers}>
      <aside
        style={{ width: `min(${sidebarWidth}px, calc(100vw - 32px))` }}
        className={[
          "flex-col border-r border-border bg-bg-raised shrink-0",
          "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
          "md:relative md:shadow-none",
          // 移动端:关闭时直接 hidden;桌面端由左上角汉堡切换
          mobileOpen ? "flex" : "hidden",
          desktopOpen ? "md:flex" : "md:hidden",
        ].join(" ")}
      >
        {/* brand */}
        <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-border">
          <span className="text-[20px] leading-none select-none">🌳</span>
          <span className="text-[17px] font-semibold text-text flex-1 tracking-tight">Arbor</span>
          <button onClick={openNewMenu} title="新建"
            className="w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover transition-colors">
            <Plus size={16} />
          </button>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <RootDroppable highlight={overRoot} onContextMenu={onBlankContext}>
          {creatingUnder === "" && <InlineCreateRow depth={0} controls={controls} />}

          {roots.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              selectedId={selectedId}
              onSelect={handleSelect}
              onContextMenu={onNodeContext}
              refreshKey={refreshKey}
              controls={controls}
            />
          ))}

          {roots.length === 0 && creatingUnder !== "" && (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="text-3xl opacity-80">🌱</div>
              <div className="text-[13px] text-text-faint leading-relaxed">
                还空着。<br />新建一个智能体或文件夹开始生长。
              </div>
              <button
                onClick={() => startCreate(null, "agent")}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
              >
                <Bot size={13} /> 新建智能体
              </button>
            </div>
          )}
        </RootDroppable>

        {/* footer */}
        <div className="border-t border-border px-1.5 py-1.5 flex items-center gap-1">
          <button
            onClick={handleToggleActivity}
            title="活动:智能体之间的调用"
            className={[
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors",
              activityActive ? "bg-bg-inset text-text" : "text-text-dim hover:bg-bg-hover hover:text-text",
            ].join(" ")}
          >
            <Radio size={13} />
            <span>活动</span>
          </button>
          <button
            onClick={handleToggleSettings}
            title="设置"
            className={[
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors",
              settingsActive ? "bg-bg-inset text-text" : "text-text-dim hover:bg-bg-hover hover:text-text",
            ].join(" ")}
          >
            <Settings size={13} />
            <span>设置</span>
          </button>
        </div>

        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
        {addWorkspaceOpen && (
          <AddWorkspaceDialog
            value={workspacePathDraft}
            error={workspaceError}
            submitting={addingWorkspace}
            picking={pickingWorkspace}
            onChange={(value) => { setWorkspacePathDraft(value); setWorkspaceError(null); }}
            onPick={pickWorkspace}
            onSubmit={addWorkspace}
            onClose={() => { if (!addingWorkspace && !pickingWorkspace) setAddWorkspaceOpen(false); }}
          />
        )}
        <div
          onPointerDown={startResize}
          className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
          title="调整侧边栏宽度"
        />
      </aside>

      {/* 拖动时跟手指/鼠标的预览 */}
      <DragOverlay dropAnimation={null}>
        {activeNode ? <DragPreview node={activeNode} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function RootDroppable({
  children,
  highlight,
  onContextMenu,
}: {
  children: React.ReactNode;
  highlight: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef } = useDroppable({ id: ROOT_ID });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 overflow-y-auto ${highlight ? "bg-accent-soft" : ""}`}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

function DragPreview({ node }: { node: Node }) {
  const Icon = iconFor(node.kind);
  const color = colorFor(node.kind);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-accent shadow-lg shadow-black/15 text-[14.5px] cursor-grabbing select-none">
      <Icon size={14} className={color} />
      <span className="truncate max-w-48">{node.title}</span>
    </div>
  );
}
