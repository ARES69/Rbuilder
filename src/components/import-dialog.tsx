import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { classifyFile, classifyUrl, describeSource } from "@/lib/import-sources";
import { toast } from "sonner";
import { useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { FileInput, Link2, Loader2, Upload } from "lucide-react";

/**
 * Import dialog: turn a Figma/v0/Lovable/page url, a PDF spec or a website
 * screenshot into a structured prompt block. The result is placed into the
 * composer for review — the user always sees and edits what will be built.
 */
export function ImportDialog({
  open,
  onClose,
  onImported,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (prompt: string, source: string) => void;
  /** File imports create an attachment inside this project. */
  projectId?: Id<"projects">;
}) {
  const importAction = useAction(api.importSource.importSource);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Files must live in storage before the action can read them.
  const uploadFile = useMutation(api.attachments.generateUploadUrl);
  const createAttachment = useMutation(api.attachments.create);

  const urlSource = useMemo(() => classifyUrl(url), [url]);
  const fileKind = useMemo(
    () => (file ? classifyFile(file.name, file.type) : null),
    [file],
  );

  const ready = Boolean(url.trim()) || Boolean(file);

  const handleImport = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      if (url.trim()) {
        const result = await importAction({ url: url.trim() });
        onImported(result.prompt, result.source);
        onClose();
        return;
      }
      if (file) {
        // 1. upload to storage, 2. create attachment in the current project.
        if (!projectId) {
          throw new Error("Сначала создайте проект — импорт привязывается к нему.");
        }
        const uploadUrl = await uploadFile({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error("Не удалось загрузить файл");
        const payload = (await response.json()) as { storageId?: Id<"_storage"> };
        if (!payload.storageId) throw new Error("Сервер не вернул идентификатор файла");
        const attachmentId = await createAttachment({
          projectId: projectId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          storageId: payload.storageId,
        });
        const result = await importAction({ attachmentId });
        onImported(result.prompt, result.source);
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось импортировать");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileInput className="size-4" />
            Импорт из источника
          </DialogTitle>
          <DialogDescription className="text-xs">
            Figma-ссылка, экспорт из v0/Lovable, скриншот или PDF с ТЗ — всё
            превращается в структурированный запрос. Вы просмотрите его перед
            сборкой.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Link2 className="size-3.5 text-muted-foreground" />
              Ссылка
            </Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://figma.com/file/… или https://v0.dev/r/…"
              className="h-8 bg-card text-xs"
            />
            {url.trim() ? (
              <p className="text-[11px] text-muted-foreground">
                {urlSource.kind === "unknown"
                  ? "Не похоже на поддерживаемую ссылку — попробуем как обычную страницу."
                  : `Распознано: ${describeSource(urlSource)}`}
              </p>
            ) : null}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/70" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-2 text-[10px] tracking-wide text-muted-foreground/60 uppercase">
                или файл
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*,.tsx,.jsx,.zip"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 justify-start gap-1.5 text-xs"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-3.5" />
              {file ? file.name : "Выбрать PDF или скриншот"}
            </Button>
            {fileKind ? (
              <p className="text-[11px] text-muted-foreground">
                {fileKind.kind === "unknown"
                  ? "Тип файла не поддерживается — нужен PDF, картинка или экспорт кода."
                  : `Распознано: ${describeSource({ kind: fileKind.kind })}`}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => void handleImport()}
            disabled={busy || !ready}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileInput className="size-3.5" />}
            Импортировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
