import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Settings, Node } from "../../api";
import { WorkspaceGroup } from "./WorkspaceGroup";
import type { WorkspaceGroupId, WorkspaceGroupState, WorkspaceTab } from "./types";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

const SPLIT_STORAGE_KEY = "arbor.workspaceSplitPercent";
const MIN_GROUP_WIDTH = 260;

const clampSplitPercent = (percent: number, width: number) => {
  if (!Number.isFinite(percent)) return 50;
  const minPercent = width > MIN_GROUP_WIDTH * 2 ? (MIN_GROUP_WIDTH / width) * 100 : 20;
  const maxPercent = 100 - minPercent;
  return Math.max(minPercent, Math.min(maxPercent, percent));
};

const readSavedSplit = () => {
  const saved = Number(localStorage.getItem(SPLIT_STORAGE_KEY) || "");
  return Number.isFinite(saved) && saved >= 20 && saved <= 80 ? saved : 50;
};

type SplitDragSession = {
  rect: DOMRect;
  bodyCursor: string;
  bodyUserSelect: string;
  handle: HTMLDivElement;
  pointerId: number;
  percent: number;
};

export function WorkspaceLayout({
  groups,
  activeGroupId,
  sideOpen,
  socket,
  dirtyIds,
  drafts,
  fileRefreshKeys,
  pendingGoto,
  gitRefreshKey,
  onFocusGroup,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  onMoveTabFromGroup,
  onMoveTab,
  onToggleSideGroup,
  onCloseOthers,
  onCloseToRight,
  onCloseGroup,
  onFileChange,
  onFileSaved,
  onSelect,
  onOpenAgent,
  onOpenNav,
  onOpenSettings,
  onSettingsSaved,
  onGitChanged,
  onOpenGitDiff,
}: {
  groups: WorkspaceGroupState[];
  activeGroupId: WorkspaceGroupId;
  sideOpen: boolean;
  socket: Socket;
  dirtyIds: Set<string>;
  drafts: Record<string, string>;
  fileRefreshKeys: Record<string, number>;
  pendingGoto: { id: string; line: number } | null;
  gitRefreshKey: number;
  onFocusGroup: (groupId: WorkspaceGroupId) => void;
  onActivateTab: (groupId: WorkspaceGroupId, id: string) => void;
  onCloseTab: (groupId: WorkspaceGroupId, id: string) => void;
  onReorderTabs: (groupId: WorkspaceGroupId, tabs: WorkspaceTab[]) => void;
  onMoveTabFromGroup: (fromGroupId: WorkspaceGroupId, tabId: string, toGroupId: WorkspaceGroupId, toIndex?: number) => void;
  onMoveTab: (groupId: WorkspaceGroupId, tabId: string) => void;
  onToggleSideGroup: () => void;
  onCloseOthers: (groupId: WorkspaceGroupId, keepId: string) => void;
  onCloseToRight: (groupId: WorkspaceGroupId, afterId: string) => void;
  onCloseGroup: (groupId: WorkspaceGroupId) => void;
  onFileChange: (id: string, value: string) => void;
  onFileSaved: (id: string) => void;
  onSelect: (n: Node) => void;
  onOpenAgent?: (id: string) => void;
  onOpenNav?: () => void;
  onOpenSettings: () => void;
  onSettingsSaved?: (settings: Settings) => void;
  onGitChanged?: () => void;
  onOpenGitDiff: (root: string, path: string, staged?: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef<SplitDragSession | null>(null);
  const [splitPercent, setSplitPercent] = useState(readSavedSplit);
  const [resizingSplit, setResizingSplit] = useState(false);
  const hasSplit = groups.length > 1;

  useEffect(() => {
    if (!hasSplit || !containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSplitPercent((current) => clampSplitPercent(current, entry.contentRect.width));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasSplit]);

  const updateSplitFromClientX = useCallback((clientX: number) => {
    const session = splitDragRef.current;
    if (!session || session.rect.width <= 0) return;
    const next = clampSplitPercent(((clientX - session.rect.left) / session.rect.width) * 100, session.rect.width);
    session.percent = next;
    setSplitPercent(next);
  }, []);

  const endSplitResize = useCallback(() => {
    const session = splitDragRef.current;
    if (!session) return;

    splitDragRef.current = null;
    setResizingSplit(false);
    document.body.style.cursor = session.bodyCursor;
    document.body.style.userSelect = session.bodyUserSelect;
    try {
      session.handle.releasePointerCapture(session.pointerId);
    } catch {
      // The browser may already have released capture after pointerup/cancel.
    }
    localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(session.percent * 10) / 10));
  }, []);

  useEffect(() => {
    if (!resizingSplit) return;

    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) {
        endSplitResize();
        return;
      }
      ev.preventDefault();
      updateSplitFromClientX(ev.clientX);
    };
    const onEnd = (ev: Event) => {
      ev.preventDefault();
      endSplitResize();
    };
    const onWindowBlur = () => endSplitResize();
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") endSplitResize();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    window.addEventListener("mouseup", onEnd, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("mouseup", onEnd, true);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [endSplitResize, resizingSplit, updateSplitFromClientX]);

  useEffect(() => {
    return () => {
      const session = splitDragRef.current;
      if (!session) return;
      splitDragRef.current = null;
      document.body.style.cursor = session.bodyCursor;
      document.body.style.userSelect = session.bodyUserSelect;
      try {
        session.handle.releasePointerCapture(session.pointerId);
      } catch {
        // The browser may already have released capture.
      }
      localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(session.percent * 10) / 10));
    };
  }, []);

  useEffect(() => {
    if (!hasSplit) endSplitResize();
  }, [endSplitResize, hasSplit]);

  const startSplitResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasSplit || !containerRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (splitDragRef.current) endSplitResize();

    const rect = containerRef.current.getBoundingClientRect();
    splitDragRef.current = {
      rect,
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
      handle: e.currentTarget,
      pointerId: e.pointerId,
      percent: splitPercent,
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort; the overlay and window listeners cover fallbacks.
    }
    setResizingSplit(true);
    updateSplitFromClientX(e.clientX);
  }, [endSplitResize, hasSplit, splitPercent, updateSplitFromClientX]);

  return (
    <div ref={containerRef} className="flex-1 flex min-w-0 min-h-0">
      {resizingSplit && <SplitResizeOverlay />}
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {hasSplit && index > 0 && <SplitHandle resizing={resizingSplit} onPointerDown={startSplitResize} />}
          <div
            className="min-w-0 min-h-0 flex"
            style={hasSplit ? { flex: `0 0 ${index === 0 ? splitPercent : 100 - splitPercent}%` } : { flex: "1 1 0%" }}
          >
            <WorkspaceGroup
              group={group}
              active={groups.length > 1 && group.id === activeGroupId}
              socket={socket}
              dirtyIds={dirtyIds}
              drafts={drafts}
              fileRefreshKeys={fileRefreshKeys}
              pendingGoto={pendingGoto}
              gitRefreshKey={gitRefreshKey}
              showNavButton={index === 0}
              showSideToggle={index === groups.length - 1}
              sideOpen={sideOpen}
              onFocus={onFocusGroup}
              onActivateTab={onActivateTab}
              onCloseTab={onCloseTab}
              onReorderTabs={onReorderTabs}
              onMoveTabFromGroup={onMoveTabFromGroup}
              onMoveTab={onMoveTab}
              onToggleSideGroup={onToggleSideGroup}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onCloseGroup={onCloseGroup}
              onFileChange={onFileChange}
              onFileSaved={onFileSaved}
              onSelect={onSelect}
              onOpenAgent={onOpenAgent}
              onOpenNav={onOpenNav}
              onOpenSettings={onOpenSettings}
              onSettingsSaved={onSettingsSaved}
              onGitChanged={onGitChanged}
              onOpenGitDiff={onOpenGitDiff}
            />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function SplitHandle({
  resizing,
  onPointerDown,
}: {
  resizing: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="调整左右宽度"
      onPointerDown={onPointerDown}
      className="relative z-20 w-0 shrink-0 cursor-col-resize group"
    >
      <div className="absolute inset-y-0 left-[-4px] w-2" />
      <div
        className={[
          "absolute inset-y-0 left-[-1px] w-0.5 transition-colors",
          resizing ? "bg-accent" : "bg-transparent group-hover:bg-accent/60",
        ].join(" ")}
      />
    </div>
  );
}

function SplitResizeOverlay() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[80] cursor-col-resize select-none"
      style={{ touchAction: "none" }}
    >
      <div className="h-full w-full" />
    </div>
  );
}
