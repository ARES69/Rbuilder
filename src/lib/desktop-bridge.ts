export type DesktopCapability = "filesystem" | "git" | "terminal" | "preview";

export interface DesktopFileEntry {
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: number;
}

export interface GitStatusEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
}

export interface GitStatus {
  branch: string;
  entries: GitStatusEntry[];
  ahead: number;
  behind: number;
  clean: boolean;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DesktopBridge {
  readonly available: true;
  readonly capabilities: readonly DesktopCapability[];
  pickWorkspace(): Promise<string | null>;
  listFiles(root: string): Promise<DesktopFileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  gitStatus(root: string): Promise<GitStatus>;
  gitDiff(root: string): Promise<string>;
  gitCommit(root: string, message: string): Promise<CommandResult>;
  runCommand(root: string, command: string, args?: string[]): Promise<CommandResult>;
  startPreview(root: string, command?: string): Promise<{ url: string; pid?: number }>;
}

export interface DesktopBridgeUnavailable {
  readonly available: false;
  readonly capabilities: readonly [];
  readonly reason: "browser-runtime";
}

export type DesktopRuntime = DesktopBridge | DesktopBridgeUnavailable;

/** Commands are intentionally explicit: the Tauri shell must allow-list these. */
export const DESKTOP_COMMANDS = {
  pickWorkspace: "workspace_pick",
  listFiles: "workspace_list_files",
  readFile: "workspace_read_file",
  writeFile: "workspace_write_file",
  gitStatus: "git_status",
  gitDiff: "git_diff",
  gitCommit: "git_commit",
  runCommand: "terminal_run",
  startPreview: "preview_start",
} as const;

type TauriLikeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): TauriLikeInvoke | null {
  if (typeof window === "undefined") return null;
  return window.__RBULDER_DESKTOP__?.invoke ?? null;
}

function createDesktopBridge(invoke: TauriLikeInvoke): DesktopBridge {
  const call = <T>(command: string, args?: Record<string, unknown>) =>
    invoke(command, args) as Promise<T>;

  return {
    available: true,
    capabilities: ["filesystem", "git", "terminal", "preview"],
    pickWorkspace: () => call<string | null>(DESKTOP_COMMANDS.pickWorkspace),
    listFiles: (root) => call<DesktopFileEntry[]>(DESKTOP_COMMANDS.listFiles, { root }),
    readFile: (path) => call<string>(DESKTOP_COMMANDS.readFile, { path }),
    writeFile: (path, content) => call<void>(DESKTOP_COMMANDS.writeFile, { path, content }),
    gitStatus: (root) => call<GitStatus>(DESKTOP_COMMANDS.gitStatus, { root }),
    gitDiff: (root) => call<string>(DESKTOP_COMMANDS.gitDiff, { root }),
    gitCommit: (root, message) => call<CommandResult>(DESKTOP_COMMANDS.gitCommit, { root, message }),
    runCommand: (root, command, args = []) =>
      call<CommandResult>(DESKTOP_COMMANDS.runCommand, { root, command, args }),
    startPreview: (root, command = "bun run dev") =>
      call<{ url: string; pid?: number }>(DESKTOP_COMMANDS.startPreview, { root, command }),
  };
}

/** Returns the native bridge when injected by Tauri, otherwise a harmless web status. */
export function getDesktopRuntime(): DesktopRuntime {
  const invoke = getInvoke();
  return invoke ? createDesktopBridge(invoke) : { available: false, capabilities: [], reason: "browser-runtime" };
}

export function isDesktopRuntime(runtime: DesktopRuntime): runtime is DesktopBridge {
  return runtime.available;
}
