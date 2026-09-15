import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  TOOLS,
  TOOL_GROUPS,
  resolveEnabledTools,
  type ToolGroupId,
} from "@/lib/tools";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, RotateCcw, Search, Wrench } from "lucide-react";

/**
 * The Tools tab: the agent tool belt ported from the Freebuff runtime
 * (files, search, terminal, browser, web, agents, delivery) plus the tools
 * native to RBuilder's generated apps. Toggles are per-user and the enabled
 * set is sent to the generation pipeline on every build.
 */
export function ToolsPanel() {
  const data = useQuery(api.tools.list, {});
  const toggleMutation = useMutation(api.tools.toggle);
  const resetMutation = useMutation(api.tools.reset);

  const [group, setGroup] = useState<ToolGroupId | null>(null);
  const [query, setQuery] = useState("");

  const enabled = useMemo(
    () => new Set(data?.enabled ?? resolveEnabledTools([])),
    [data?.enabled],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOLS.filter((tool) => {
      if (group && tool.group !== group) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.desc.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q)
      );
    });
  }, [group, query]);

  const toggle = (toolId: string, on: boolean) => {
    void toggleMutation({ toolId, enabled: on }).catch(() =>
      toast.error("Не удалось изменить инструмент"),
    );
  };

  const reset = () => {
    void resetMutation({})
      .then(() => toast.success("Инструменты возвращены к значениям по умолчанию"))
      .catch(() => toast.error("Не удалось сбросить инструменты"));
  };

  const isLoading = data === undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Инструменты агента</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {enabled.size} вкл · {TOOLS.length} доступно
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
              onClick={reset}
            >
              <RotateCcw className="size-3" />
              Сброс
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск инструмента…"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setGroup(null)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              group === null
                ? "border-foreground/30 bg-foreground/5 text-foreground"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
          >
            Все
          </button>
          {TOOL_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(group === g.id ? null : g.id)}
              title={g.hint}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                group === g.id
                  ? "border-foreground/30 bg-foreground/5 text-foreground"
                  : "border-border/70 text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-muted-foreground/80">
            Ничего не найдено.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((tool) => {
              const on = enabled.has(tool.id);
              return (
                <li
                  key={tool.id}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "font-mono text-xs",
                          on ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {tool.name}
                      </span>
                      {tool.effect ? (
                        <Badge
                          variant="outline"
                          className="h-4 rounded-full px-1.5 text-[9px] font-normal text-emerald-600"
                        >
                          {tool.effect === "plan" ? "этап: план" : "этап: ревью"}
                        </Badge>
                      ) : null}
                      {tool.origin === "rbuilder" ? (
                        <Badge
                          variant="outline"
                          className="h-4 rounded-full px-1.5 text-[9px] font-normal text-muted-foreground"
                        >
                          RBuilder
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {tool.desc}
                    </p>
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={(value) => toggle(tool.id, value)}
                    className="mt-0.5 shrink-0"
                    aria-label={`Инструмент ${tool.name}`}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <p className="px-4 py-4 text-[10px] leading-4 text-muted-foreground/70">
          Включённые инструменты попадают в инструкции сборщика и ревьюера на
          каждом билде. «thinker» управляет этапом планирования, «reviewer» —
          этапом самопроверки: выключите их, чтобы сократить прогон. Набор
          портирован из рантайма Freebuff; инструменты с меткой RBuilder —
          собственные.
        </p>
      </ScrollArea>
    </div>
  );
}
