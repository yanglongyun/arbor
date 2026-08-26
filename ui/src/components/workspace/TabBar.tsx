import { useRef, useState } from "react";
import { iconFor, colorFor } from "../explorer/NodeRow";
import { X, Menu, Circle, GitBranch, GitCompare, MonitorPlay, PanelRight, Radio, Settings, Terminal } from "lucide-react";
import { ContextMenu, type MenuItem } from "../ui";
import type { WorkspaceGroupId, WorkspaceTab } from "./types";

const tabIconFor = (tab: WorkspaceTab) =>
  tab.kind === "git-diff" ? GitCompare :
  tab.kind === "git" ? GitBranch :
  tab.kind === "settings" ? Settings :
  tab.kind === "activity" ? Radio :
  tab.kind === "terminal" ? Terminal :
  tab.kind === "process" ? MonitorPlay : iconFor(tab.kind, tab.title);

const tabColorFor = (tab: WorkspaceTab) =>
  tab.kind === "git-diff" ? "text-accent" :
  tab.kind === "git" ? "text-accent" :
  tab.kind === "settings" ? "text-text-dim" :
  tab.kind === "activity" ? "text-accent" :
  tab.kind === "terminal" ? "text-success" :
  tab.kind === "process" ? "text-accent" : colorFor(tab.kind);

type DropGuide = {
  marker: { x: number; y: number; height: number };
  zone: { x: number; y: number; width: number; height: number };
};

