import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BUILT_IN_SKILLS,
  SKILL_CATEGORIES,
  parseCustomSkill,
  type Skill,
  type SkillCategory,
} from "@/lib/skills";
import { MODELS } from "@/lib/models";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Puzzle, Search, Trash2, Zap } from "lucide-react";

type EffectiveSkill = Skill;

/** Builds a merged skill list: built-ins + user customs + enabled state. */
function useEffectiveSkills(): {
  skills: EffectiveSkill[];
  enabled: Set<string>;
  toggle: (skillId: string, enabled: boolean) => void;
  addCustom: (input: {
    name: string;
    desc: string;
    prompt: string;
    category: SkillCategory;
    source?: string;
  }) => Promise<void>;
  removeCustom: (skillId: string) => void;
  isLoading: boolean;
} {
  const data = useQuery(api.skills.list, {});
  const toggleMutation = useMutation(api.skills.toggle);
  const addMutation = useMutation(api.skills.addCustom);
  const removeMutation = useMutation(api.skills.removeCustom);

  return useMemo(() => {
    const enabledIds = new Set(data?.enabled ?? []);
    const customs = data?.customs ?? [];
    return {
      skills: [...BUILT_IN_SKILLS, ...customs],
      enabled: enabledIds,
      toggle: (skillId, on) => {
        void toggleMutation({ skillId, enabled: on }).catch(() =>
          toast.error("Не удалось изменить навык"),
        );
      },
      addCustom: async (input) => {
        await addMutation(input);
        toast.success("Навык добавлен и включён");
      },
      removeCustom: (skillId) => {
        void removeMutation({ skillId }).then(() => toast.success("Навык удалён"));
      },
      isLoading: data === undefined,
    };
  }, [data, toggleMutation, addMutation, removeMutation]);
}

export function SkillsPanel({ activeModelId }: { activeModelId?: string }) {
  const { skills, enabled, toggle, addCustom, removeCustom, isLoading } =
    useEffectiveSkills();
  const [category, setCategory] = useState<SkillCategory | null>(null);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter(
      (skill) =>
        (category === null || skill.category === category) &&
        (!q ||
          skill.name.toLowerCase().includes(q) ||
          skill.desc.toLowerCase().includes(q) ||
          skill.source.toLowerCase().includes(q)),
    );
  }, [skills, category, query]);

  const enabledCount = skills.filter((skill) => enabled.has(skill.id)).length;
  const activeModel = MODELS.find((model) => model.id === activeModelId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Skills
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {enabledCount} включено · {skills.length} доступно
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-4 py-2">
        <CategoryChip label="Все" active={category === null} onClick={() => setCategory(null)} />
        {SKILL_CATEGORIES.map((item) => (
          <CategoryChip
            key={item.id}
            label={item.label}
            active={category === item.id}
            onClick={() => setCategory(item.id)}
          />
        ))}
        <div className="relative ml-auto">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск…"
            className="h-7 w-36 bg-card pl-7 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" />
          Свой навык
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-4 pt-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Загрузка навыков…
            </div>
          ) : visible.length === 0 ? (
            <p className="py-6 text-xs text-muted-foreground">Ничего не найдено</p>
          ) : (
            visible.map((skill) => {
              const on = enabled.has(skill.id);
              const universal = skill.compatibleModels.length === 0;
              const compatible =
                universal || (activeModelId ? skill.compatibleModels.includes(activeModelId) : true);
              return (
                <div
                  key={skill.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors",
                    on ? "border-foreground/25 bg-accent/40" : "border-border/70",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium">{skill.name}</span>
                      <Badge
                        variant="outline"
                        className="h-4 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
                      >
                        {skill.source}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="h-4 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
                      >
                        {SKILL_CATEGORIES.find((c) => c.id === skill.category)?.label}
                      </Badge>
                      {!universal ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-4 rounded-full px-1.5 text-[10px] font-normal",
                            compatible ? "text-muted-foreground" : "text-amber-600",
                          )}
                        >
                          {compatible
                            ? `для ${skill.compatibleModels.join(", ")}`
                            : "не совпадает с моделью"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{skill.desc}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {on ? (
                      <Zap className="size-3.5 fill-current text-foreground" />
                    ) : null}
                    <Switch
                      checked={on}
                      onCheckedChange={(next) => toggle(skill.id, next)}
                      aria-label={`${on ? "Выключить" : "Включить"} навык ${skill.name}`}
                    />
                    {!skill.builtIn ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCustom(skill.id)}
                        aria-label={`Удалить навык ${skill.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Включённые навыки добавляются в инструкции агенту-строителю на каждом
            билде. Навык можно взять от любой модели — вставьте его определение
            через «Свой навык». Совместимость с моделью — рекомендация, а не
            ограничение.
          </p>
        </div>
      </ScrollArea>

      <AddSkillDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdd={addCustom}
        activeModelName={activeModel?.name}
      />
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function AddSkillDialog({
  open,
  onClose,
  onAdd,
  activeModelName,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: {
    name: string;
    desc: string;
    prompt: string;
    category: SkillCategory;
    source?: string;
  }) => Promise<void>;
  activeModelName?: string;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<SkillCategory>("code");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  const parsed = parseCustomSkill(text);

  async function submit() {
    if (!parsed) {
      toast.error("Первая строка — название, дальше — инструкции навыка");
      return;
    }
    setBusy(true);
    try {
      await onAdd({
        name: parsed.name,
        desc: parsed.prompt.slice(0, 80),
        prompt: parsed.prompt,
        category,
        source: source.trim() || "Custom",
      });
      setText("");
      setSource("");
      onClose();
    } catch {
      toast.error("Не удалось сохранить навык");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Свой навык</DialogTitle>
          <DialogDescription className="text-xs">
            Вставьте определение навыка от любой модели: первая строка —
            название, дальше — инструкции, которые агент будет соблюдать.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Категория</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SkillCategory)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_CATEGORIES.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="text-xs">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Источник (модель)</Label>
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={activeModelName ?? "GPT / Claude / …"}
                className="h-8 bg-card text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Определение навыка</Label>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder={
                "Всегда тёмная тема\nUSE_DARK_THEME: все генерируемые приложения должны использовать тёмную тему…"
              }
              className="resize-none bg-card text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => void submit()} disabled={busy || !parsed}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
