import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  recipeSummary,
  parseRecipe,
  serializeRecipe,
  type SnapshotRecipe,
} from "@/lib/recipes";
import { toast } from "sonner";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Camera,
  CloudUpload,
  Download,
  Globe,
  Heart,
  Import,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

/**
 * Snapshots & recipes panel: freeze the whole configuration, publish it as a
 * recipe, deploy own/foreign recipes, import/export recipe files.
 */
export function SnapshotsPanel() {
  const snapshots = useQuery(api.snapshots.list, {});
  const published = useQuery(api.snapshots.listPublished, {});
  const createSnapshot = useMutation(api.snapshots.create);
  const removeSnapshot = useMutation(api.snapshots.remove);
  const setPublished = useMutation(api.snapshots.setPublished);
  const deploy = useMutation(api.snapshots.deploy);
  const like = useMutation(api.snapshots.like);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    recipe: SnapshotRecipe;
    source: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (busy) return;
    setBusy("create");
    try {
      const result = await createSnapshot({ name, description: description || undefined });
      setName("");
      setDescription("");
      toast.success(`Снапшот создан: ${result.summary}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать снапшот");
    } finally {
      setBusy(null);
    }
  };

  const handleDeploy = async (snapshotId?: Id<"snapshots">) => {
    if (busy) return;
    setBusy(snapshotId ?? "deploy");
    try {
      const result = await deploy(
        snapshotId ? { snapshotId } : { imported: undefined },
      );
      toast.success(
        `Развёрнуто «${result.deployed}»: ${result.summary}. Обновите вкладки Навыки/Инструменты.`,
      );
      setPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось развернуть рецепт");
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const parsed = parseRecipe(text);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setBusy("import");
    try {
      const result = await deploy({
        imported: {
          name: parsed.recipe.name,
          workspace: parsed.recipe.workspace,
          skills: parsed.recipe.skills,
          tools: parsed.recipe.tools,
        },
      });
      toast.success(`Развёрнуто «${result.deployed}»: ${result.summary}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось развернуть рецепт");
    } finally {
      setBusy(null);
    }
  };

  const handleExport = (snapshotId: Id<"snapshots">) => {
    const snapshot = snapshots?.find((s) => s._id === snapshotId);
    if (!snapshot) return;
    const recipe: SnapshotRecipe = {
      formatVersion: 1,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot._creationTime,
      workspace: snapshot.workspace,
      skills: snapshot.skills,
      tools: snapshot.tools,
    };
    const blob = new Blob([serializeRecipe(recipe)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${snapshot.name.replace(/[^\wа-яА-ЯёЁ -]/g, "").trim() || "recipe"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Рецепт экспортирован");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Снапшоты
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          вся конфигурация · без секретов
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-4 pt-2">
          {/* Create */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Camera className="size-3.5 text-muted-foreground" />
              Запомнить этот момент
            </h4>
            <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
              Снимок всего: навыки, инструменты, архитектура и правила workspace.
              Публикуйте как рецепт или разворачивайте обратно в один клик.
            </p>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Название снапшота"
                className="h-8 bg-card text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() => void handleCreate()}
                disabled={busy !== null || !name.trim()}
              >
                {busy === "create" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Camera className="size-3.5" />
                )}
                Снять
              </Button>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Описание (необязательно) — для чего этот набор настроек"
              className="mt-2 min-h-14 bg-card text-xs"
            />
          </section>

          {/* Own snapshots */}
          <section>
            <h4 className="mb-2 text-xs font-medium">
              Мои снапшоты ({snapshots?.length ?? 0})
            </h4>
            {!snapshots?.length ? (
              <p className="text-[11px] text-muted-foreground">
                Снапшотов пока нет — снимите первый.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {snapshots.map((snapshot) => (
                  <div
                    key={snapshot._id}
                    className="rounded-md border border-border/70 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{snapshot.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {recipeSummary({
                            formatVersion: 1,
                            name: snapshot.name,
                            createdAt: snapshot._creationTime,
                            workspace: snapshot.workspace,
                            skills: snapshot.skills,
                            tools: snapshot.tools,
                          })}
                          {snapshot.description ? ` · ${snapshot.description}` : ""}
                        </p>
                      </div>
                      {snapshot.published ? (
                        <Badge variant="outline" className="h-5 shrink-0 rounded-full px-2 text-[10px] font-normal">
                          <Globe className="mr-1 size-3" />
                          рецепт
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => void handleDeploy(snapshot._id)}
                        disabled={busy !== null}
                      >
                        {busy === snapshot._id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        Развернуть
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground"
                        onClick={() =>
                          void setPublished({
                            snapshotId: snapshot._id,
                            published: !snapshot.published,
                          })
                            .then(() =>
                              toast.success(
                                snapshot.published
                                  ? "Рецепт снят с публикации"
                                  : "Рецепт опубликован — виден всем",
                              ),
                            )
                            .catch((error) =>
                              toast.error(
                                error instanceof Error ? error.message : "Ошибка",
                              ),
                            )
                        }
                      >
                        <Globe className="size-3.5" />
                        {snapshot.published ? "Снять с публикации" : "Опубликовать"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground"
                        onClick={() => handleExport(snapshot._id)}
                      >
                        <Download className="size-3.5" />
                        Файл
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          void removeSnapshot({ snapshotId: snapshot._id })
                            .then(() => toast.success("Снапшот удалён"))
                            .catch(() => toast.error("Не удалось удалить"));
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Community recipes */}
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <CloudUpload className="size-3.5 text-muted-foreground" />
              Рецепты сообщества ({published?.length ?? 0})
            </h4>
            {!published?.length ? (
              <p className="text-[11px] text-muted-foreground">
                Публикаций пока нет — станьте первым автором рецепта.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {published.map((recipe) => (
                  <div
                    key={recipe._id}
                    className="rounded-md border border-border/70 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{recipe.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {recipe.skills} навыков · {recipe.tools} инструментов
                          {recipe.hasArchitecture ? " · архитектура" : ""}
                          {recipe.hasRules ? " · правила" : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 text-xs text-muted-foreground"
                        onClick={() => {
                          void like({ snapshotId: recipe._id }).catch((error) =>
                            toast.error(
                              error instanceof Error ? error.message : "Ошибка",
                            ),
                          );
                        }}
                      >
                        <Heart className="size-3.5" />
                        {recipe.likes}
                      </Button>
                    </div>
                    {recipe.description ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{recipe.description}</p>
                    ) : null}
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => void handleDeploy(recipe._id)}
                        disabled={busy !== null}
                      >
                        <Upload className="size-3.5" />
                        Сделать похожее
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      {/* Import / preview */}
      <div className="border-t border-border/70 px-4 py-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleImport(file);
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
          >
            {busy === "import" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Import className="size-3.5" />
            )}
            Импорт рецепта из файла
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={() => {
              // Show what WOULD be captured right now (no write).
              setBusy("preview");
              void (async () => {
                try {
                  const rows = snapshots ?? [];
                  if (rows.length === 0) {
                    toast.info("Сначала снимите снапшот — превью собирается из него");
                    return;
                  }
                  const latest = rows[0];
                  const recipe: SnapshotRecipe = {
                    formatVersion: 1,
                    name: latest.name,
                    description: latest.description,
                    createdAt: latest._creationTime,
                    workspace: latest.workspace,
                    skills: latest.skills,
                    tools: latest.tools,
                  };
                  setPreview({ recipe, source: latest.name });
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            <Download className="size-3.5" />
            Посмотреть JSON
          </Button>
        </div>
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              Рецепт «{preview?.recipe.name}»
            </DialogTitle>
            <DialogDescription className="text-xs">
              Секреты (ключи интеграций) в рецепт не входят — только настройки.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[45vh] rounded-md border border-border/70 bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-4">
              {preview ? serializeRecipe(preview.recipe) : ""}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!preview) return;
                void navigator.clipboard
                  .writeText(serializeRecipe(preview.recipe))
                  .then(() => toast.success("JSON скопирован"))
                  .catch(() => toast.error("Не удалось скопировать"));
              }}
            >
              Копировать
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
