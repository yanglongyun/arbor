// 网站列表:侧栏第三页。行 = 收藏的链接,点击在工作区开网页标签(Electron <webview>)。
import { useCallback, useEffect, useRef, useState } from "react";
import type { Site } from "../../api";
import { api } from "../../api";
import { ContextMenu, type MenuItem } from "../ui";
import { Copy, ExternalLink, Globe, Link, Pencil, Plus, Trash2 } from "lucide-react";

export function SiteRail({
  refreshKey,
  onOpenUrl,
  createReq,
  onCreateHandled,
}: {
  refreshKey: number;
  onOpenUrl: (url: string, title?: string) => void;
  /** 外部(顶部 +)发起的「添加网站」请求。 */
  createReq: boolean;
  onCreateHandled: () => void;
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await api.listSites().catch(() => null);
    if (result) setSites(result.sites || []);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!createReq) return;
    onCreateHandled();
    setCreating(true);
    setDraftUrl("");
  }, [createReq]);
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const commitCreate = async () => {
    const url = draftUrl.trim();
    setCreating(false);
    setDraftUrl("");
    if (!url) return;
    try {
      const result = await api.createSite({ url });
      onOpenUrl(result.item.url, result.item.title); // 存下即打开
      load();
    } catch (e: any) {
      alert(e?.message || "网址不合法");
    }
  };

  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    await api.updateSite(id, { title });
    load();
  };

  const onContext = (e: React.MouseEvent, site: Site) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "重命名", icon: <Pencil size={13} />, onClick: () => { setRenamingId(site.id); setRenameDraft(site.title); } },
        { label: "修改网址", icon: <Link size={13} />,
          onClick: async () => {
            const next = window.prompt("网址:", site.url);
            if (!next || !next.trim()) return;
            try { await api.updateSite(site.id, { url: next.trim() }); load(); }
            catch (err: any) { alert(err?.message || "网址不合法"); }
          } },
        { label: "复制链接", icon: <Copy size={13} />, onClick: () => { navigator.clipboard.writeText(site.url).catch(() => {}); } },
        { label: "在系统浏览器打开", icon: <ExternalLink size={13} />, onClick: () => { window.open(site.url, "_blank"); } },
        "divider",
        { label: "删除", icon: <Trash2 size={13} />, danger: true,
          onClick: async () => {
            if (!confirm(`从网站列表删除「${site.title}」?`)) return;
            await api.deleteSite(site.id);
            load();
          } },
      ],
    });
  };

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {creating && (
        <div className="flex items-center gap-1.5 py-[4px] pl-3 pr-2">
          <Globe size={14} className="shrink-0 text-accent" />
          <input
            ref={inputRef}
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") { setCreating(false); setDraftUrl(""); }
            }}
            onBlur={commitCreate}
            placeholder="输入网址,回车打开…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-white border border-accent rounded px-1 -mx-1 py-px text-[13px] font-mono text-text outline-none placeholder:text-text-faint placeholder:font-sans"
          />
        </div>
      )}

      {sites.map((site) => (
        <div
          key={site.id}
          onClick={() => { if (renamingId !== site.id) onOpenUrl(site.url, site.title); }}
          onContextMenu={(e) => onContext(e, site)}
          className="group flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover"
          title={site.url}
        >
          <Globe size={14} className="shrink-0 text-accent" />
          {renamingId === site.id ? (
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
            <span className="flex-1 min-w-0 truncate text-[14.5px]">{site.title}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onContext(e, site); }}
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100 max-md:opacity-60"
            title="更多操作"
          >
            <span className="text-[15px] leading-none -mt-1">⋯</span>
          </button>
        </div>
      ))}

      {sites.length === 0 && !creating && (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Globe size={26} className="text-text-faint opacity-70" />
          <div className="text-[13px] text-text-faint leading-relaxed">
            还没有收藏的网站。<br />网页在标签页里打开,登录态保留在本机。
          </div>
          <button
            onClick={() => { setCreating(true); setDraftUrl(""); }}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
          >
            <Plus size={13} /> 添加网站
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
