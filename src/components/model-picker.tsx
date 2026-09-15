import { MODELS, getModel, DAILY_SESSION_LIMIT } from "@/lib/models";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useSessionStatus() {
  return useQuery(api.sessions.status, { day: todayKey() });
}

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = getModel(value);
  const session = useSessionStatus();

  const remaining = session ? session.limit - session.used : null;
  const lowSessions = remaining !== null && remaining <= 1;

  const handleSelect = (id: string) => {
    const model = getModel(id);
    if (model.costsSession && remaining !== null && remaining <= 0) {
      toast.error(
        `Daily sessions used up (${DAILY_SESSION_LIMIT}/${DAILY_SESSION_LIMIT}). Pick an unmetered model or come back tomorrow.`,
      );
      return;
    }
    onChange(id);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 text-muted-foreground"
        >
          <Cpu className="size-3.5" />
          <span className="max-w-36 truncate">{current.name}</span>
          <ChevronDown className="size-3 text-muted-foreground/70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Models
          </span>
          {remaining !== null && (
            <span
              className={cn(
                "text-[11px] tabular-nums",
                lowSessions ? "text-destructive" : "text-muted-foreground/70",
              )}
            >
              {remaining}/{DAILY_SESSION_LIMIT} sessions today
            </span>
          )}
        </div>
        {current.dataNotice && (
          <div className="border-b border-border/60 px-2 pb-2 text-[10px] leading-4 text-muted-foreground/60">
            {current.name}: {current.dataNotice}
          </div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {MODELS.map((model) => {
            const active = model.id === current.id;
            const blocked =
              model.costsSession && remaining !== null && remaining <= 0;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleSelect(model.id)}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50",
                  active && "bg-accent/60",
                )}
                disabled={blocked}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{model.name}</span>
                  {model.costsSession ? (
                    <Badge
                      variant="outline"
                      className="h-4 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
                    >
                      1 session
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-4 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
                    >
                      unmetered
                    </Badge>
                  )}
                  {active && <Check className="ml-auto size-3.5" />}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {model.bestFor}
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  {model.context}
                  {model.id === "muse-spark-1.2" &&
                    " · queues when busy, answers on DeepSeek V4 Flash"}
                </span>
                {model.dataNotice && (
                  <span className="text-[10px] text-muted-foreground/50">
                    {model.dataNotice}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
