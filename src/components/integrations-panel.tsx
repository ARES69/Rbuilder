import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SERVICE_CATEGORIES, RU_SERVICES, type RuService } from "@/lib/ru-services";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";

type Connection = {
  _id: string;
  serviceId: string;
  status: string;
  statusMessage?: string;
  webhookKey?: string;
  meta?: string;
  _creationTime: number;
};

/** Incoming-webhook base URL: Convex HTTP actions live on *.convex.site. */
function webhookBaseUrl(): string {
  const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
  return convexUrl.replace(".convex.cloud", ".convex.site").replace(/\/+$/, "");
}

/* ------------------------------- main panel ------------------------------- */

export function IntegrationsPanel() {
  const connections = useQuery(api.integrations.list, {});
  const events = useQuery(api.integrations.listEvents, { limit: 8 });
  const [category, setCategory] = useState<string | null>(null);
  const [connectTarget, setConnectTarget] = useState<RuService | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<RuService | null>(null);

  const byService = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const connection of connections ?? []) map.set(connection.serviceId, connection);
    return map;
  }, [connections]);

  const visible = useMemo(
    () => (category ? RU_SERVICES.filter((s) => s.category === category) : RU_SERVICES),
    [category],
  );

  const connectedCount = connections?.filter((c) => c.status === "connected").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Интеграции
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {connectedCount} подключено · {RU_SERVICES.length} сервисов
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-4 py-2">
        <CategoryChip label="Все" active={category === null} onClick={() => setCategory(null)} />
        {SERVICE_CATEGORIES.map((c) => (
          <CategoryChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-4 pt-3">
          {visible.map((service) => {
            const connection = byService.get(service.id);
            return (
              <ServiceRow
                key={service.id}
                service={service}
                connection={connection}
                onConnect={() => setConnectTarget(service)}
                onDetails={() => setDetailsTarget(service)}
              />
            );
          })}

          {(events?.length ?? 0) > 0 && (
            <section className="mt-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                <Webhook className="size-3" />
                Последние события (webhooks)
              </h4>
              <div className="flex flex-col gap-1">
                {events!.map((event) => (
                  <div
                    key={event._id}
                    className="flex items-center justify-between rounded-md border border-border/60 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate">
                      <span className="text-muted-foreground">{event.serviceId}</span>
                      <span className="mx-1.5 text-muted-foreground/50">·</span>
                      {event.event}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {new Date(event._creationTime).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>

      <ConnectDialog
        service={connectTarget}
        existing={connectTarget ? byService.get(connectTarget.id) : undefined}
        onClose={() => setConnectTarget(null)}
      />
      <ConnectionDetails
        service={detailsTarget}
        connection={detailsTarget ? byService.get(detailsTarget.id) : undefined}
        onClose={() => setDetailsTarget(null)}
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

function ServiceRow({
  service,
  connection,
  onConnect,
  onDetails,
}: {
  service: RuService;
  connection?: Connection;
  onConnect: () => void;
  onDetails: () => void;
}) {
  const disconnect = useMutation(api.integrations.disconnect);
  const status = connection?.status;

  return (
    <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Plug className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{service.name}</span>
          <Badge
            variant="outline"
            className="h-4 rounded-full px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            {service.category}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{service.desc}</p>
        {status === "error" && connection?.statusMessage ? (
          <p className="mt-0.5 truncate text-[11px] text-destructive">{connection.statusMessage}</p>
        ) : null}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1.5">
        {status === undefined ? null : status === "connected" ? (
          <Badge
            variant="outline"
            className="h-5 rounded-full border-foreground/30 px-2 text-[10px] font-normal"
          >
            <Check className="mr-1 size-2.5" /> подключено
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="h-5 rounded-full px-2 text-[10px] font-normal text-muted-foreground"
          >
            {status === "error" ? "ошибка" : "не подключено"}
          </Badge>
        )}
        {status === "connected" || status === "error" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onDetails()}
          >
            Детали
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onConnect}>
          {status ? "Изменить" : "Подключить"}
        </Button>
        {connection ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
            onClick={() =>
              void disconnect({ connectionId: connection._id as never }).then(() =>
                toast.success(`${service.name} отключён`),
              )
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------- connect dialog ----------------------------- */

function ConnectDialog({
  service,
  existing,
  onClose,
}: {
  service: RuService | null;
  existing?: Connection;
  onClose: () => void;
}) {
  const connect = useAction(api.integrations.connect);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const open = service !== null;

  function reset() {
    setValues({});
    setResult(null);
  }

  async function submit() {
    if (!service) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await connect({ serviceId: service.id, credentials: values });
      setResult({ ok: response.ok, message: response.message });
      if (response.ok) {
        toast.success(response.message);
      } else {
        toast.error(response.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось подключиться";
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {service ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">Подключение — {service.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {service.desc}. Ключи хранятся на сервере и не покидают его.
              </DialogDescription>
            </DialogHeader>

            <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto py-1 pr-1">
              {service.fields.map((field) => (
                <div key={field.id} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${service.id}-${field.id}`} className="text-xs">
                    {field.label}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <Input
                    id={`${service.id}-${field.id}`}
                    type={
                      field.type === "password" ? "password" : field.type === "url" ? "url" : "text"
                    }
                    placeholder={field.placeholder}
                    autoComplete="off"
                    className="h-8 bg-card text-xs"
                    value={values[field.id] ?? ""}
                    onChange={(e) =>
                      setValues((previous) => ({ ...previous, [field.id]: e.target.value }))
                    }
                  />
                  {field.help ? (
                    <p className="text-[11px] leading-4 text-muted-foreground">{field.help}</p>
                  ) : null}
                </div>
              ))}

              {result ? (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs leading-5",
                    result.ok
                      ? "border-foreground/20 text-foreground"
                      : "border-destructive/40 text-destructive",
                  )}
                >
                  {result.message}
                </div>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <a
                href={service.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="mr-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Документация API
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Проверить
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => void submit()} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <KeyRound className="mr-1.5 size-3.5" />}
                Подключить
              </Button>
            </DialogFooter>
            {existing ? (
              <p className="text-center text-[11px] text-muted-foreground">
                Существующее подключение будет обновлено новыми ключами.
              </p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- connection details --------------------------- */

function ConnectionDetails({
  service,
  connection,
  onClose,
}: {
  service: RuService | null;
  connection?: Connection;
  onClose: () => void;
}) {
  const rotate = useMutation(api.integrations.rotateWebhookKey);
  const [copied, setCopied] = useState(false);

  const webhookUrl =
    connection?.webhookKey
      ? `${webhookBaseUrl()}/webhooks/${connection.webhookKey}`
      : null;

  if (!service || !connection) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{service.name}</DialogTitle>
          <DialogDescription className="text-xs">
            Статус: {connection.status === "connected" ? "подключено" : "ошибка"}
            {connection.meta ? ` · ${connection.meta}` : ""}
          </DialogDescription>
        </DialogHeader>

        {connection.statusMessage ? (
          <div className="rounded-md border border-border/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {connection.statusMessage}
          </div>
        ) : null}

        {webhookUrl ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Webhook className="size-3.5 text-muted-foreground" />
              Webhook для входящих событий
            </div>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-muted/40 px-2 py-1.5 text-[11px]">
                {webhookUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl).then(() => {
                    setCopied(true);
                    toast.success("URL скопирован");
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                title="Сгенерировать новый ключ"
                onClick={() =>
                  void rotate({ connectionId: connection._id as never }).then(() =>
                    toast.success("Новый webhook-ключ сгенерирован"),
                  )
                }
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Укажите этот URL в настройках Битрикс24 / VK / Т-Банк — события будут
              появляться в списке выше и в панели Data.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
