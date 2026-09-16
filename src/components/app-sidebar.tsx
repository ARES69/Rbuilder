import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STARTER_TEMPLATES } from "@/lib/templates";
import { CAPABILITIES, type CapabilityId } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  FolderGit2,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

export type SidebarSection = "chat" | "projects" | "templates" | "knowledge";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AppSidebar({
  section,
  onSectionChange,
  onNewProject,
  onSelectProject,
  onSeedPrompt,
  activeProjectId,
  collapsed,
}: {
  section: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  onNewProject: () => void;
  onSelectProject: (id: Id<"projects">) => void;
  onSeedPrompt: (prompt: string) => void;
  activeProjectId: Id<"projects"> | null;
  collapsed: boolean;
}) {
  const projects = useQuery(api.projects.list, {});
  const attachments = useQuery(api.attachments.listAllForUser, {});
  const removeAttachment = useMutation(api.attachments.remove);

  const [templateQuery, setTemplateQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [capability, setCapability] = useState<CapabilityId | null>(null);

  const filteredTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase();
    if (!query) return STARTER_TEMPLATES;
    return STARTER_TEMPLATES.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.desc.toLowerCase().includes(query),
    );
  }, [templateQuery]);

  const filteredFiles = useMemo(() => {
    const query = knowledgeQuery.trim().toLowerCase();
    if (!query) return attachments ?? [];
    return (attachments ?? []).filter((attachment) =>
      attachment.name.toLowerCase().includes(query),
    );
  }, [attachments, knowledgeQuery]);

  if (collapsed) return null;

  const navItems: {
    id: SidebarSection;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[] = [
    { id: "chat", label: "Чат с агентом", icon: MessageSquare },
    { id: "projects", label: "Проекты", icon: FolderGit2 },
    { id: "templates", label: "Шаблоны", icon: LayoutTemplate },
    { id: "knowledge", label: "База знаний", icon: FileText },
  ];

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/70 bg-[#04101d]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-[0_0_18px_rgba(37,99,235,0.28)]">
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-slate-100">rbuilder</p>
          <p className="text-[10px] text-slate-500">AI development workspace</p>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 border-b border-border/70 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                active
                  ? "border border-blue-400/20 bg-blue-500/15 text-blue-100"
                  : "text-muted-foreground hover:bg-[#0d263f] hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.id === "projects" && projects?.length ? (
                <span className="ml-auto text-[11px] text-muted-foreground/60">
                  {projects.length}
                </span>
              ) : null}
              {item.id === "knowledge" && attachments?.length ? (
                <span className="ml-auto text-[11px] text-muted-foreground/60">
                  {attachments.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {section === "projects" ? (
            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                className="mb-1 h-8 justify-start gap-2 text-xs"
                onClick={onNewProject}
              >
                <Plus className="size-3.5" />
                Новый проект
              </Button>
              {projects?.length
                ? projects.map((project) => (
                    <button
                      key={project._id}
                      type="button"
                      onClick={() => onSelectProject(project._id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                        project._id === activeProjectId
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{project.name}</span>
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground/60">
                        {project.version > 0 ? `v${project.version}` : "новый"}
                      </span>
                    </button>
                  ))
                : (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">
                      Пока нет проектов
                    </p>
                  )}
            </div>
          ) : section === "templates" ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={templateQuery}
                onChange={(event) => setTemplateQuery(event.target.value)}
                placeholder="Поиск шаблонов…"
                className="h-8 bg-card text-xs"
              />
              {filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onSeedPrompt(template.prompt)}
                  className="group flex w-full flex-col items-start gap-0.5 rounded-md border border-border/60 px-2.5 py-2 text-left transition-colors hover:border-foreground/30 hover:bg-accent/50"
                >
                  <span className="text-xs font-medium">{template.name}</span>
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    {template.desc}
                  </span>
                </button>
              ))}
              {filteredTemplates.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  Ничего не найдено
                </p>
              ) : null}
            </div>
          ) : section === "knowledge" ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={knowledgeQuery}
                onChange={(event) => setKnowledgeQuery(event.target.value)}
                placeholder="Поиск по файлам…"
                className="h-8 bg-card text-xs"
              />
              {attachments === undefined ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Загрузка…
                </div>
              ) : filteredFiles.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                  Файлов пока нет. Прикрепите файлы в чате — они появятся здесь
                  и будут использоваться агентом как контекст.
                </p>
              ) : (
                filteredFiles.map((attachment) => (
                  <div
                    key={attachment._id}
                    className="group flex items-center justify-between gap-1 rounded-md border border-border/60 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <FileText className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs">{attachment.name}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                        {attachment.projectName} · {formatSize(attachment.size)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground"
                        title="Скопировать имя"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(attachment.name)
                            .then(() => {
                              setCopiedId(attachment._id);
                              setTimeout(() => setCopiedId(null), 1200);
                            })
                            .catch(() => {
                              // Clipboard access can be blocked on insecure previews.
                              setCopiedId(null);
                            });
                        }}
                      >
                        {copiedId === attachment._id ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        title="Удалить файл"
                        onClick={() =>
                          void removeAttachment({
                            attachmentId: attachment._id,
                          }).catch(() => {
                            // Keep the list stable and avoid an unhandled rejection.
                          })
                        }
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* chat section: capability shortcuts */
            <div className="flex flex-col gap-1">
              {CAPABILITIES.map((item) => {
                const Icon = item.icon;
                const active = capability === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCapability(item.id);
                      onSeedPrompt(item.starter);
                    }}
                    className={cn(
                      "group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
                      active && "bg-accent/70",
                    )}
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.hint}
                      </span>
                    </span>
                    <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border/70 p-3">
        <div className="rounded-lg border border-blue-400/15 bg-blue-500/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">AI Credits</span>
            <span className="text-[10px] text-blue-300">142 / 500</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-[28%] rounded-full bg-blue-500" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
          <span>RBuilder Desktop</span>
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
}

/** Compact capability chips row (mobile) reusing the same catalog. */
export function CapabilityChips({
  onPick,
}: {
  onPick: (starter: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-3 py-2">
      {CAPABILITIES.map((capability) => (
        <button
          key={capability.id}
          type="button"
          onClick={() => onPick(capability.starter)}
          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          {capability.label}
        </button>
      ))}
    </div>
  );
}

