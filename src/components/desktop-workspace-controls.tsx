import { useState } from "react";
import { Archive, Download, ExternalLink, FileCode2, FolderOpen, GitBranch, GitCommitHorizontal, Loader2, Plus, RefreshCw, Save, Search, Terminal, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getDesktopRuntime, type DesktopFileEntry, type DesktopRuntime, type GitStatus } from "@/lib/desktop-bridge";

export function DesktopWorkspaceControls() {
  const [runtime] = useState<DesktopRuntime>(() => getDesktopRuntime());
  const [root, setRoot] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [gitOpen, setGitOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("bun test");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [files, setFiles] = useState<DesktopFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);

  const refreshGit = async (workspaceRoot: string) => {
    const [status, nextDiff, nextBranches] = await Promise.all([
      runtime.available ? runtime.gitStatus(workspaceRoot) : Promise.resolve(null),
      runtime.available ? runtime.gitDiff(workspaceRoot) : Promise.resolve(""),
      runtime.available ? runtime.gitBranches(workspaceRoot) : Promise.resolve([]),
    ]);
    setGit(status);
    setDiff(nextDiff);
    setBranches(nextBranches);
  };

  const openWorkspace = async () => {
    if (!runtime.available) {
      toast.info("Локальные папки доступны в RBuilder Desktop. Сейчас открыт web-режим.");
      return;
    }
    setLoading(true);
    try {
      const selected = await runtime.pickWorkspace();
      if (!selected) return;
      setRoot(selected);
      await refreshGit(selected);
      toast.success("Локальный workspace подключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть workspace");
    } finally {
      setLoading(false);
    }
  };

  const openGit = async () => {
    if (!runtime.available || !root) {
      toast.info("Git-панель станет доступна после подключения RBuilder Desktop.");
      return;
    }
    setGitLoading(true);
    try {
      await refreshGit(root);
      setGitOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось получить Git status");
    } finally {
      setGitLoading(false);
    }
  };

  const runGitAction = async (
    action: () => Promise<{ code: number; stderr: string }>,
    successMessage: string,
  ) => {
    if (!runtime.available || !root) return;
    setGitLoading(true);
    try {
      const result = await action();
      if (result.code !== 0) throw new Error(result.stderr || "Git operation failed");
      await refreshGit(root);
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Git operation failed");
    } finally {
      setGitLoading(false);
    }
  };

  const checkoutBranch = (branch: string) => {
    if (!branch || !root || branch === git?.branch) return;
    const run = () => runGitAction(
      () => runtime.available ? runtime.gitCheckout(root, branch) : Promise.reject(new Error("Desktop bridge недоступен")),
      `Ветка ${branch} выбрана`,
    );
    if (git?.entries.length) {
      setPendingAction({
        title: "Переключить ветку?",
        description: "В рабочем дереве есть незакоммиченные изменения. Переключение может привести к конфликтам или потере локальных правок.",
        run,
      });
    } else {
      void run();
    }
  };

  const createBranch = () => {
    const branch = newBranch.trim();
    if (!branch || !root) return;
    void runGitAction(() => runtime.available ? runtime.gitCreateBranch(root, branch) : Promise.reject(new Error("Desktop bridge недоступен")), `Ветка ${branch} создана`);
    setNewBranch("");
  };

  const openFiles = async () => {
    if (!runtime.available || !root) {
      toast.info("Файлы доступны после подключения RBuilder Desktop.");
      return;
    }
    setFileLoading(true);
    try {
      const entries = (await runtime.listFiles(root)).filter((entry) => entry.kind === "file");
      setFiles(entries);
      setFilesOpen(true);
      if (entries[0]) {
        setSelectedFile(entries[0].path);
        setFileContent(await runtime.readFile(entries[0].path));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось прочитать файловое дерево");
    } finally {
      setFileLoading(false);
    }
  };

  const selectFile = async (path: string) => {
    if (!runtime.available) return;
    setFileLoading(true);
    try {
      setSelectedFile(path);
      setFileContent(await runtime.readFile(path));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл");
    } finally {
      setFileLoading(false);
    }
  };

  const safeLocalPath = (relativePath: string) => {
    const path = relativePath.trim().split("\\\\").join("/").replace(/^\/+/, "");
    if (!path || path.includes("..") || path.startsWith(".git/") || path.startsWith("node_modules/") || path === ".env" || path.startsWith(".env.")) return null;
    if (!root) return null;
    const cleanRoot = root.endsWith("/") || root.endsWith("\\") ? root.slice(0, -1) : root;
    return `${cleanRoot}/${path}`;
  };

  const createFile = async () => {
    const path = safeLocalPath(newFilePath);
    if (!runtime.available || !path) {
      toast.error("Укажите безопасный путь файла, например src/App.tsx");
      return;
    }
    setFileSaving(true);
    try {
      await runtime.writeFile(path, "");
      setNewFilePath("");
      if (root) {
        const entries = (await runtime.listFiles(root)).filter((entry) => entry.kind === "file");
        setFiles(entries);
      }
      toast.success("Файл создан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать файл");
    } finally {
      setFileSaving(false);
    }
  };

  const deleteSelectedFile = () => {
    if (!runtime.available || !selectedFile) return;
    setPendingAction({
      title: "Удалить файл?",
      description: `Файл «${selectedFile}» будет удалён с локального диска. Это действие нельзя отменить автоматически.`,
      run: async () => {
        setFileSaving(true);
        try {
          await runtime.deleteFile(selectedFile);
          const nextFiles = root ? (await runtime.listFiles(root)).filter((entry) => entry.kind === "file") : [];
          setFiles(nextFiles);
          setSelectedFile(nextFiles[0]?.path ?? null);
          setFileContent(nextFiles[0] ? await runtime.readFile(nextFiles[0].path) : "");
          toast.success("Файл удалён");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось удалить файл");
        } finally {
          setFileSaving(false);
        }
      },
    });
  };

  const saveFile = async () => {
    if (!runtime.available || !selectedFile) return;
    setFileSaving(true);
    try {
      await runtime.writeFile(selectedFile, fileContent);
      toast.success("Файл сохранён");
      if (root) await refreshGit(root);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить файл");
    } finally {
      setFileSaving(false);
    }
  };

  const startLocalPreview = async () => {
    if (!runtime.available || !root) {
      toast.info("Локальный preview доступен после подключения RBuilder Desktop.");
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await runtime.startPreview(root);
      setPreviewUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
      toast.success("Локальный preview запущен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeTerminal = async () => {
    const commandLine = terminalCommand.trim();
    if (!runtime.available || !root || !commandLine) {
      if (!runtime.available) toast.info("Терминал доступен в RBuilder Desktop.");
      return;
    }
    const [command, ...args] = commandLine.split(/\\s+/);
    setTerminalRunning(true);
    try {
      const result = await runtime.runCommand(root, command, args);
      setTerminalOutput(`$ ${commandLine}\\n\\n${result.stdout}${result.stderr ? `\\n${result.stderr}` : ""}\\n[exit ${result.code}]`);
      if (result.code === 0) toast.success("Команда завершена");
      else toast.error(`Команда завершилась с кодом ${result.code}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось запустить команду";
      setTerminalOutput(`$ ${commandLine}\\n\\n${message}`);
      toast.error(message);
    } finally {
      setTerminalRunning(false);
    }
  };

  const runTerminal = () => {
    const command = terminalCommand.trim();
    if (!command) return;
    const safe = /^(pwd|ls|find|git\\s+(status|diff|log|branch)|bun\\s+(test|x\\s+tsc\\s+-b\\s+--noEmit)|npm\\s+test|pnpm\\s+test)(\\s|$)/.test(command);
    if (safe) {
      void executeTerminal();
      return;
    }
    setPendingAction({
      title: "Запустить команду?",
      description: `Команда «${command}» не входит в безопасный список. Она может изменить файлы, установить зависимости или удалить данные.`,
      run: executeTerminal,
    });
  };

  const commit = async () => {
    const message = commitMessage.trim();
    if (!runtime.available || !root || !message) return;
    setGitLoading(true);
    try {
      const result = await runtime.gitCommit(root, message);
      if (result.code !== 0) {
        throw new Error(result.stderr || "Git commit завершился с ошибкой");
      }
      setCommitMessage("");
      await refreshGit(root);
      toast.success("Commit создан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать commit");
    } finally {
      setGitLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground lg:inline-flex"
          onClick={() => void openWorkspace()}
          disabled={loading}
          title={root ?? "Открыть локальную папку"}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
          <span className="max-w-28 truncate">{root ? root.split(/[\\/]/).pop() : "Открыть папку"}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground lg:inline-flex"
          onClick={() => void openGit()}
          disabled={gitLoading}
          title="Открыть Git status и diff"
        >
          {gitLoading ? <Loader2 className="size-3.5 animate-spin" /> : <GitCommitHorizontal className="size-3.5" />}
          Git
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground lg:inline-flex"
          onClick={() => void startLocalPreview()}
          disabled={previewLoading}
          title="Запустить локальный preview"
        >
          {previewLoading ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
          Preview
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground lg:inline-flex"
          onClick={() => void openFiles()}
          disabled={fileLoading}
          title="Открыть локальные файлы"
        >
          {fileLoading ? <Loader2 className="size-3.5 animate-spin" /> : <FileCode2 className="size-3.5" />}
          Файлы
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground lg:inline-flex"
          onClick={() => {
            if (!runtime.available || !root) {
              toast.info("Терминал доступен после подключения RBuilder Desktop.");
            } else {
              setTerminalOpen(true);
            }
          }}
          title="Открыть терминал"
        >
          <Terminal className="size-3.5" /> Терминал
        </Button>
        {previewUrl && (
          <Badge variant="outline" className="hidden h-6 max-w-32 items-center gap-1 px-2 text-[10px] text-emerald-600 xl:inline-flex" title={previewUrl}>
            <span className="size-1.5 rounded-full bg-emerald-500" /> local
          </Badge>
        )}
        {git && (
          <Badge variant="outline" className="hidden h-6 max-w-36 gap-1 truncate px-2 text-[10px] text-muted-foreground xl:inline-flex" title={`${git.entries.length} изменений`}>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{git.branch}</span>
            {git.entries.length > 0 ? <span className="text-amber-600">· {git.entries.length}</span> : null}
          </Badge>
        )}
      </div>

      <Dialog open={gitOpen} onOpenChange={setGitOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-4" /> Локальный Git
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {root ?? "Локальный workspace"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <GitBranch className="size-3.5" /> {git?.branch ?? "unknown"}
            </span>
            <span className={git?.clean ? "text-emerald-600" : "text-amber-600"}>
              {git?.clean ? "Рабочее дерево чистое" : `${git?.entries.length ?? 0} изменений`}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => root && void openGit()} disabled={gitLoading} aria-label="Обновить Git status">
              <RefreshCw className={gitLoading ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
          </div>
          <div className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-xs font-medium">Ветки</p>
              <div className="flex gap-2">
                <select
                  value={git?.branch ?? ""}
                  onChange={(event) => checkoutBranch(event.target.value)}
                  disabled={gitLoading || !branches.length}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Текущая Git-ветка"
                >
                  {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
                <Button type="button" variant="outline" size="icon-sm" onClick={() => void runGitAction(() => runtime.available && root ? runtime.gitPull(root) : Promise.reject(new Error("Desktop bridge недоступен")), "Изменения получены")} disabled={gitLoading} title="Pull">
                  <Download className="size-3.5" />
                </Button>
                <Button type="button" variant="outline" size="icon-sm" onClick={() => setPendingAction({ title: "Отправить изменения?", description: "Push отправит локальные commit-ы в удалённый репозиторий. Убедитесь, что remote и ветка настроены правильно.", run: () => runGitAction(() => runtime.available && root ? runtime.gitPush(root) : Promise.reject(new Error("Desktop bridge недоступен")), "Изменения отправлены") })} disabled={gitLoading} title="Push">
                  <Upload className="size-3.5" />
                </Button>
                <Button type="button" variant="outline" size="icon-sm" onClick={() => setPendingAction({ title: "Убрать изменения в stash?", description: "Локальные изменения будут временно убраны из рабочего дерева. Их можно будет восстановить средствами Git.", run: () => runGitAction(() => runtime.available && root ? runtime.gitStash(root) : Promise.reject(new Error("Desktop bridge недоступен")), "Изменения убраны в stash") })} disabled={gitLoading} title="Stash">
                  <Archive className="size-3.5" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="Новая ветка" className="h-8 text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={createBranch} disabled={gitLoading || !newBranch.trim()}>Создать</Button>
              </div>
            </div>
            <div className="rounded-md bg-muted/30 p-2 text-[10px] leading-4 text-muted-foreground">
              Pull и Push выполняются только native runtime. Перед отправкой убедитесь, что remote настроен, а перед stash — что изменения можно временно убрать.
            </div>
          </div>
          <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="min-h-0 rounded-md border border-border/70 p-3">
              <p className="mb-2 text-xs font-medium">Изменённые файлы</p>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {git?.entries.length ? git.entries.map((entry) => (
                  <div key={`${entry.status}-${entry.path}`} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="h-5 min-w-6 justify-center px-1 text-[10px]">{entry.status[0].toUpperCase()}</Badge>
                    <span className="truncate" title={entry.path}>{entry.path}</span>
                  </div>
                )) : <p className="text-xs text-muted-foreground">Изменений нет</p>}
              </div>
            </div>
            <pre className="max-h-56 min-h-32 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-[10px] leading-4 text-foreground/80">
              {diff || "Diff пуст — рабочее дерево чистое."}
            </pre>
          </div>
          <div className="space-y-2">
            <label htmlFor="desktop-commit-message" className="text-xs font-medium">Сообщение commit</label>
            <Textarea
              id="desktop-commit-message"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Например: feat: add orders table"
              rows={2}
              className="resize-none text-xs"
              disabled={gitLoading || !git?.entries.length}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setGitOpen(false)}>Закрыть</Button>
            <Button type="button" size="sm" onClick={() => void commit()} disabled={gitLoading || !commitMessage.trim() || !git?.entries.length}>
              {gitLoading ? <Loader2 className="size-3.5 animate-spin" /> : <GitCommitHorizontal className="size-3.5" />}
              Создать commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><FileCode2 className="size-4" /> Локальные файлы</DialogTitle>
            <DialogDescription className="truncate text-xs">{root ?? "не подключены"}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
            <div className="min-h-0 rounded-md border border-border/70 p-2">
              <div className="mb-2 flex items-center gap-1.5 rounded border border-border/60 px-2">
                <Search className="size-3 text-muted-foreground" />
                <Input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="Поиск файлов" className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0" />
              </div>
              <div className="max-h-[45vh] overflow-y-auto">
              {files.filter((entry) => !fileSearch.trim() || entry.path.toLowerCase().includes(fileSearch.trim().toLowerCase())).length ? files.filter((entry) => !fileSearch.trim() || entry.path.toLowerCase().includes(fileSearch.trim().toLowerCase())).map((entry) => (
                <button key={entry.path} type="button" onClick={() => void selectFile(entry.path)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${selectedFile === entry.path ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}>
                  <FileCode2 className="size-3.5 shrink-0" /><span className="truncate" title={entry.path}>{entry.path}</span>
                </button>
              )) : <p className="p-2 text-xs text-muted-foreground">Файлы не найдены</p>}
              </div>
              <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
                <Input value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="src/NewFile.tsx" className="h-7 text-[10px]" />
                <Button type="button" variant="outline" size="icon-sm" onClick={() => void createFile()} disabled={fileSaving || !newFilePath.trim()} title="Создать файл"><Plus className="size-3.5" /></Button>
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{selectedFile ?? "Выберите файл"}</span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="icon-sm" onClick={deleteSelectedFile} disabled={fileSaving || !selectedFile} title="Удалить файл"><Trash2 className="size-3.5" /></Button>
                  <Button type="button" size="sm" onClick={() => void saveFile()} disabled={fileSaving || fileLoading || !selectedFile}>
                    {fileSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Сохранить
                  </Button>
                </div>
              </div>
              <Textarea value={fileContent} onChange={(event) => setFileContent(event.target.value)} disabled={fileLoading || !selectedFile} className="min-h-[48vh] resize-none font-mono text-xs leading-5" spellCheck={false} />
              <p className="text-[10px] text-muted-foreground">Сохранение изменяет файл на локальном диске и появится в Git diff.</p>
            </div>
          </div>
          <DialogFooter><Button type="button" variant="ghost" size="sm" onClick={() => setFilesOpen(false)}>Закрыть</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={terminalOpen} onOpenChange={setTerminalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Terminal className="size-4" /> Локальный терминал</DialogTitle>
            <DialogDescription className="truncate text-xs">Рабочая папка: {root ?? "не подключена"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="desktop-terminal-command" className="text-xs font-medium">Команда</label>
            <div className="flex gap-2">
              <Input
                id="desktop-terminal-command"
                value={terminalCommand}
                onChange={(event) => setTerminalCommand(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void runTerminal(); }}
                placeholder="bun test"
                className="font-mono text-xs"
                disabled={terminalRunning}
              />
              <Button type="button" size="sm" onClick={runTerminal} disabled={terminalRunning || !terminalCommand.trim()}>
                {terminalRunning ? <Loader2 className="size-3.5 animate-spin" /> : "Запустить"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Без подтверждения запускаются только команды чтения и проверок. Остальные потребуют подтверждение.</p>
          </div>
          <pre className="max-h-64 min-h-24 overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 text-[10px] leading-4 text-foreground/80">{terminalOutput || "Вывод команды появится здесь."}</pre>
          <DialogFooter><Button type="button" variant="ghost" size="sm" onClick={() => setTerminalOpen(false)}>Закрыть</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                if (action) void action.run();
              }}
            >
              Продолжить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
