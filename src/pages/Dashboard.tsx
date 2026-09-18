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
import { EXPO_PREVIEW_PATH } from "@/lib/generation-core";
import { ARCHITECTURES, DEFAULT_ARCHITECTURE_ID } from "@/lib/architecture";
import { SNIPPETS, SNIPPET_CATEGORIES } from "@/lib/snippets";
import {
  collectElementContext,
  formatElementContext,
  pickedElementPrompt,
  type PreviewElementContext,
} from "@/lib/element-context";
import { publishUrl, shortHost } from "@/lib/deploy";
import {
  countIssues,
  detectAntiPatterns,
  issuesToPrompt,
  type AntiPatternIssue,
} from "@/lib/anti-patterns";
import { PROMPT_PRESETS } from "@/lib/prompt-presets";
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
import { SnapshotsPanel } from "@/components/snapshots-panel";
import { ImportDialog } from "@/components/import-dialog";
import { resolveEnabledTools } from "@/lib/tools";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocalModelBridge } from "@/components/local-model-bridge";
import { DesktopStatus } from "@/components/desktop-status";
import { DesktopWorkspaceControls } from "@/components/desktop-workspace-controls";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ClipboardList,
  ExternalLink,
  Layers3,
  AlertTriangle,
  Brain,
  FileText,
  Link2,
  FileInput,
  Loader2,
  LogOut,
  Monitor,
  Smartphone,
  PanelLeft,
  Rocket,

  Puzzle,
  SlidersHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  MousePointer2,
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

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const publishedFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default function Dashboard() {
  const { user, signOut, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const convex = useConvex();
  const isMobile = useIsMobile();

  const projects = useQuery(api.projects.list, {});
  const workspaces = useQuery(api.workspaces.list, {});
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<Id<"workspaces"> | null>(null);
  const [selectedProjectId, setSelectedProjectId] =
    useState<Id<"projects"> | null>(null);

  const [input, setInput] = useState("");
  const [approvedPlan, setApprovedPlan] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<string | null>(null);
  const [architectureId, setArchitectureId] = useState(DEFAULT_ARCHITECTURE_ID);
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [generating, setGenerating] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [pendingModel, setPendingModel] = useState<string | undefined>(undefined);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [slugInput, setSlugInput] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("code");
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const session = useSessionStatus();
  const todayKey = new Date().toISOString().slice(0, 10);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [selectingPreviewElement, setSelectingPreviewElement] = useState(false);
  const [selectedPreviewElement, setSelectedPreviewElement] =
    useState<PreviewElementContext | null>(null);

  // Effective selection: the explicit pick when set, otherwise the most
  // recent project. Derived during render — no state-sync effect needed.
  const effectiveWorkspaceId =
    selectedWorkspaceId ?? (workspaces?.length ? workspaces[0]._id : null);
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
  const agentRuns = useQuery(
    api.workspaces.runs,
    effectiveWorkspaceId ? { workspaceId: effectiveWorkspaceId } : "skip",
  );
  const usage = useQuery(api.usage.summary, {});
  const deployments = useQuery(api.deployments.mine, {});
  const patterns = useQuery(api.patterns.mine, {});
  // The most recent run doubles as the live progress feed: the pipeline
  // appends each finished stage and sets `step` while a stage is in flight.
  const liveRun = agentRuns?.[0] ?? null;

  // Keep chat scrolled to the latest message.
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, generating]);

  // The composer target follows the selected project once it loads. Derived
  // during render (no effect): when the effective project changes, adopt its
  // stored target; the user's in-flight choice applies only to the same project.
  const projectTarget = projectDetail?.target ?? "web";
  const [targetOwner, setTargetOwner] = useState<Id<"projects"> | null>(null);
  const [composerTarget, setComposerTarget] = useState<"web" | "expo">("web");
  if (effectiveProjectId && effectiveProjectId !== targetOwner) {
    setTargetOwner(effectiveProjectId);
    setComposerTarget(projectTarget);
  }

  // Expo projects preview in a phone frame. Determined by the stored target
  // or, for legacy builds, by the presence of the generated preview.html.
  const projectFiles = useQuery(
    api.projectFiles.list,
    effectiveProjectId ? { projectId: effectiveProjectId } : "skip",
  );
  const isExpoPreview =
    projectTarget === "expo" ||
    (projectFiles?.some((file) => file.path === EXPO_PREVIEW_PATH) ?? false);

  /**
   * Stage a picture of the picked element as an attachment.
   * Best-effort: the structured DOM context is what the agent actually needs,
   * so a failed snapshot must never block the interaction.
   */
  const stageElementScreenshot = async (element: HTMLElement) => {
    try {
      const { snapdom } = await import("@zumer/snapdom");
      const canvas = await snapdom.toCanvas(element, { fast: true });
      const blob = await (await fetch(canvas.toDataURL("image/png"))).blob();
      const file = new File([blob], `preview-element-${Date.now()}.png`, {
        type: "image/png",
      });
      setStagedFiles((prev) => [...prev, { id: `shot-${Date.now()}`, file }]);
    } catch {
      // Ignored on purpose (see above).
    }
  };

  // Attach the element picker to every rendered preview iframe. srcDoc keeps
  // the document same-origin, so we can inspect it without adding runtime code
  // to the generated application.
  useEffect(() => {
    const iframes = Array.from(
      document.querySelectorAll<HTMLIFrameElement>("iframe[data-rbuilder-preview]"),
    );
    const cleanups: (() => void)[] = [];

    const selectorFor = (element: HTMLElement): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current.tagName.toLowerCase() !== "html") {
        let part = current.tagName.toLowerCase();
        if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).slice(0, 2).map((name) => CSS.escape(name)).join(".")}`;
        }
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
          const tagName = current.tagName;
          const siblings = Array.from(parent.children).filter(
            (child: Element) => child.tagName === tagName,
          );
          const siblingIndex = siblings.indexOf(current);
          if (siblings.length > 1) part += `:nth-of-type(${siblingIndex + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    };

    const bind = (iframe: HTMLIFrameElement) => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const style = doc.createElement("style");
      style.dataset.rbuilderPicker = "true";
      style.textContent = `
        [data-rbuilder-picker-hover] { outline: 2px solid #3b82f6 !important; outline-offset: 2px !important; cursor: crosshair !important; }
        [data-rbuilder-picker-selected] { outline: 2px solid #22c55e !important; outline-offset: 2px !important; }
      `;
      doc.head.appendChild(style);

      let hovered: HTMLElement | null = null;
      const clearHover = () => {
        hovered?.removeAttribute("data-rbuilder-picker-hover");
        hovered = null;
      };
      const onMove = (event: MouseEvent) => {
        if (!selectingPreviewElement) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target || target === doc.body || target === doc.documentElement) return;
        if (hovered !== target) {
          clearHover();
          hovered = target;
          hovered.setAttribute("data-rbuilder-picker-hover", "true");
        }
      };
      const onClick = (event: MouseEvent) => {
        if (!selectingPreviewElement) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target || target === doc.body || target === doc.documentElement) return;
        event.preventDefault();
        event.stopPropagation();
        clearHover();
        target.setAttribute("data-rbuilder-picker-selected", "true");
        // Collect the full picture — selector, applied CSS, computed styles,
        // neighbours — so the agent knows exactly what it is changing.
        const selection = collectElementContext(target, selectorFor(target), doc);
        setSelectedPreviewElement(selection);
        const picked = pickedElementPrompt(selection);
        setInput((current) => `${current.trim()}${current.trim() ? "\n\n" : ""}${picked}`);
        setSelectingPreviewElement(false);
        toast.success(`Выбран элемент ${selection.selector}`);
        // A picture of the element is staged as an attachment, so the model can
        // compare what the user sees with what the DOM reports.
        void stageElementScreenshot(target);
      };
      doc.addEventListener("mousemove", onMove, true);
      doc.addEventListener("click", onClick, true);
      cleanups.push(() => {
        doc.removeEventListener("mousemove", onMove, true);
        doc.removeEventListener("click", onClick, true);
        clearHover();
        style.remove();
      });
    };

    iframes.forEach((iframe) => {
      if (iframe.contentDocument?.readyState === "complete") bind(iframe);
      else iframe.addEventListener("load", () => bind(iframe), { once: true });
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [selectingPreviewElement, previewKey, effectiveProjectId]);

  useEffect(() => {
    if (!selectingPreviewElement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectingPreviewElement(false);
        toast.info("Выбор элемента отменён");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectingPreviewElement]);

  const selectedProject = useMemo(() => {
    if (projectDetail) return projectDetail;
    return projects?.find((p) => p._id === effectiveProjectId) ?? null;
  }, [projectDetail, projects, effectiveProjectId]);

  const sendMessage = useMutation(api.messages.send);
  const commitBuild = useMutation(api.builds.commit);
  const ensureWorkspace = useMutation(api.workspaces.ensureDefault);
  const createWorkspace = useMutation(api.workspaces.create);
  const startAgentRun = useMutation(api.workspaces.startRun);
  const finishAgentRun = useMutation(api.workspaces.finishRun);
  const setModelMutation = useMutation(api.projects.setModel);
  const setTargetMutation = useMutation(api.projects.setTarget);
  const forgetPattern = useMutation(api.patterns.forget);
  const clearPatterns = useMutation(api.patterns.clear);
  const publishDeployment = useMutation(api.deployments.publish);
  const unpublishDeployment = useMutation(api.deployments.unpublish);

  const activeModel = getModel(selectedProject?.model ?? pendingModel);

  /** Skill-trend signals read the project sources (bounded, non-secret). */
  const projectFilesForSignals = useMemo(
    () =>
      (projectFiles ?? [])
        .filter((file) => !file.path.startsWith("docs/"))
        .slice(0, 30)
        .map((file) => ({ path: file.path, content: file.content.slice(0, 8_000) })),
    [projectFiles],
  );

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

  const appendPrompt = (addition: string) => {
    setInput((current) => (current.trim() ? `${current.trim()}\n\n${addition}` : addition));
    setMobileTab("chat");
  };

  const handleCreatePlan = async () => {
    const content = input.trim();
    if (!content || planning || generating) return;
    setPlanning(true);
    try {
      const result = await convex.action(api.generation.plan, {
        prompt: content,
        modelId: selectedProject?.model ?? pendingModel,
        architectureId,
      });
      setPlanDraft(result.plan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось составить план");
    } finally {
      setPlanning(false);
    }
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || generating || authLoading) return;
    // The picked preview element travels as a structured block: selector, the
    // CSS rules that actually apply, computed styles and neighbours.
    const request = [
      approvedPlan
        ? `${content}\n\nУТВЕРЖДЁННЫЙ ПЛАН ПРОЕКТА:\n${approvedPlan}`
        : content,
      selectedPreviewElement ? formatElementContext(selectedPreviewElement) : null,
    ]
      .filter(Boolean)
      .join("\n\n");

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

    let runId: Id<"agentRuns"> | null = null;
    try {
      let projectId = effectiveProjectId;
      if (!projectId) {
        projectId = await convex.mutation(api.projects.create, {
          name: "Untitled app",
          prompt: request,
          model: model.id,
        });
        setSelectedProjectId(projectId);
      }

      const workspaceId = effectiveWorkspaceId ?? (await ensureWorkspace({}));
      setSelectedWorkspaceId(workspaceId);
      runId = await startAgentRun({
        workspaceId,
        projectId,
        prompt: request,
        mode: "edit",
      });

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
        content: request,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      });

      const previous = await convex.query(api.projects.get, { projectId });
      const result = await convex.action(api.generation.run, {
        prompt: request,
        modelId: model.id,
        architectureId,
        target: composerTarget,
        projectId,
        runId: runId ?? undefined,
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
        changes: result.changes,
        files: result.files?.length
          ? result.files
          : [{ path: "index.html", content: result.html, language: "html" }],
      });
      // A demo/fallback result is not a billable generation. Consume only after
      // a real build has completed, so missing or invalid provider keys do not
      // spend a user's daily session.
      if (model.costsSession && !result.demo) {
        await convex.mutation(api.sessions.consume, { day: todayKey });
      }
      if (runId) {
        await finishAgentRun({ runId, status: "completed", trace: result.trace });
      }
      setApprovedPlan(null);
      setSelectedPreviewElement(null);
      setPreviewKey((k) => k + 1);
      if (result.demo) {
        toast.info(result.notice ?? "Ключ выбранной модели не настроен");
      } else {
        const tokens = result.usage.promptTokens + result.usage.completionTokens;
        const cost = result.usage.costRub;
        toast.success(
          cost
            ? `Сборка завершена · ${tokens.toLocaleString("ru-RU")} токенов · ≈${cost.toFixed(2)} ₽`
            : `Сборка завершена · ${tokens.toLocaleString("ru-RU")} токенов`,
        );
      }
    } catch (error) {
      if (runId) {
        await finishAgentRun({
          runId,
          status: "failed",
          error: error instanceof Error ? error.message : "Сборка не удалась",
        }).catch(() => undefined);
      }
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
    if (!selectedProject?.html) return false;
    const blob = new Blob([selectedProject.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  };

  // The live URL of the current project, if it has been published.
  const deployment = useMemo(
    () => deployments?.find((row) => row.projectId === effectiveProjectId) ?? null,
    [deployments, effectiveProjectId],
  );
  const liveUrl = deployment ? publishUrl(deployment.slug, CONVEX_URL) : null;

  // Static analysis of the current build: what would embarrass the user in
  // front of a client, found before they publish.
  const projectFileRows = useQuery(
    api.projectFiles.list,
    effectiveProjectId ? { projectId: effectiveProjectId } : "skip",
  );
  const projectHtml = selectedProject?.html;
  const issues = useMemo<AntiPatternIssue[]>(() => {
    const files = projectFileRows?.length
      ? projectFileRows.map((file) => ({ path: file.path, content: file.content }))
      : projectHtml
        ? [{ path: "index.html", content: projectHtml }]
        : [];
    return detectAntiPatterns(files);
  }, [projectFileRows, projectHtml]);
  const issueCounts = useMemo(() => countIssues(issues), [issues]);

  const handleFixIssues = () => {
    setInput(issuesToPrompt(issues));
    setIssuesOpen(false);
    setSidebarSection("chat");
    setMobileTab("chat");
    toast.info("Проблемы отправлены агенту — проверьте запрос и отправьте");
  };

  /**
   * Publish the current build behind a real, shareable URL.
   * Re-publishing updates the same address, so a link already sent to someone
   * keeps working and shows the newer version.
   */
  const handleDeploy = async () => {
    if (!effectiveProjectId || !selectedProject?.html) {
      toast.info("Сначала соберите приложение — после сборки его можно опубликовать.");
      return;
    }
    setDeploying(true);
    try {
      const result = await publishDeployment({
        projectId: effectiveProjectId,
        slug: slugInput.trim() ? slugInput.trim().toLowerCase() : undefined,
        title: selectedProject.name,
      });
      const url = publishUrl(result.slug, CONVEX_URL);
      setSlugInput(result.slug);
      setDeployOpen(true);
      try {
        await navigator.clipboard?.writeText(url);
        toast.success("Опубликовано — ссылка скопирована");
      } catch {
        toast.success("Опубликовано");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось опубликовать проект.",
      );
    } finally {
      setDeploying(false);
    }
  };

  const handleUnpublish = async () => {
    if (!deployment) return;
    try {
      await unpublishDeployment({ deploymentId: deployment._id });
      setDeployOpen(false);
      toast.success("Публикация остановлена");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось остановить публикацию.",
      );
    }
  };

  const signOutAndGoHome = async () => {
    await signOut();
    navigate("/");
  };

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col bg-[#071728]">
      <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300 ring-1 ring-blue-400/20">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">AI Agent</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" /> {activeModel.name}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Пишет код, создаёт файлы, запускает сборку и разворачивает приложение</p>
        </div>
      </div>
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
                {message.changes && message.changes.length > 0 && (
                  <div className="mt-1 flex max-w-[85%] flex-col gap-0.5 border-l border-border/60 pl-2">
                    <span className="text-[10px] font-medium tracking-wide text-muted-foreground/60 uppercase">
                      что изменилось
                    </span>
                    {message.changes.map((change, i) => (
                      <span key={i} className="text-[11px] leading-4 text-muted-foreground">
                        <span className="font-mono text-foreground/80">{change.path}</span>
                        {" — "}
                        {change.why}
                      </span>
                    ))}
                  </div>
                )}
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

          {(generating || liveRun?.status === "running") && (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="truncate">
                  {liveRun?.step ?? `${activeModel.name}: запускаю пайплайн`}
                </span>
              </div>
              {(liveRun?.trace?.length ?? 0) > 0 && (
                <ol className="mt-2 space-y-1">
                  {liveRun?.trace?.map((entry, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[11px]">
                      <span className="w-20 shrink-0 truncate text-muted-foreground/70">
                        {entry.agent}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {entry.note}
                      </span>
                      {entry.ms > 0 && (
                        <span className="tabular-nums text-muted-foreground/60">
                          {(entry.ms / 1000).toFixed(1)}s
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="border-t border-border/70 p-3">
        {selectingPreviewElement && (
          <div className="mb-2 flex items-center justify-between rounded-md border border-blue-400/30 bg-blue-400/10 px-2.5 py-1.5 text-[11px] text-blue-200">
            <span className="flex items-center gap-1.5">
              <MousePointer2 className="size-3.5" /> Нажмите на элемент в превью · Escape — отмена
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] text-blue-200 hover:bg-blue-400/10"
              onClick={() => setSelectingPreviewElement(false)}
            >
              Отмена
            </Button>
          </div>
        )}

        {selectedPreviewElement && !selectingPreviewElement && (
          <div className="mb-2 flex items-center justify-between rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
            <span className="flex min-w-0 items-center gap-1.5">
              <MousePointer2 className="size-3.5 shrink-0" />
              <span className="truncate">Выбран {selectedPreviewElement.selector}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] text-emerald-200 hover:bg-emerald-400/10"
              onClick={() => setSelectedPreviewElement(null)}
            >
              Убрать
            </Button>
          </div>
        )}

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

        {approvedPlan ? (
          <div className="mb-2 flex items-center justify-between rounded-md border border-foreground/20 bg-accent/40 px-2.5 py-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 text-foreground">
              <ClipboardList className="size-3.5" /> План утверждён
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => setApprovedPlan(null)}
            >
              Убрать
            </Button>
          </div>
        ) : null}

        {/* Browser relay for locally hosted models — must stay mounted for
            the "Локальная модель" picker entry to work. */}
        <div className="mb-2">
          <LocalModelBridge />
        </div>

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
              onClick={() => setArchitectureOpen(true)}
              disabled={generating || planning}
              title="Выбрать архитектуру проекта"
            >
              <Layers3 className="size-3.5" />
              Архитектура
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5 text-muted-foreground",
                composerTarget === "expo" && "text-foreground",
              )}
              onClick={() => {
                const next = composerTarget === "expo" ? "web" : "expo";
                setComposerTarget(next);
                if (effectiveProjectId) {
                  void setTargetMutation({ projectId: effectiveProjectId, target: next });
                }
              }}
              disabled={generating}
              title={
                composerTarget === "expo"
                  ? "Expo (React Native): сборка генерирует app/ + npx expo start. Превью — в рамке телефона."
                  : "Переключить на Expo (React Native): получите исходники мобильного приложения."
              }
            >
              <Smartphone className="size-3.5" />
              Expo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => void handleCreatePlan()}
              disabled={generating || planning || !input.trim()}
              title="Сначала составить план проекта"
            >
              {planning ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardList className="size-3.5" />}
              План
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => setImportOpen(true)}
              disabled={generating}
              title="Импорт из Figma / v0 / скриншота / PDF"
            >
              <FileInput className="size-3.5" />
              Импорт
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => setSnippetsOpen(true)}
              disabled={generating}
            >
              <Puzzle className="size-3.5" />
              Снипеты
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => setPresetsOpen(true)}
              disabled={generating}
            >
              <SlidersHorizontal className="size-3.5" />
              Пресеты
            </Button>
            <Button
              type="button"
              variant={selectingPreviewElement ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => {
                if (!selectedProject?.html) {
                  toast.info("Сначала создайте приложение в превью");
                  return;
                }
                setSelectingPreviewElement((active) => !active);
              }}
              disabled={generating}
              title="Выбрать элемент в превью и добавить его в запрос"
            >
              <MousePointer2 className="size-3.5" />
              <span className="hidden xl:inline">Выбрать в превью</span>
            </Button>
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

      <Dialog open={architectureOpen} onOpenChange={setArchitectureOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Layers3 className="size-4" />
              Архитектура проекта
            </DialogTitle>
            <DialogDescription className="text-xs">
              Архитектура станет контрактом для планировщика и builder-агента.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[52vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {ARCHITECTURES.map((profile) => {
              const active = architectureId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    setArchitectureId(profile.id);
                    setArchitectureOpen(false);
                  }}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    active
                      ? "border-foreground bg-accent/50"
                      : "border-border/70 hover:border-foreground/40 hover:bg-accent/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{profile.name}</span>
                    {active ? <Badge variant="outline" className="text-[10px]">Выбрано</Badge> : null}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{profile.description}</p>
                  <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                    <p><span className="font-medium text-foreground/80">Frontend:</span> {profile.frontend}</p>
                    <p><span className="font-medium text-foreground/80">Backend:</span> {profile.backend}</p>
                    <p><span className="font-medium text-foreground/80">Данные:</span> {profile.database}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" onClick={() => setArchitectureOpen(false)}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={effectiveProjectId ?? undefined}
        onImported={(prompt, source) => {
          setInput((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
          toast.success(`Импортировано: ${source}. Просмотрите запрос перед сборкой.`);
        }}
      />

      <Dialog open={snippetsOpen} onOpenChange={setSnippetsOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Puzzle className="size-4" />
              Библиотека снипетов
            </DialogTitle>
            <DialogDescription className="text-xs">
              Выберите готовый сценарий — его требования добавятся в текущий prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {SNIPPETS.map((snippet) => (
              <button
                key={snippet.id}
                type="button"
                onClick={() => {
                  appendPrompt(snippet.prompt);
                  setSnippetsOpen(false);
                  toast.success(`Снипет «${snippet.name}» добавлен`);
                }}
                className="w-full rounded-md border border-border/70 p-3 text-left transition-colors hover:border-foreground/40 hover:bg-accent/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{snippet.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {SNIPPET_CATEGORIES.find((category) => category.id === snippet.category)?.label}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{snippet.description}</p>
                <p className="mt-2 text-[10px] text-muted-foreground/70">{snippet.files.join(" · ")}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={presetsOpen} onOpenChange={setPresetsOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4" />
              Prompt presets
            </DialogTitle>
            <DialogDescription className="text-xs">
              Пресет добавляет профессиональные требования к текущему запросу.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  appendPrompt(preset.prompt);
                  setPresetsOpen(false);
                  toast.success(`Пресет «${preset.name}» добавлен`);
                }}
                className="w-full rounded-md border border-border/70 p-3 text-left transition-colors hover:border-foreground/40 hover:bg-accent/40"
              >
                <span className="text-sm font-medium">{preset.name}</span>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{preset.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={planDraft !== null} onOpenChange={(open) => !open && setPlanDraft(null)}>
        <DialogContent className="max-h-[80vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4" />
              План проекта
            </DialogTitle>
            <DialogDescription className="text-xs">
              Проверьте предпроектный анализ перед генерацией. Утверждённый план будет передан builder-агенту.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[48vh] overflow-y-auto rounded-md border border-border/70 bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap text-xs leading-5 text-foreground/90">{planDraft}</pre>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPlanDraft(null)}>
              Изменить запрос
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!planDraft) return;
                setApprovedPlan(planDraft);
                setPlanDraft(null);
                toast.success("План утверждён — можно запускать сборку");
              }}
            >
              Утвердить план
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" />
              Что нашёл статический анализ
            </DialogTitle>
            <DialogDescription className="text-xs">
              {issueCounts.errors} ошибок · {issueCounts.warnings} предупреждений ·{" "}
              {issueCounts.infos} замечаний. Это не блокер — но такое замечают на ревью.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[52vh] overflow-y-auto">
            <ul className="flex flex-col divide-y divide-border/60">
              {issues.map((issue, index) => (
                <li key={`${issue.id}-${index}`} className="flex flex-col gap-1 py-2.5">
                  <span className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-4 rounded-full px-1.5 text-[9px] font-normal",
                        issue.severity === "error"
                          ? "border-destructive/40 text-destructive"
                          : issue.severity === "warning"
                            ? "border-amber-400/40 text-amber-300"
                            : "text-muted-foreground",
                      )}
                    >
                      {issue.severity}
                    </Badge>
                    <span className="text-xs font-medium">{issue.title}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                      {issue.path}:{issue.line}
                    </span>
                  </span>
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    {issue.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIssuesOpen(false)}>
              Закрыть
            </Button>
            <Button type="button" size="sm" onClick={handleFixIssues}>
              Пусть агент починит
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="max-h-[80vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Brain className="size-4" />
              Память агента
            </DialogTitle>
            <DialogDescription className="text-xs">
              Эти предпочтения агент вывел из ваших ручных правок в Code panel и
              теперь соблюдает их по умолчанию.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[52vh] overflow-y-auto">
            {!patterns || patterns.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground/80">
                Пока ничего не выучено. Отредактируйте файл в Code panel — агент
                запомнит приём.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {patterns.map((pattern) => (
                  <li key={pattern._id} className="flex items-start gap-3 py-2.5">
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-xs leading-5">{pattern.statement}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {pattern.kind} · наблюдалось {pattern.strength} раз
                        {pattern.evidence[0] ? ` · например: ${pattern.evidence[0]}` : ""}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-1.5 text-[10px] text-muted-foreground"
                      onClick={() => void forgetPattern({ patternId: pattern._id })}
                    >
                      Забыть
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            {patterns && patterns.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  void clearPatterns({}).then(() =>
                    toast.success("Память агента очищена"),
                  );
                }}
              >
                Забыть всё
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => setMemoryOpen(false)}>
              Готово
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4" />
              Публикация
            </DialogTitle>
            <DialogDescription className="text-xs">
              Приложение доступно по настоящей ссылке — её можно отправить кому угодно.
              Повторная публикация обновляет ту же ссылку.
            </DialogDescription>
          </DialogHeader>

          {liveUrl ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2">
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                >
                  {liveUrl}
                </a>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>{deployment?.visits ?? 0} просмотров</span>
                <span>версия v{deployment?.version ?? 0}</span>
                {deployment ? (
                  <span>
                    обновлено {publishedFormat.format(new Date(deployment.updatedAt))}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deploy-slug" className="text-[11px] text-muted-foreground">
                  Адрес
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="deploy-slug"
                    value={slugInput}
                    onChange={(event) => setSlugInput(event.target.value)}
                    placeholder="my-app"
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={deploying}
                    onClick={() => void handleDeploy()}
                  >
                    {deploying ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      "Опубликовать"
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  Только латиница, цифры и дефис. Если адрес занят, будет подобран свободный.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              Соберите приложение и нажмите Deploy — появится ссылка вида{" "}
              {shortHost(publishUrl("my-app", CONVEX_URL))}.
            </p>
          )}

          <DialogFooter>
            {liveUrl ? (
              <Button asChild type="button" variant="ghost" size="sm">
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> Открыть
                </a>
              </Button>
            ) : null}
            {deployment ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => void handleUnpublish()}
              >
                Остановить публикацию
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => setDeployOpen(false)}>
              Готово
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          {issueCounts.total > 0 && (
            <button
              type="button"
              onClick={() => setIssuesOpen(true)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                issueCounts.errors > 0
                  ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
              )}
              title="Что статический анализ нашёл в этом билде"
            >
              <AlertTriangle className="size-3" />
              {issueCounts.total} проблем
            </button>
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
          isExpoPreview ? (
            <div className="flex h-full items-center justify-center">
              <div
                className="flex h-full max-h-[720px] w-[390px] max-w-full flex-col overflow-hidden rounded-[2rem] border-[10px] border-neutral-900 bg-white shadow-xl dark:border-neutral-700"
              >
                <iframe
                  key={previewKey}
                  title="App preview (mobile)"
                  srcDoc={selectedProject.html}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                  data-rbuilder-preview="true"
                  className="h-full w-full bg-white"
                />
              </div>
            </div>
          ) : (
            <iframe
              key={previewKey}
              title="App preview"
              srcDoc={selectedProject.html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              data-rbuilder-preview="true"
              className={cn(
                "h-full w-full rounded-md border border-border/70 bg-white",
                selectingPreviewElement && "cursor-crosshair",
              )}
            />
          )
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
        ) : workspaceTab === "code" ? (            <CodePanel
              projectId={effectiveProjectId ?? undefined}
              html={selectedProject?.html}
            />
        ) : workspaceTab === "data" ? (
          effectiveProjectId ? (
            <DataPanel projectId={effectiveProjectId} />
          ) : (
            <PanelEmpty text="Create a project to browse its data." />
          )
        ) : workspaceTab === "snapshots" ? (
          <SnapshotsPanel />
        ) : workspaceTab === "skills" ? (
          <SkillsPanel
            activeModelId={activeModel.id}
            projectFiles={projectFilesForSignals}
          />
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
    <main className="rbuilder-ide flex h-screen flex-col bg-background">
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
          <div className="rbuilder-wordmark flex items-center gap-2 border-r border-border/60 pr-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-blue-500 text-white shadow-[0_0_18px_rgba(37,99,235,0.35)]">
              <Sparkles className="size-3.5" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">rbuilder</span>
          </div>
          <span className="hidden text-xs text-muted-foreground/70 xl:inline">Создавай приложения, сайты и всё, что можешь представить — с ИИ агентом</span>

          {/* Workspace switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 max-w-48 gap-1.5 text-xs">
                <Layers3 className="size-3.5 text-muted-foreground" />
                <span className="truncate">{workspaces?.find((w) => w._id === effectiveWorkspaceId)?.name ?? "Workspace"}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
              {workspaces?.length ? workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace._id}
                  className="cursor-pointer"
                  onClick={() => setSelectedWorkspaceId(workspace._id)}
                >
                  <Layers3 className="size-3.5" />
                  <span className="truncate">{workspace.name}</span>
                </DropdownMenuItem>
              )) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Создастся при первом запуске агента</div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => void createWorkspace({ name: `Workspace ${(workspaces?.length ?? 0) + 1}`, architectureId }).then(setSelectedWorkspaceId).catch(() => toast.error("Не удалось создать workspace"))}
              >
                <Plus className="size-3.5" /> Новый workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
          {usage && usage.todayCount > 0 && (
            <span
              className="hidden text-xs text-muted-foreground/70 xl:block"
              title="Токены и оценка стоимости за сегодня"
            >
              {usage.todayTokens.toLocaleString("ru-RU")} токенов
              {usage.todayCostRub > 0 && ` · ≈${usage.todayCostRub.toFixed(2)} ₽`}
            </span>
          )}
          {agentRuns?.[0] ? (
            <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/70 lg:flex" title="Последний запуск агента">
              <span className={cn("size-1.5 rounded-full", agentRuns[0].status === "completed" ? "bg-emerald-500" : agentRuns[0].status === "failed" ? "bg-destructive" : "bg-amber-500")} />
              run #{agentRuns[0]._id.slice(-4)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="default"
            size="sm"
            className="hidden h-8 gap-1.5 bg-blue-600 px-3 text-xs text-white shadow-[0_0_18px_rgba(37,99,235,0.25)] hover:bg-blue-500 sm:inline-flex"
            onClick={() => void handleDeploy()}
            disabled={!selectedProject?.html || deploying}
          >
            {deploying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            {deployment ? "Обновить" : "Deploy"}
          </Button>
          {liveUrl ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden h-8 gap-1.5 px-2 text-xs text-emerald-300 lg:inline-flex"
            >
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                title="Опубликованная версия и число просмотров"
              >
                <span className="size-1.5 rounded-full bg-emerald-400" />
                live · {deployment?.visits ?? 0}
              </a>
            </Button>
          ) : null}
          {patterns && patterns.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground sm:inline-flex"
              onClick={() => setMemoryOpen(true)}
              title="Что агент выучил из ваших ручных правок"
            >
              <Brain className="size-3.5" />
              {patterns.length}
            </Button>
          )}
          <DesktopWorkspaceControls />
          <DesktopStatus />
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
          <ResizablePanel defaultSize={64} minSize={48}>
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={52} minSize={34}>
                <div className="flex h-full min-h-0 flex-col border-r border-border/70">
                  {workspaceContent}
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={48} minSize={34}>
                <div className="h-full min-h-0 p-2">
                  <div className="h-full overflow-hidden rounded-xl border border-border/70 bg-[#071728] shadow-[0_14px_50px_rgba(0,0,0,0.22)]">
                    {previewPanel}
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  );
}
