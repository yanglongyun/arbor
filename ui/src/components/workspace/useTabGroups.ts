import { useCallback, useMemo, useRef, useState } from "react";
import type { Node } from "../../api";
import {
  isOpenableSpace,
  isNodeTab,
  gitTab,
  gitDiffTab,
  processTab,
  PROCESS_TAB_ID,
  settingsTab,
  activityTab,
  terminalTab,
  type WorkspaceGroupId,
  type WorkspaceGroupState,
  type WorkspaceTab,
} from "./types";

type UseTabGroupsOptions = {
  canCloseTab?: (tab: WorkspaceTab) => boolean;
  onTabClosed?: (tab: WorkspaceTab) => void;
};

const groupOrder: WorkspaceGroupId[] = ["main", "side"];

const emptyGroup = (id: WorkspaceGroupId): WorkspaceGroupState => ({
  id,
  tabs: [],
  activeId: null,
  previewId: null,
});

const otherGroup = (id: WorkspaceGroupId): WorkspaceGroupId => (id === "main" ? "side" : "main");

const activeTabOf = (group: WorkspaceGroupState) =>
  group.tabs.find((tab) => tab.id === group.activeId) || null;

const upsertTab = (group: WorkspaceGroupState, tab: WorkspaceTab, preview = false): WorkspaceGroupState => {
  const existing = group.tabs.some((t) => t.id === tab.id);
  const tabs = existing
    ? group.tabs.map((t) => (t.id === tab.id ? tab : t))
    : preview
      ? [...group.tabs.filter((t) => t.id !== group.previewId), tab]
      : [...group.tabs, tab];
  return {
    ...group,
    tabs,
    activeId: tab.id,
    previewId: preview ? tab.id : group.previewId === tab.id ? null : group.previewId,
  };
};

