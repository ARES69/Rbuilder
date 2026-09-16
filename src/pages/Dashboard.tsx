import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  AppSidebar,
  CapabilityChips,
  type SidebarSection,
} from "@/components/app-sidebar";
import { ModelPicker, useSessionStatus } from "@/components/model-picker";
import { getModel, DAILY_SESSION_LIMIT } from "@/lib/models";
import { WorkspaceTabs, type WorkspaceTab } from "@/components/workspace-tabs";
import {
  CodePanel,
  DataPanel,
  ApiKeysPanel,
  IntegrationsPanel,
  UiComponentsPanel,
} from "@/components/workspace-panels";
import { SkillsPanel } from "@/components/skills-panel";
import { ToolsPanel } from "@/components/tools-panel";
import { resolveEnabledTools } from "@/lib/tools";
import { ThemeToggle } from "@/components/theme-toggle";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useConvex } from "convex/react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  Monitor,
  PanelLeft,
  Paperclip,
  Plus,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

interface StagedFile {
  id: string;
  file: File;
}

function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="max-w-xs text-xs leading-5 text-muted-foreground/80">{text}</p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Dashboard() {
  const { user, signOut, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const convex = useConvex();
  const isMobile = useIsMobile();

  const projects = useQuery(api.projects.list, {});
  const [selectedProjectId, setSelectedProjectId] =
    useState<Id<"projects"> | null>(null);

  const [input, setInput] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [generating, setGenerating] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [pendingModel, setPendingModel] = useState<string | undefined>(undefined);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("preview");
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const session = useSessionStatus();
  const todayKey = new Date().toISOString().slice(0, 10);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Effective selection: the explicit pick when set, otherwise the most
  // recent project. Derived during render — no state-sync effect needed.
  const effectiveProjectId =
    selectedProjectId ?? (projects?.length ? projects[0]._id : null);

  const projectDetail = useQuery(
    api.projects.get,
    effectiveProjectId ? { projectId: effectiveProjectId } : "skip",
  );
  const messages = useQuery(
    api.messages.list,
    effectiveProjectId ? { projectId: effectiveProjectId } : "skip",
  );
  const enabledSkillPrompts = useQuery(api.skills.enabledPrompts, {});
  const toolState = useQuery(api.tools.list, {});

  // Keep chat scrolled to the latest message.
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, generating]);

  const selectedProject = useMemo(() => {
    if (projectDetail) return projectDetail;
    return projects?.find((p) => p._id === effectiveProjectId) ?? null;
  }, [projectDetail, projects, effectiveProjectId]);

  const sendMessage = useMutation(api.messages.send);
  const commitBuild = useMutation(api.builds.commit);
  const setModelMutation = useMutation(api.projects.setModel);

  const activeModel = getModel(selectedProject?.model ?? pendingModel);

  const stagedSize = stagedFiles.reduce((sum, f) => sum + f.file.size, 0);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = Array.from(files).map((file, i) => ({
      id: `${Date.now()}-${i}`,
      file,
    }));
    setStagedFiles((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStaged = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleNewProject = async () => {
    try {
      const count = projects?.length ?? 0;
      const id = await convex.mutation(api.projects.create, {
        name: count === 0 ? "Untitled app" : `Untitled app ${count + 1}`,
      });
      setSelectedProjectId(id);
      setStagedFiles([]);
      setMobileTab("chat");
      setSidebarSection("chat");
    } catch {
      toast.error("Could not create a new project.");
    }
  };

  const handleDeleteProject = async () => {
    if (!effectiveProjectId) return;
    const deletedId = effectiveProjectId;
    setSelectedProjectId(null);
    try {
      await convex.mutation(api.projects.remove, { projectId: deletedId });
      toast.success("Project deleted.");
    } catch {
      toast.error("Could not delete the project.");
    }
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || generating || authLoading) return;

    const model = getModel(selectedProject?.model ?? pendingModel);
    const remaining = session ? session.limit - session.used : null;
    if (model.costsSession && remaining !== null && remaining <= 0) {
      toast.error(
        `Daily sessions used up (${DAILY_SESSION_LIMIT}/${DAILY_SESSION_LIMIT}). Pick an unmetered model in the picker to continue.`,
      );
      return;
    }

    setInput("");
    const files = stagedFiles;
    setStagedFiles([]);
    setGenerating(true);
    setMobileTab("preview");

    try {
      let projectId = effectiveProjectId;
      if (!projectId) {
        projectId = await convex.mutation(api.projects.create, {
          name: "Untitled app",
          prompt: content,
          model: model.id,
        });
        setSelectedProjectId(projectId);
      }

      // Upload staged files to Convex storage, then link them to the project.
      const attachmentIds: Id<"attachments">[] = [];
      for (const staged of files) {
        const uploadUrl = await convex.mutation(
          api.attachments.generateUploadUrl,
          {},
        );
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": staged.file.type || "application/octet-stream",
          },
          body: staged.file,
        });
        if (!response.ok) {
          throw new Error("Не удалось загрузить вложение");
        }
        const payload = (await response.json()) as {
          storageId?: Id<"_storage">;
        };
        if (!payload.storageId) {
          throw new Error("Сервер не вернул идентификатор файла");
        }
        const { storageId } = payload;
        const attachmentId = await convex.mutation(api.attachments.create, {
          projectId,
          name: staged.file.name,
          mimeType: staged.file.type || "application/octet-stream",
          size: staged.file.size,
          storageId,
        });
        attachmentIds.push(attachmentId);
      }

      await sendMessage({
        projectId,
        content,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      });

      const previous = await convex.query(api.projects.get, { projectId });
      const result = await convex.action(api.generation.run, {
        prompt: content,
        modelId: model.id,
        previousHtml: previous?.html ?? undefined,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        skillPrompts:
          enabledSkillPrompts && enabledSkillPrompts.length > 0
            ? enabledSkillPrompts
            : undefined,
        toolIds: resolveEnabledTools(toolState?.rows ?? []),
      });

      await commitBuild({
        projectId,
        html: result.html,
        demo: result.demo,
        trace: result.trace,
      });
      // A demo/fallback result is not a billable generation. Consume only after
      // a real build has completed, so missing or invalid provider keys do not
      // spend a user's daily session.
      if (model.costsSession && !result.demo) {
        await convex.mutation(api.sessions.consume, { day: todayKey });
      }
      setPreviewKey((k) => k + 1);
      toast.success(result.demo ? "Демо-режим: добавьте ключ модели" : "Сборка завершена");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Сборка не удалась. Попробуйте ещё раз.",
      );
    } finally {
      setGenerating(false);
    }
  };

  /** Fill the composer from a sidebar template/capability and focus chat. */
  const seedComposer = (prompt: string) => {
    setInput(prompt);
    setSidebarSection("chat");
    setMobileTab("chat");
  };

  const openPreviewInTab = () => {
    if (!selectedProject?.html) return;
    const blob = new Blob([selectedProject.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const signOutAndGoHome = async () => {
    await signOut();
    navigate("/");
  };

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Chat messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 p-4">
          {!messages || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span className="flex size-9 items-center justify-center rounded-full border border-border/80">
                <Sparkles className="size-4 text-muted-foreground" />
              </span>
              <p className="mt-4 text-sm font-medium">
Опишите приложение, которое хотите создать
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
Опишите идею обычными словами — рабочее веб-приложение появится
                в превью сразу после сборки.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message._id}
                className={cn(
                  "flex flex-col gap-1",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                  {message.role === "user" ? "Вы" : "RBuilder"}
                </span>
                <div
                  className={cn(
                    "max-w-[85%] px-3 py-2 text-sm leading-6 whitespace-pre-wrap",
                    message.role === "user"
                      ? "rounded-lg bg-muted text-foreground"
                      : "text-foreground/90",
                  )}
                >
                  {message.content}
                </div>
                {message.trace && message.trace.length > 0 && (
                  <div className="mt-1 flex max-w-[85%] flex-wrap gap-1">
                    {message.trace.map((step, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground"
                        title={step.note}
                      >
                        {step.agent}
                        {step.ms > 0 && ` · ${(step.ms / 1000).toFixed(1)}s`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {generating && (
            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {activeModel.name} pipeline: context → planner → builder →
              reviewer…
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="border-t border-border/70 p-3">
        {stagedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {stagedFiles.map((staged) => (
              <span
                key={staged.id}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-border/80 bg-muted/60 py-1 pr-1 pl-2 text-xs"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" />
                <span className="max-w-36 truncate">{staged.file.name}</span>
                <span className="text-muted-foreground/70">
                  {formatSize(staged.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeStaged(staged.id)}
                  className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
                  aria-label={`Remove ${staged.file.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Опишите приложение… Enter — отправить"
          rows={3}
          className="max-h-40 min-h-16 resize-none rounded-lg border-border/80 bg-card text-sm shadow-none"
          disabled={generating}
        />

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <ModelPicker
              value={selectedProject?.model ?? pendingModel}
              onChange={(id) => {
                if (effectiveProjectId) {
                  void setModelMutation({ projectId: effectiveProjectId, model: id });
                } else {
                  setPendingModel(id);
                }
              }}
              disabled={generating}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={generating}
            >
              <Paperclip className="size-3.5" />
              Прикрепить
            </Button>
            {stagedFiles.length > 0 && (
              <span className="text-xs text-muted-foreground/70">
                {stagedFiles.length} файл{stagedFiles.length > 1 ? "а" : ""}
                {stagedSize > 0 && ` · ${formatSize(stagedSize)}`}
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
            onClick={() => void handleSend()}
            disabled={generating || !input.trim()}
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="size-3.5" />
            )}
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );

  const previewPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Превью
          </span>
          {selectedProject && selectedProject.version > 0 && (
            <Badge
              variant="outline"
              className="h-5 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
            >
              v{selectedProject.version}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => setPreviewKey((k) => k + 1)}
            disabled={!selectedProject?.html}
            aria-label="Reload preview"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={openPreviewInTab}
            disabled={!selectedProject?.html}
            aria-label="Open preview in new tab"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/30 p-4">
        {selectedProject?.html ? (
          <iframe
            key={previewKey}
            title="App preview"
            srcDoc={selectedProject.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="h-full w-full rounded-md border border-border/70 bg-white"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border/80">
            <Monitor className="size-5 text-muted-foreground/60" />
            <p className="mt-2 text-xs text-muted-foreground/70">
              {generating
                ? "Рендерим приложение…"
                : "Опишите приложение, чтобы увидеть его здесь"}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const workspaceContent = (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceTabs
        value={workspaceTab}
        onChange={setWorkspaceTab}
        version={selectedProject?.version}
      />
      <div className="min-h-0 flex-1">
        {workspaceTab === "preview" ? (
          previewPanel
        ) : workspaceTab === "code" ? (
          <CodePanel html={selectedProject?.html} />
        ) : workspaceTab === "data" ? (
          effectiveProjectId ? (
            <DataPanel projectId={effectiveProjectId} />
          ) : (
            <PanelEmpty text="Create a project to browse its data." />
          )
        ) : workspaceTab === "skills" ? (
          <SkillsPanel activeModelId={activeModel.id} />
        ) : workspaceTab === "tools" ? (
          <ToolsPanel />
        ) : workspaceTab === "keys" ? (
          <ApiKeysPanel />
        ) : workspaceTab === "integrations" ? (
          <IntegrationsPanel />
        ) : (
          <UiComponentsPanel />
        )}
      </div>
    </div>
  );

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <div className="flex items-center gap-2">
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Показать панель" : "Скрыть панель"}
            >
              <PanelLeft className={cn("size-4", !sidebarCollapsed && "text-foreground")} />
            </Button>
          )}
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </span>

          {/* Project switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 max-w-56 gap-1.5 font-medium"
              >
                <span className="truncate">
                  {selectedProject?.name ?? "No project"}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Проекты
              </DropdownMenuLabel>
              {projects?.length ? (
                projects.map((p) => (
                  <DropdownMenuItem
                    key={p._id}
                    className="cursor-pointer justify-between"
                    onClick={() => {
                      setSelectedProjectId(p._id);
                      setMobileTab("chat");
                    }}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground/70">
                      {p.version > 0 ? `v${p.version}` : "new"}
                    </span>
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Пока нет проектов
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => void handleNewProject()}
              >
                <Plus className="size-4" />
                Новый проект
              </DropdownMenuItem>
              {selectedProjectId && (
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => void handleDeleteProject()}
                >
                  <X className="size-4" />
                  Удалить текущий проект
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {generating && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Loader2 className="size-3 animate-spin" />
              сборка
            </span>
          )}
          {session && (
            <span className="hidden text-xs text-muted-foreground/70 sm:block">
              {session.used}/{session.limit} сессий сегодня
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {user?.role === "admin" ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            >
              <Link to="/admin">
                <ShieldCheck className="size-3.5" />
                <span className="hidden sm:inline">Админ</span>
              </Link>
            </Button>
          ) : null}
          <ThemeToggle />
          <span className="mr-1 hidden text-xs text-muted-foreground/70 sm:block">
            {user?.email ?? "Гость"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={() => void signOutAndGoHome()}
            aria-label="Выйти"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* Sidebar + chat + preview */}
      {isMobile ? (
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "chat" | "preview")}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-auto mt-2 w-fit">
            <TabsTrigger value="chat">Чат</TabsTrigger>
            <TabsTrigger value="preview">Превью</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
            <CapabilityChips onPick={seedComposer} />
            {chatPanel}
          </TabsContent>
          <TabsContent value="preview" className="min-h-0 flex-1">
            {workspaceContent}
          </TabsContent>
        </Tabs>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel
            defaultSize={17}
            minSize={sidebarCollapsed ? 0 : 13}
            maxSize={26}
            onCollapse={() => setSidebarCollapsed(true)}
            onExpand={() => setSidebarCollapsed(false)}
            collapsedSize={sidebarCollapsed ? 0 : undefined}
          >
            <AppSidebar
              section={sidebarSection}
              onSectionChange={setSidebarSection}
              onNewProject={() => void handleNewProject()}
              onSelectProject={(id) => {
                setSelectedProjectId(id);
                setSidebarSection("chat");
                setMobileTab("chat");
              }}
              onSeedPrompt={seedComposer}
              activeProjectId={effectiveProjectId}
              collapsed={sidebarCollapsed}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={36} minSize={24} maxSize={56}>
            {chatPanel}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={47}>{workspaceContent}</ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  );
}
