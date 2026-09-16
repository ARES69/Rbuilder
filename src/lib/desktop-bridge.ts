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

export interface DesktopProcess {
  pid: number;
  kind: "preview" | "command";
  command: string;
  root: string;
  running: boolean;
}

export interface DesktopBridge {
  readonly available: true;
  readonly capabilities: readonly DesktopCapability[];
  pickWorkspace(): Promise<string | null>;
  listFiles(root: string): Promise<DesktopFileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  gitStatus(root: string): Promise<GitStatus>;
  gitDiff(root: string): Promise<string>;
  gitCommit(root: string, message: string): Promise<CommandResult>;
  gitBranches(root: string): Promise<string[]>;
  gitCheckout(root: string, branch: string): Promise<CommandResult>;
  gitCreateBranch(root: string, branch: string): Promise<CommandResult>;
  gitPull(root: string): Promise<CommandResult>;
  gitPush(root: string): Promise<CommandResult>;
  gitStash(root: string): Promise<CommandResult>;
  runCommand(root: string, command: string, args?: string[]): Promise<CommandResult>;
  startPreview(root: string, command?: string): Promise<{ url: string; pid?: number }>;
  listProcesses(): Promise<DesktopProcess[]>;
  stopProcess(pid: number): Promise<void>;
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
  deleteFile: "workspace_delete_file",
  gitStatus: "git_status",
  gitDiff: "git_diff",
  gitCommit: "git_commit",
  gitBranches: "git_branches",
  gitCheckout: "git_checkout",
  gitCreateBranch: "git_create_branch",
  gitPull: "git_pull",
  gitPush: "git_push",
  gitStash: "git_stash",
  runCommand: "terminal_run",
  startPreview: "preview_start",
  listProcesses: "process_list",
  stopProcess: "process_stop",
} as const;

type TauriLikeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): TauriLikeInvoke | null {
  if (typeof window === "undefined") return null;
  return window.__RBULDER_DESKTOP__?.invoke ?? window.__TAURI_INTERNALS__?.invoke ?? null;
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
    deleteFile: (path) => call<void>(DESKTOP_COMMANDS.deleteFile, { path }),
    gitStatus: (root) => call<GitStatus>(DESKTOP_COMMANDS.gitStatus, { root }),
    gitDiff: (root) => call<string>(DESKTOP_COMMANDS.gitDiff, { root }),
    gitCommit: (root, message) => call<CommandResult>(DESKTOP_COMMANDS.gitCommit, { root, message }),
    gitBranches: (root) => call<string[]>(DESKTOP_COMMANDS.gitBranches, { root }),
    gitCheckout: (root, branch) => call<CommandResult>(DESKTOP_COMMANDS.gitCheckout, { root, branch }),
    gitCreateBranch: (root, branch) => call<CommandResult>(DESKTOP_COMMANDS.gitCreateBranch, { root, branch }),
    gitPull: (root) => call<CommandResult>(DESKTOP_COMMANDS.gitPull, { root }),
    gitPush: (root) => call<CommandResult>(DESKTOP_COMMANDS.gitPush, { root }),
    gitStash: (root) => call<CommandResult>(DESKTOP_COMMANDS.gitStash, { root }),
    runCommand: (root, command, args = []) =>
      call<CommandResult>(DESKTOP_COMMANDS.runCommand, { root, command, args }),
    startPreview: (root, command = "bun run dev") =>
      call<{ url: string; pid?: number }>(DESKTOP_COMMANDS.startPreview, { root, command }),
    listProcesses: () => call<DesktopProcess[]>(DESKTOP_COMMANDS.listProcesses),
    stopProcess: (pid) => call<void>(DESKTOP_COMMANDS.stopProcess, { pid }),
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
