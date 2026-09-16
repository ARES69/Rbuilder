import { useState } from "react";
import { Monitor, FolderOpen, Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getDesktopRuntime, type DesktopRuntime } from "@/lib/desktop-bridge";

export function DesktopStatus() {
  const [runtime] = useState<DesktopRuntime>(() => getDesktopRuntime());

  if (runtime.available) {
    return (
      <Badge variant="outline" className="hidden h-6 gap-1 px-2 text-[10px] text-emerald-600 lg:inline-flex" title="Локальный desktop bridge подключён">
        <Monitor className="size-3" /> Desktop
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="hidden h-6 gap-1 px-2 text-[10px] text-muted-foreground lg:inline-flex" title="Откройте RBuilder Desktop для локальных файлов, Git и терминала">
      <Globe2 className="size-3" /> Web
      <FolderOpen className="ml-0.5 size-3 opacity-60" />
    </Badge>
  );
}
