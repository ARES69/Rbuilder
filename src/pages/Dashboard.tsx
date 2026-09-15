import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/hooks/use-mobile";
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
  Paperclip,
  Plus,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";

interface StagedFile {
  id: string;
  file: File;
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
  const project = useQuery(
    api.projects.get,
    selectedProjectId ? { projectId: selectedProjectId } : "skip",
  );
  const messages = useQuery(
    api.messages.list,
    selectedProjectId ? { projectId: selectedProjectId } : "skip",
  );

  const [input, setInput] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [generating, setGenerating] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Default to the most recent project once the list arrives.
  useEffect(() => {
    if (!selectedProjectId && projects && projects.length > 0) {
      setSelectedProjectId(projects[0]._id);
    }
  }, [projects, selectedProjectId]);

  // Keep chat scrolled to the latest message.
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, generating]);

  const selectedProject = useMemo(() => {
    if (project) return project;
    return projects?.find((p) => p._id === selectedProjectId) ?? null;
  }, [project, projects, selectedProjectId]);

  const sendMessage = useMutation(api.messages.send);
  const commitBuild = useMutation(api.builds.commit);

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
    } catch {
      toast.error("Could not create a new project.");
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    const deletedId = selectedProjectId;
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

    setInput("");
    const files = stagedFiles;
    setStagedFiles([]);
    setGenerating(true);
    setMobileTab("preview");

    try {
      let projectId = selectedProjectId;
      if (!projectId) {
        projectId = await convex.mutation(api.projects.create, {
          name: "Untitled app",
          prompt: content,
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
        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };
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
        previousHtml: previous?.html ?? undefined,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      });

      await commitBuild({ projectId, html: result.html, demo: result.demo });
      setPreviewKey((k) => k + 1);
      toast.success(result.demo ? "Demo build ready" : "Build complete");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Generation failed. Please try again.",
      );
    } finally {
      setGenerating(false);
    }
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
                Describe the app you want
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                Plain language in — a working web app out, rendered in the
                preview the moment it is written.
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
                  {message.role === "user" ? "You" : "Freebuff"}
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
              </div>
            ))
          )}

          {generating && (
            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Building your app…
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
          placeholder="Describe your app… Enter to send"
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={generating}
            >
              <Paperclip className="size-3.5" />
              Attach
            </Button>
            {stagedFiles.length > 0 && (
              <span className="text-xs text-muted-foreground/70">
                {stagedFiles.length} file{stagedFiles.length > 1 ? "s" : ""}
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
            Send
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
            Preview
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
                ? "Rendering your app…"
                : "Describe your app to see it here"}
            </p>
          </div>
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
                Projects
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
                  No projects yet
                </div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => void handleNewProject()}
              >
                <Plus className="size-4" />
                New project
              </DropdownMenuItem>
              {selectedProjectId && (
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => void handleDeleteProject()}
                >
                  <X className="size-4" />
                  Delete current project
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {generating && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Loader2 className="size-3 animate-spin" />
              building
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 hidden text-xs text-muted-foreground/70 sm:block">
            {user?.email ?? "Guest"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={() => void signOutAndGoHome()}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* Chat + preview */}
      {isMobile ? (
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "chat" | "preview")}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-auto mt-2 w-fit">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="min-h-0 flex-1">
            {chatPanel}
          </TabsContent>
          <TabsContent value="preview" className="min-h-0 flex-1">
            {previewPanel}
          </TabsContent>
        </Tabs>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={38} minSize={26} maxSize={60}>
            {chatPanel}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={62}>{previewPanel}</ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  );
}