// 多标签栏:预览标签斜体、指针拖拽重排/跨组移动、滚轮横向滚动
export function TabBar({
  tabs,
  activeId,
  groupId,
  dirtyIds,
  previewId,
  onActivate,
  onClose,
  onReorder,
  onMoveFromGroup,
  onMoveToOther,
  onToggleSideGroup,
  sideToggleOpen,
  onCloseOthers,
  onCloseToRight,
  onCloseGroup,
  onOpenNav,
}: {
  tabs: WorkspaceTab[];
  activeId: string | null;
  groupId: WorkspaceGroupId;
  dirtyIds: Set<string>;
  previewId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (next: WorkspaceTab[]) => void;
  onMoveFromGroup?: (fromGroupId: WorkspaceGroupId, tabId: string, toGroupId: WorkspaceGroupId, toIndex?: number) => void;
  onMoveToOther?: (id: string) => void;
  onToggleSideGroup?: () => void;
  sideToggleOpen?: boolean;
  onCloseOthers?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onCloseGroup?: () => void;
  onOpenNav?: () => void;
}) {
  const pointerDrag = useRef<{
    startX: number;
    startY: number;
    index: number;
    tabId: string;
    dragging: boolean;
    bodyCursor: string;
  } | null>(null);
  const suppressClick = useRef(false);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; tab: WorkspaceTab } | null>(null);
  const [dropGuide, setDropGuide] = useState<DropGuide | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 鼠标竖向滚轮 → 横向滚动标签;触控板横滑由 overflow-x-auto 原生处理
  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  };

  const reorderWithinGroup = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex + 1 === toIndex) return;
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved);
    onReorder(next);
  };

  const dropGuideFor = (targetGroupId: WorkspaceGroupId, toIndex: number): DropGuide | null => {
    const groupEl = document.querySelector<HTMLElement>(`section[data-tab-drop-group="${targetGroupId}"]`);
    const tabBarEl = document.querySelector<HTMLElement>(`[data-tab-bar-group="${targetGroupId}"]`);
    if (!groupEl || !tabBarEl) return null;

    const zoneRect = groupEl.getBoundingClientRect();
    const barRect = tabBarEl.getBoundingClientRect();
    const tabEls = Array.from(tabBarEl.querySelectorAll<HTMLElement>("[data-tab-index]"));
    let markerX = barRect.left + 8;
    if (tabEls.length) {
      if (toIndex <= 0) {
        markerX = tabEls[0].getBoundingClientRect().left;
      } else if (toIndex >= tabEls.length) {
        markerX = tabEls[tabEls.length - 1].getBoundingClientRect().right;
      } else {
        markerX = tabEls[toIndex].getBoundingClientRect().left;
      }
    }
    return {
      marker: { x: markerX, y: barRect.top + 5, height: Math.max(24, barRect.height - 10) },
      zone: { x: zoneRect.left, y: zoneRect.top, width: zoneRect.width, height: zoneRect.height },
    };
  };

  const dropTargetAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const groupEl = hit?.closest<HTMLElement>("[data-tab-drop-group]");
    if (!groupEl) return null;
    const targetGroupId = groupEl.dataset.tabDropGroup as WorkspaceGroupId | undefined;
    if (targetGroupId !== "main" && targetGroupId !== "side") return null;

    const tabEl = hit?.closest<HTMLElement>("[data-tab-index]");
    let toIndex = Number(groupEl.dataset.tabCount || "0");
    if (tabEl && tabEl.closest("[data-tab-drop-group]") === groupEl) {
      const idx = Number(tabEl.dataset.tabIndex || "0");
      const rect = tabEl.getBoundingClientRect();
      toIndex = x > rect.left + rect.width / 2 ? idx + 1 : idx;
    }
    return { groupId: targetGroupId, toIndex, guide: dropGuideFor(targetGroupId, toIndex) };
  };

  const startPointerDrag = (e: React.PointerEvent, tab: WorkspaceTab, index: number) => {
    if (e.button !== 0) return;
    pointerDrag.current = {
      startX: e.clientX,
      startY: e.clientY,
      index,
      tabId: tab.id,
      dragging: false,
      bodyCursor: document.body.style.cursor,
    };

    const onMove = (ev: PointerEvent) => {
      const drag = pointerDrag.current;
      if (!drag) return;
      const dist = Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY);
      if (!drag.dragging && dist > 6) {
        drag.dragging = true;
        document.body.style.cursor = "grabbing";
        setDraggingTabId(tab.id);
      }
      if (!drag.dragging) return;
      ev.preventDefault();
      setDragPreview({ x: ev.clientX, y: ev.clientY, tab });
      const target = dropTargetAt(ev.clientX, ev.clientY);
      setOverIdx(target?.groupId === groupId ? target.toIndex : null);
      setDropGuide(target?.guide || null);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const drag = pointerDrag.current;
      pointerDrag.current = null;
      document.body.style.cursor = drag?.bodyCursor || "";
      setOverIdx(null);
      setDraggingTabId(null);
      setDragPreview(null);
      setDropGuide(null);
      if (!drag?.dragging) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      const target = dropTargetAt(ev.clientX, ev.clientY);
      if (!target) return;
      if (target.groupId === groupId) reorderWithinGroup(drag.index, target.toIndex);
      else onMoveFromGroup?.(groupId, drag.tabId, target.groupId, target.toIndex);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const openTabMenu = (e: React.MouseEvent, tab: WorkspaceTab) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate(tab.id);
    const items: MenuItem[] = [];
    if (onMoveToOther) {
      items.push({ label: "移动到另一侧", icon: <PanelRight size={13} />, onClick: () => onMoveToOther(tab.id) });
      items.push("divider");
    }
    const idx = tabs.findIndex((t) => t.id === tab.id);
    items.push(
      { label: "关闭", icon: <X size={13} />, onClick: () => onClose(tab.id) },
      { label: "关闭其他标签", icon: <X size={13} />, onClick: () => onCloseOthers?.(tab.id), disabled: tabs.length <= 1 || !onCloseOthers },
      { label: "关闭右侧标签", icon: <X size={13} />, onClick: () => onCloseToRight?.(tab.id), disabled: idx < 0 || idx >= tabs.length - 1 || !onCloseToRight },
      "divider",
      { label: "关闭本组", icon: <X size={13} />, onClick: () => onCloseGroup?.(), disabled: !onCloseGroup },
    );
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div
      ref={scrollRef}
      onWheel={onWheel}
      data-tab-drop-group={groupId}
      data-tab-bar-group={groupId}
      data-tab-count={tabs.length}
      className="flex items-stretch h-11 bg-bg-raised border-b border-border overflow-x-auto no-scrollbar shrink-0"
    >
      {/* 侧边栏开关 */}
      {onOpenNav && (
        <button
          onClick={onOpenNav}
          className="px-2.5 flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover border-r border-border shrink-0"
          title="切换侧边栏"
        >
          <Menu size={16} />
        </button>
      )}

      {tabs.map((t, idx) => {
        const Icon = tabIconFor(t);
        const active = t.id === activeId;
        const running = t.kind === "agent" && t.status === "running";
        const unread = t.kind === "agent" && t.unread && !active;
        const dirty = t.kind === "file" && dirtyIds.has(t.id);
        const preview = t.id === previewId;
        return (
          <div
            key={t.id}
            data-tab-index={idx}
            data-tab-id={t.id}
            onPointerDown={(e) => startPointerDrag(e, t, idx)}
            onClick={(e) => {
              if (suppressClick.current) { e.preventDefault(); return; }
              onActivate(t.id);
            }}
            onAuxClick={(e) => { if (e.button === 1) onClose(t.id); }} // 中键关闭
            onContextMenu={(e) => openTabMenu(e, t)}
            title={t.title}
            className={[
              "group flex items-center gap-1.5 pl-3 pr-2 max-w-[200px] cursor-pointer select-none border-r border-border shrink-0",
              active
                ? "bg-bg text-text border-t-2 border-t-accent -mt-px"
                : "text-text-dim hover:bg-bg-hover hover:text-text border-t-2 border-t-transparent",
              draggingTabId === t.id ? "opacity-40" : "",
              overIdx === idx || overIdx === idx + 1 ? "bg-accent-soft" : "",
            ].join(" ")}
          >
            <span className="relative shrink-0">
              <Icon size={13} className={active ? tabColorFor(t) : "opacity-70"} />
              {running && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              )}
            </span>
            <span className={["text-[13px] truncate flex-1", preview ? "italic" : ""].join(" ")}>{t.title}</span>
            {unread && <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              className="w-4 h-4 rounded flex items-center justify-center shrink-0 hover:bg-bg-inset"
              title="关闭"
            >
              {dirty ? (
                <>
                  <Circle size={8} className="fill-current text-text-dim group-hover:hidden" />
                  <X size={12} className="hidden group-hover:block" />
                </>
              ) : (
                <X size={12} className={active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"} />
              )}
            </button>
          </div>
        );
      })}

      {onToggleSideGroup && (
        <button
          onClick={onToggleSideGroup}
          className={[
            "ml-auto flex px-2 items-center justify-center border-l border-border shrink-0",
            sideToggleOpen ? "text-accent bg-accent-soft hover:text-accent" : "text-text-faint hover:text-text hover:bg-bg-hover",
          ].join(" ")}
          title={sideToggleOpen ? "收起右侧区域" : "开启右侧区域"}
        >
          <PanelRight size={14} />
        </button>
      )}
      {dropGuide && (
        <>
          <div
            data-drop-guide="zone"
            className="fixed z-50 pointer-events-none border border-accent/40 bg-accent-soft/20"
            style={{
              left: dropGuide.zone.x,
              top: dropGuide.zone.y,
              width: dropGuide.zone.width,
              height: dropGuide.zone.height,
            }}
          />
          <div
            data-drop-guide="marker"
            className="fixed z-[60] pointer-events-none w-0.5 rounded-full bg-accent shadow-[0_0_0_2px_rgba(35,131,226,0.16)]"
            style={{
              left: dropGuide.marker.x - 1,
              top: dropGuide.marker.y,
              height: dropGuide.marker.height,
            }}
          />
        </>
      )}
      {dragPreview && (
        <DragPreview x={dragPreview.x} y={dragPreview.y} tab={dragPreview.tab} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function DragPreview({ x, y, tab }: { x: number; y: number; tab: WorkspaceTab }) {
  const Icon = tabIconFor(tab);
  return (
    <div
      data-drag-preview="tab"
      className="fixed z-[70] pointer-events-none flex h-8 max-w-[240px] items-center gap-1.5 rounded border border-border-strong bg-bg px-2 text-[13px] text-text shadow-lg"
      style={{ left: x + 10, top: y + 8 }}
    >
      <Icon size={13} className={tabColorFor(tab)} />
      <span className="truncate">{tab.title}</span>
    </div>
  );
}
