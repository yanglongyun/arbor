import type { Node } from "../../api";

export const PROCESS_TAB_ID = "__process_preview__";
export const TERMINAL_TAB_PREFIX = "__terminal__";
export const GIT_TAB_PREFIX = "__git__";
export const GIT_DIFF_TAB_PREFIX = "__git_diff__";
export const SETTINGS_TAB_ID = "__settings__";
export const ACTIVITY_TAB_ID = "__activity__";

export type ProcessTab = {
  id: typeof PROCESS_TAB_ID;
  kind: "process";
  title: "Preview";
};

export type TerminalTab = {
  id: string;
  kind: "terminal";
  title: string;
  cwd: string;
  initialCommand?: string;
};

export type GitDiffTab = {
  id: string;
  kind: "git-diff";
  title: string;
  root: string;
  path: string;
  staged?: boolean;
};

export type GitTab = {
  id: string;
  kind: "git";
  title: string;
  root: string;
};

export type SettingsTab = {
  id: typeof SETTINGS_TAB_ID;
  kind: "settings";
  title: "设置";
};

export type ActivityTab = {
  id: typeof ACTIVITY_TAB_ID;
  kind: "activity";
  title: "活动";
};

export type WorkspaceTab = Node | ProcessTab | TerminalTab | GitTab | GitDiffTab | SettingsTab | ActivityTab;
export type WorkspaceGroupId = "main" | "side";

export type WorkspaceGroupState = {
  id: WorkspaceGroupId;
  tabs: WorkspaceTab[];
  activeId: string | null;
  previewId: string | null;
};

export const processTab = (): ProcessTab => ({
  id: PROCESS_TAB_ID,
  kind: "process",
  title: "Preview",
});

export const terminalTab = (cwd: string, title = "Terminal", initialCommand?: string): TerminalTab => ({
  id: `${TERMINAL_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "terminal",
  title,
  cwd,
  initialCommand,
});

export const gitTab = (root: string, title = "Git"): GitTab => ({
  id: `${GIT_TAB_PREFIX}:${root}`,
  kind: "git",
  title,
  root,
});

export const gitDiffTab = (root: string, filePath: string, staged = false): GitDiffTab => ({
  id: `${GIT_DIFF_TAB_PREFIX}:${root}:${filePath}:${staged ? "staged" : "worktree"}`,
  kind: "git-diff",
  title: `${filePath}${staged ? " (staged)" : ""}`,
  root,
  path: filePath,
  staged,
});

export const settingsTab = (): SettingsTab => ({
  id: SETTINGS_TAB_ID,
  kind: "settings",
  title: "设置",
});

export const activityTab = (): ActivityTab => ({
  id: ACTIVITY_TAB_ID,
  kind: "activity",
  title: "活动",
});

export const isProcessTab = (tab: WorkspaceTab | null | undefined): tab is ProcessTab =>
  tab?.kind === "process";

export const isTerminalTab = (tab: WorkspaceTab | null | undefined): tab is TerminalTab =>
  tab?.kind === "terminal";

export const isGitTab = (tab: WorkspaceTab | null | undefined): tab is GitTab =>
  tab?.kind === "git";

export const isGitDiffTab = (tab: WorkspaceTab | null | undefined): tab is GitDiffTab =>
  tab?.kind === "git-diff";

export const isSettingsTab = (tab: WorkspaceTab | null | undefined): tab is SettingsTab =>
  tab?.kind === "settings";

export const isActivityTab = (tab: WorkspaceTab | null | undefined): tab is ActivityTab =>
  tab?.kind === "activity";

export const isNodeTab = (tab: WorkspaceTab | null | undefined): tab is Node =>
  !!tab && tab.kind !== "process" && tab.kind !== "terminal" && tab.kind !== "git" && tab.kind !== "git-diff" && tab.kind !== "settings" && tab.kind !== "activity";

export const isOpenableSpace = (node: Node | null | undefined): node is Node =>
  !!node && node.kind !== "space";
