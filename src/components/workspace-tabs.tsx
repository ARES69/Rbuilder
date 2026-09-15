import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

import { cn } from "@/lib/utils";

export type WorkspaceTab =
  | "preview"
  | "code"
  | "data"
  | "keys"
  | "integrations"
  | "skills"
  | "ui";

const TABS: { value: WorkspaceTab; label: string }[] = [
  { value: "preview", label: "Превью" },
  { value: "code", label: "Код" },
  { value: "data", label: "Данные" },
  { value: "skills", label: "Навыки" },
  { value: "keys", label: "API-ключи" },
  { value: "integrations", label: "Интеграции" },
  { value: "ui", label: "UI-компоненты" },
];

export function WorkspaceTabs({
  value,
  onChange,
  version,
}: {
  value: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  version?: number;
}) {
  const status = useQuery(api.settings.status, {});
  return (
    <div className="flex items-center justify-between border-b border-border/70 px-2">
      <Tabs value={value} onValueChange={(v) => onChange(v as WorkspaceTab)}>
        <TabsList className="h-8 rounded-none border-0 bg-transparent p-0">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "h-8 rounded-none border-0 border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground shadow-none",
                "data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
              )}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex items-center gap-1.5">
        {version && version > 0 ? (
          <Badge
            variant="outline"
            className="h-5 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            v{version}
          </Badge>
        ) : null}
        {status && !status.aiKey ? (
          <Badge
            variant="outline"
            className="h-5 rounded-full px-1.5 text-[10px] font-normal text-amber-600"
          >
            демо-режим
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
