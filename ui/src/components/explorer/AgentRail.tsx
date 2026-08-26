// 会话列表:智能体不再长在文件树里,这里是它们的家。
// 置顶 / 最近两组;行上呼吸点 = 正在运行,绿点 = 未读;悬停 ⋯ 出操作。
import { useCallback, useEffect, useState } from "react";
import type { Node } from "../../api";
import { api } from "../../api";
import { ContextMenu, type MenuItem } from "../ui";
import { Bot, Copy, FolderOpen, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const REVEAL_LABEL = /Mac/i.test(navigator.platform) ? "在 Finder 中显示工作目录" : "在文件管理器中显示工作目录";

export function AgentRail({
  selectedId,
  onSelect,
  refreshKey,
  socket,
  createReq,
  onCreateHandled,
}: {
  selectedId: string;
  onSelect: (n: Node) => void;
  refreshKey: number;
  socket: Socket;
  /** 外部(文件夹右键)发起的「在此新建」请求:带预设 workdir。 */
  createReq: { workdir?: string } | null;
  onCreateHandled: () => void;
}) {
  const [agents, setAgents] = useState<Node[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(async () => {
    const result = await api.listAgents().catch(() => null);
    if (result) setAgents(result.agents);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  // 呼吸点:事件即亮即灭,10 秒轮询兜底对账
  useEffect(() => {
    const sync = () => api.listRuns().then((r) => setRunning(new Set(r.ids || []))).catch(() => {});
    sync();
    const timer = setInterval(sync, 10_000);
    const offs = [
      socket.on("conversation.start", (p: any) => setRunning((s) => new Set(s).add(String(p.agentId)))),
      ...["conversation.done", "conversation.aborted", "conversation.error"].map((t) =>
        socket.on(t, (p: any) => setRunning((s) => { const n = new Set(s); n.delete(String(p.agentId)); return n; })),
      ),
    ];
    return () => { clearInterval(timer); offs.forEach((f) => f()); };
  }, [socket]);

  // 新建 = 直接开聊:落一条「未命名对话」并打开,名字是系统的事 ——
  // 首条消息跑完后服务端自动取名(runs 层独立补全调用)
  const createNow = async (workdir?: string) => {
    const result = await api.createAgent({ title: "", workdir });
    onSelect(result.node);
    load();
  };

  // 外部请求(顶部 + / 文件夹右键「在此新建对话」)
  useEffect(() => {
    if (!createReq) return;
    onCreateHandled();
    void createNow(createReq.workdir);
  }, [createReq]);

  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    await api.updateAgent(id, { title });
    load();
  };

  const onContext = (e: React.MouseEvent, agent: Node) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: agent.pinned ? "取消置顶" : "置顶",
          icon: agent.pinned ? <PinOff size={13} /> : <Pin size={13} className="text-accent" />,
          onClick: async () => { await api.updateAgent(agent.id, { pinned: !agent.pinned }); load(); } },
        { label: "重命名", icon: <Pencil size={13} />, onClick: () => { setRenamingId(agent.id); setRenameDraft(agent.title); } },
        { label: "复制 ID", icon: <Copy size={13} />,
          onClick: () => { navigator.clipboard.writeText(agent.id).catch(() => {}); } },
        { label: REVEAL_LABEL, icon: <FolderOpen size={13} />, onClick: () => { api.revealNode(agent.id).catch(() => {}); } },
        "divider",
        { label: "删除", icon: <Trash2 size={13} />, danger: true,
          onClick: async () => {
            if (!confirm(`删除对话「${agent.title}」?\n全部消息记录会一并删除;工作目录里的文件不受影响。`)) return;
            await api.deleteAgent(agent.id);
            load();
          } },
      ],
    });
  };

  const row = (agent: Node) => {
    const isSelected = selectedId === agent.id;
    const live = running.has(agent.id);
    const isRenaming = renamingId === agent.id;
    return (
      <div
        key={agent.id}
        onClick={() => { if (!isRenaming) onSelect(agent); }}
        onContextMenu={(e) => onContext(e, agent)}
        className={[
          "group flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text",
          isSelected && !isRenaming ? "bg-bg-inset" : "hover:bg-bg-hover",
        ].join(" ")}
      >
        <Bot size={14} className="shrink-0 text-warning" />
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-white border border-accent rounded px-1 -mx-1 py-px text-[14px] text-text outline-none"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[14.5px]">{agent.title}</span>
        )}
        {live
          ? <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent animate-pulse" title="正在运行" />
          : agent.unread
            ? <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-success" title="未读" />
            : null}
        <button
          onClick={(e) => { e.stopPropagation(); onContext(e, agent); }}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100 max-md:opacity-60"
          title="更多操作"
        >
          <span className="text-[15px] leading-none -mt-1">⋯</span>
        </button>
      </div>
    );
  };

  const pinned = agents.filter((a) => a.pinned);
  const recent = agents.filter((a) => !a.pinned);

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {pinned.length > 0 && (<>
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">置顶</div>
        {pinned.map(row)}
      </>)}
      {recent.length > 0 && (<>
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-text-faint select-none">最近</div>
        {recent.map(row)}
      </>)}

      {agents.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="text-3xl opacity-80">🌱</div>
          <div className="text-[13px] text-text-faint leading-relaxed">
            还没有对话。<br />每段对话都绑定一个真实文件夹。
          </div>
          <button
            onClick={() => void createNow()}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> 新建对话
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
