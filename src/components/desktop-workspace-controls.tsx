import { useState } from "react";
import { FolderOpen, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getDesktopRuntime, type DesktopRuntime, type GitStatus } from "@/lib/desktop-bridge";

export function DesktopWorkspaceControls() {
  const [runtime] = useState<DesktopRuntime>(() => getDesktopRuntime());
  const [root, setRoot] = useState<string | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);

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
      setGit(await runtime.gitStatus(selected));
      toast.success("Локальный workspace подключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открыть workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
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
      {git && (
        <Badge variant="outline" className="hidden h-6 max-w-36 gap-1 truncate px-2 text-[10px] text-muted-foreground xl:inline-flex" title={`${git.entries.length} изменений`}>
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{git.branch}</span>
          {git.entries.length > 0 ? <span className="text-amber-600">· {git.entries.length}</span> : null}
        </Badge>
      )}
    </div>
  );
}