export function useTabGroups({ canCloseTab = () => true, onTabClosed = () => {} }: UseTabGroupsOptions = {}) {
  const [groups, setGroups] = useState<Record<WorkspaceGroupId, WorkspaceGroupState>>({
    main: emptyGroup("main"),
    side: emptyGroup("side"),
  });
  const [activeGroupId, setActiveGroupId] = useState<WorkspaceGroupId>("main");
  const [sideOpen, setSideOpen] = useState(false);

  const optionsRef = useRef({ canCloseTab, onTabClosed });
  const groupsRef = useRef(groups);
  const activeGroupRef = useRef(activeGroupId);
  optionsRef.current = { canCloseTab, onTabClosed };
  groupsRef.current = groups;
  activeGroupRef.current = activeGroupId;

  const visibleGroups = useMemo(() => {
    const main = groups.main;
    const side = groups.side;
    return sideOpen ? [main, side] : [main];
  }, [groups, sideOpen]);

  const allTabs = useMemo(
    () => groupOrder.flatMap((id) => groups[id].tabs),
    [groups],
  );

  const activeGroup = groups[activeGroupId];
  const activeTab = activeTabOf(activeGroup);

  const focusGroup = useCallback((groupId: WorkspaceGroupId) => setActiveGroupId(groupId), []);

  const toggleSideGroup = useCallback(() => {
    setSideOpen((open) => {
      const next = !open;
      setActiveGroupId(next ? "side" : "main");
      return next;
    });
  }, []);

  const openTab = useCallback((
    tab: WorkspaceTab,
    opts: { groupId?: WorkspaceGroupId; side?: boolean; preview?: boolean } = {},
  ) => {
    const targetId = opts.side ? otherGroup(activeGroupRef.current) : opts.groupId || activeGroupRef.current;
    if (targetId === "side") setSideOpen(true);
    setGroups((prev) => ({
      ...prev,
      [targetId]: upsertTab(prev[targetId], tab, !!opts.preview && isNodeTab(tab) && tab.kind === "file"),
    }));
    setActiveGroupId(targetId);
  }, []);

  const openNode = useCallback((node: Node | null, opts: { groupId?: WorkspaceGroupId; side?: boolean; preview?: boolean } = {}) => {
    if (!isOpenableSpace(node)) return;
    openTab(node, opts);
  }, [openTab]);

  const openProcess = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(processTab(), { groupId: opts.groupId || "side", side: opts.side });
  }, [openTab]);

  const openTerminal = useCallback((cwd: string, title = "Terminal", opts: { groupId?: WorkspaceGroupId; side?: boolean; command?: string } = {}) => {
    openTab(terminalTab(cwd, title, opts.command), opts);
  }, [openTab]);

  const openGit = useCallback((root: string, title = "Git", opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(gitTab(root, title), opts);
  }, [openTab]);

  const openGitDiff = useCallback((root: string, filePath: string, staged = false, opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(gitDiffTab(root, filePath, staged), opts);
  }, [openTab]);

  const openSettings = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(settingsTab(), opts);
  }, [openTab]);

  const openActivity = useCallback((opts: { groupId?: WorkspaceGroupId; side?: boolean } = {}) => {
    openTab(activityTab(), opts);
  }, [openTab]);

  const activateTab = useCallback((groupId: WorkspaceGroupId, id: string) => {
    setGroups((prev) => ({ ...prev, [groupId]: { ...prev[groupId], activeId: id } }));
    setActiveGroupId(groupId);
  }, []);

  const reorderTabs = useCallback((groupId: WorkspaceGroupId, tabs: WorkspaceTab[]) => {
    setGroups((prev) => ({ ...prev, [groupId]: { ...prev[groupId], tabs } }));
  }, []);

  const closeTabs = useCallback((groupId: WorkspaceGroupId, ids: string[]) => {
    const group = groupsRef.current[groupId];
    const closeSet = new Set(ids);
    const tabsToClose = group.tabs.filter((tab) => closeSet.has(tab.id));
    if (!tabsToClose.length) return;
    if (!tabsToClose.every((tab) => optionsRef.current.canCloseTab(tab))) return;
    const nextTabs = group.tabs.filter((tab) => !closeSet.has(tab.id));
    const activeWasClosed = !!group.activeId && closeSet.has(group.activeId);
    const firstClosedIdx = group.tabs.findIndex((tab) => closeSet.has(tab.id));
    setGroups((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        tabs: nextTabs,
        activeId: activeWasClosed
          ? nextTabs.length ? (nextTabs[firstClosedIdx] ?? nextTabs[firstClosedIdx - 1] ?? nextTabs[0]).id : null
          : prev[groupId].activeId,
        previewId: closeSet.has(prev[groupId].previewId || "") ? null : prev[groupId].previewId,
      },
    }));
    tabsToClose.forEach(optionsRef.current.onTabClosed);
  }, []);

  const closeTab = useCallback((groupId: WorkspaceGroupId, id: string) => {
    const group = groupsRef.current[groupId];
    const idx = group.tabs.findIndex((tab) => tab.id === id);
    if (idx === -1) return;
    closeTabs(groupId, [id]);
  }, [closeTabs]);

  const moveTab = useCallback((fromId: WorkspaceGroupId, tabId: string, toId = otherGroup(fromId), toIndex?: number) => {
    const from = groupsRef.current[fromId];
    const tab = from.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (toId === "side") setSideOpen(true);
    setGroups((prev) => {
      const source = prev[fromId];
      const target = prev[toId];
      const idx = source.tabs.findIndex((t) => t.id === tabId);
      const sourceTabs = source.tabs.filter((t) => t.id !== tabId);
      const withoutExisting = target.tabs.filter((t) => t.id !== tabId);
      const insertAt = Math.max(0, Math.min(withoutExisting.length, toIndex ?? withoutExisting.length));
      const targetTabs = [...withoutExisting];
      targetTabs.splice(insertAt, 0, tab);
      return {
        ...prev,
        [fromId]: {
          ...source,
          tabs: sourceTabs,
          activeId: source.activeId === tabId
            ? sourceTabs.length ? (sourceTabs[idx] ?? sourceTabs[idx - 1]).id : null
            : source.activeId,
          previewId: source.previewId === tabId ? null : source.previewId,
        },
        [toId]: {
          ...target,
          tabs: targetTabs,
          activeId: tab.id,
          previewId: target.previewId === tab.id ? null : target.previewId,
        },
      };
    });
    setActiveGroupId(toId);
  }, []);

  const closeOthers = useCallback((groupId: WorkspaceGroupId, keepId: string) => {
    const group = groupsRef.current[groupId];
    closeTabs(groupId, group.tabs.filter((tab) => tab.id !== keepId).map((tab) => tab.id));
  }, [closeTabs]);

  const closeToRight = useCallback((groupId: WorkspaceGroupId, afterId: string) => {
    const group = groupsRef.current[groupId];
    const idx = group.tabs.findIndex((tab) => tab.id === afterId);
    if (idx < 0) return;
    closeTabs(groupId, group.tabs.slice(idx + 1).map((tab) => tab.id));
  }, [closeTabs]);

  const closeGroup = useCallback((groupId: WorkspaceGroupId) => {
    const group = groupsRef.current[groupId];
    closeTabs(groupId, group.tabs.map((tab) => tab.id));
  }, [closeTabs]);

  const updateNodeTab = useCallback((id: string, patch: Node) => {
    setGroups((prev) => {
      const next = { ...prev };
      for (const groupId of groupOrder) {
        next[groupId] = {
          ...next[groupId],
          tabs: next[groupId].tabs.map((tab) => (tab.id === id && isNodeTab(tab) ? { ...tab, ...patch } : tab)),
        };
      }
      return next;
    });
  }, []);

  const removeNodeTab = useCallback((id: string) => {
    for (const groupId of groupOrder) closeTab(groupId, id);
  }, [closeTab]);

  const pinPreviewTab = useCallback((id: string) => {
    setGroups((prev) => {
      const next = { ...prev };
      for (const groupId of groupOrder) {
        next[groupId] = {
          ...next[groupId],
          previewId: next[groupId].previewId === id ? null : next[groupId].previewId,
        };
      }
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    const currentTabs = groupOrder.flatMap((id) => groupsRef.current[id].tabs);
    const closable = currentTabs.every((tab) => optionsRef.current.canCloseTab(tab));
    if (!closable) return;
    setGroups({ main: emptyGroup("main"), side: emptyGroup("side") });
    currentTabs.forEach(optionsRef.current.onTabClosed);
    setActiveGroupId("main");
  }, []);

  return {
    groups,
    sideOpen,
    visibleGroups,
    allTabs,
    activeGroupId,
    activeGroup,
    activeTab,
    activeNode: isNodeTab(activeTab) ? activeTab : null,
    focusGroup,
    toggleSideGroup,
    openNode,
    openProcess,
    openTerminal,
    openGit,
    openGitDiff,
    openSettings,
    openActivity,
    activateTab,
    reorderTabs,
    closeTabs,
    closeTab,
    moveTab,
    closeOthers,
    closeToRight,
    closeGroup,
    updateNodeTab,
    removeNodeTab,
    pinPreviewTab,
    closeAll,
    processTabId: PROCESS_TAB_ID,
  };
}
