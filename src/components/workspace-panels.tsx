import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Code2,
  Copy,
  Database,
  KeyRound,
  Loader2,
  Paperclip,
  Search,
} from "lucide-react";

export { IntegrationsPanel } from "./integrations-panel";

/* ------------------------------ Code panel ------------------------------ */

export function CodePanel({ html }: { html: string | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!html) {
    return (
      <Empty
        icon={Code2}
        hint="Build something first — the generated source appears here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          index.html
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/60">
            {(html.length / 1024).toFixed(1)} KB
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-muted-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(html).then(() => {
                setCopied(true);
                toast.success("Source copied to clipboard");
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Copy
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <pre className="p-4 text-[11px] leading-[1.6] text-muted-foreground">
          <code>{html}</code>
        </pre>
      </ScrollArea>
    </div>
  );
}

/* ------------------------------ Data panel ------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DataPanel({ projectId }: { projectId: Id<"projects"> }) {
  const messages = useQuery(api.messages.list, { projectId });
  const attachments = useQuery(api.attachments.list, { projectId });
  const removeAttachment = useMutation(api.attachments.remove);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader label="Data" hint="live database records" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-4 pt-1">
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Database className="size-3.5 text-muted-foreground" />
              messages ({messages?.length ?? 0})
            </h4>
            <div className="overflow-hidden rounded-md border border-border/70">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40">
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">role</th>
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">content</th>
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">trace</th>
                  </tr>
                </thead>
                <tbody>
                  {messages?.length
                    ? messages.map((message) => (
                        <tr key={message._id} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1.5 align-top">
                            <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[10px] font-normal">
                              {message.role}
                            </Badge>
                          </td>
                          <td className="max-w-0 px-3 py-1.5 align-top">
                            <div className="truncate">{message.content}</div>
                          </td>
                          <td className="px-3 py-1.5 align-top text-muted-foreground">
                            {message.trace ? `${message.trace.length} steps` : "—"}
                          </td>
                        </tr>
                      ))
                    : (
                        <tr>
                          <td colSpan={3} className="px-3 py-3 text-muted-foreground">
                            No messages yet
                          </td>
                        </tr>
                      )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Paperclip className="size-3.5 text-muted-foreground" />
              attachments ({attachments?.length ?? 0})
            </h4>
            <div className="overflow-hidden rounded-md border border-border/70">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40">
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">name</th>
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">size</th>
                    <th className="px-3 py-1.5 font-medium text-muted-foreground">uploaded</th>
                    <th className="px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {attachments?.length
                    ? attachments.map((attachment) => (
                        <tr key={attachment._id} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1.5 align-top">{attachment.name}</td>
                          <td className="px-3 py-1.5 align-top text-muted-foreground">
                            {formatBytes(attachment.size)}
                          </td>
                          <td className="px-3 py-1.5 align-top text-muted-foreground">
                            {formatDate(attachment._creationTime)}
                          </td>
                          <td className="px-3 py-1.5 text-right align-top">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                              onClick={() => void removeAttachment({ attachmentId: attachment._id })}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))
                    : (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-muted-foreground">
                            No attachments yet
                          </td>
                        </tr>
                      )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

/* --------------------------- API keys panel ---------------------------- */

export function ApiKeysPanel() {
  const status = useQuery(api.settings.status, {});
  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const keys = [
    { key: "OPENAI_API_KEY", purpose: "Model access for the build pipeline", set: status.aiKey },
    {
      key: "VLY_INTEGRATION_KEY",
      purpose: "Managed AI / email / payments gateway (auto-injected)",
      set: status.integrationKey,
    },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader label="API keys" hint="server-side only" />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-1">
        <p className="mb-4 text-xs leading-5 text-muted-foreground">
          Keys are set in the project&apos;s Keys / API keys tab and read
          server-side only. This panel shows what is currently available —
          values are never exposed to the client.
        </p>
        <div className="flex flex-col gap-2">
          {keys.map((entry) => (
            <div
              key={entry.key}
              className="rounded-md border border-border/70 px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-3.5 text-muted-foreground" />
                  <code className="text-xs">{entry.key}</code>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 rounded-full px-2 text-[10px] font-normal",
                    entry.set ? "border-foreground/30" : "text-muted-foreground",
                  )}
                >
                  {entry.set ? "configured" : "not set"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{entry.purpose}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------ UI components panel -------------------------- */

const UI_COMPONENTS = [
  { name: "Button", group: "Forms" },
  { name: "Input", group: "Forms" },
  { name: "Textarea", group: "Forms" },
  { name: "Select", group: "Forms" },
  { name: "Checkbox", group: "Forms" },
  { name: "Switch", group: "Forms" },
  { name: "Calendar", group: "Forms" },
  { name: "Slider", group: "Forms" },
  { name: "Card", group: "Display" },
  { name: "Badge", group: "Display" },
  { name: "Avatar", group: "Display" },
  { name: "Table", group: "Display" },
  { name: "Tabs", group: "Display" },
  { name: "Accordion", group: "Overlays" },
  { name: "Dialog", group: "Overlays" },
  { name: "Sheet", group: "Overlays" },
  { name: "Tooltip", group: "Overlays" },
  { name: "Popover", group: "Overlays" },
  { name: "Command", group: "Utility" },
  { name: "ScrollArea", group: "Utility" },
  { name: "Sonner", group: "Utility" },
];

export function UiComponentsPanel() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      UI_COMPONENTS.filter((component) =>
        component.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const component of filtered) {
      const list = map.get(component.group) ?? [];
      list.push(component.name);
      map.set(component.group, list);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader label="UI components" hint="shadcn/ui · 45 installed" />
      <div className="border-b border-border/70 px-4 py-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            className="h-8 bg-card pl-8 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-3">
        {groups.size === 0 ? (
          <p className="text-xs text-muted-foreground">No matches</p>
        ) : (
          [...groups.entries()].map(([group, names]) => (
            <section key={group} className="mb-4 last:mb-0">
              <h4 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                {group}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {names.map((name) => (
                  <Badge key={name} variant="outline" className="rounded-md font-normal">
                    {name}
                  </Badge>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Shared -------------------------------- */

function PanelHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {hint ? <span className="text-[11px] text-muted-foreground/60">{hint}</span> : null}
    </div>
  );
}

function Empty({
  icon: Icon,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Icon className="size-5 text-muted-foreground/60" />
      <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground/80">{hint}</p>
    </div>
  );
}
