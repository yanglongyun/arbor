import type { Settings, Node } from "../../api";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";
import type { WorkspaceGroupId, WorkspaceGroupState, WorkspaceTab } from "./types";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

const activeTabOf = (group: WorkspaceGroupState) =>
  group.tabs.find((tab) => tab.id === group.activeId) || null;

export function WorkspaceGroup({
  group,
  active,
  socket,
  dirtyIds,
  drafts,
  fileRefreshKeys,
  pendingGoto,
  gitRefreshKey,
  showNavButton,
  showSideToggle,
  sideOpen,
  onFocus,
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
  group: WorkspaceGroupState;
  active: boolean;
  socket: Socket;
  dirtyIds: Set<string>;
  drafts: Record<string, string>;
  fileRefreshKeys: Record<string, number>;
  pendingGoto: { id: string; line: number } | null;
  gitRefreshKey: number;
  showNavButton?: boolean;
  showSideToggle?: boolean;
  sideOpen: boolean;
  onFocus: (groupId: WorkspaceGroupId) => void;
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
  const tab = activeTabOf(group);

  return (
    <section
      onMouseDown={() => onFocus(group.id)}
      data-tab-drop-group={group.id}
      data-tab-count={group.tabs.length}
      className={[
        "flex-1 min-w-0 min-h-0 flex flex-col bg-bg",
        group.id === "side" ? "border-l border-border" : "",
        active ? "outline outline-1 outline-accent/25 outline-offset-[-1px]" : "",
      ].join(" ")}
    >
      <TabBar
        tabs={group.tabs}
        activeId={group.activeId}
        groupId={group.id}
        dirtyIds={dirtyIds}
        previewId={group.previewId}
        onActivate={(id) => onActivateTab(group.id, id)}
        onClose={(id) => onCloseTab(group.id, id)}
        onReorder={(tabs) => onReorderTabs(group.id, tabs)}
        onMoveFromGroup={(fromGroupId, tabId, toGroupId, toIndex) => onMoveTabFromGroup(fromGroupId, tabId, toGroupId, toIndex)}
        onMoveToOther={(id) => onMoveTab(group.id, id)}
        onToggleSideGroup={showSideToggle ? onToggleSideGroup : undefined}
        sideToggleOpen={sideOpen}
        onCloseOthers={(id) => onCloseOthers(group.id, id)}
        onCloseToRight={(id) => onCloseToRight(group.id, id)}
        onCloseGroup={() => onCloseGroup(group.id)}
        onOpenNav={showNavButton ? onOpenNav : undefined}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        <TabContent
          tab={tab}
          socket={socket}
          drafts={drafts}
          fileRefreshKeys={fileRefreshKeys}
          pendingGoto={pendingGoto}
          gitRefreshKey={gitRefreshKey}
          onFileChange={onFileChange}
          onFileSaved={onFileSaved}
          onSelect={onSelect}
          onOpenAgent={onOpenAgent}
          onOpenNav={showNavButton ? onOpenNav : undefined}
          onOpenSettings={onOpenSettings}
          onSettingsSaved={onSettingsSaved}
          onGitChanged={onGitChanged}
          onOpenGitDiff={onOpenGitDiff}
          onCloseProcess={() => onCloseTab(group.id, group.activeId || "")}
          onCloseTerminal={() => onCloseTab(group.id, group.activeId || "")}
        />
      </div>
    </section>
  );
}
