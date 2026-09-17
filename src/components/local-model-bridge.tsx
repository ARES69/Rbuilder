import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  LOCAL_PRESETS,
  isLocalUrl,
  localChatUrl,
  relayRequestBody,
  relayResponsePayload,
} from "@/lib/local-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Browser bridge for locally hosted models.
 *
 * The Convex backend cannot reach a user's `127.0.0.1`, but this tab can:
 * while mounted it claims pending relay rows and forwards each one to the
 * local OpenAI-compatible endpoint (LM Studio / Ollama / vLLM), then writes
 * the answer back. Mounted permanently in the dashboard, so a build that
 * selected the "Локальная модель" entry just works — no keys, no cloud.
 *
 * The endpoint URL lives in localStorage: it is machine-specific, per-browser
 * configuration and must never be sent to or stored on the server.
 */

const STORAGE_KEY = "rbuilder-local-endpoint";
const CONSECUTIVE_FAILURES_BEFORE_WARN = 3;

interface RelayRow {
  _id: Id<"modelRelay">;
  apiModel: string;
  system: string;
  user: string;
  maxTokens: number;
  status: "pending" | "done" | "error";
  createdAt: number;
}

function loadEndpoint(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? LOCAL_PRESETS[0].url;
  } catch {
    return LOCAL_PRESETS[0].url;
  }
}

export function LocalModelBridge() {
  const [endpoint, setEndpoint] = useState<string>(loadEndpoint);
  const [draft, setDraft] = useState<string>(endpoint);
  const [expanded, setExpanded] = useState(false);
  const [reachability, setReachability] = useState<
    "unknown" | "checking" | "up" | "down"
  >("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const busyRef = useRef(false);

  const relay = useQuery(api.modelRelay.pending) as RelayRow | null;
  const fulfill = useMutation(api.modelRelay.fulfill);

  // Probe the local server whenever the endpoint changes, so the user gets
  // immediate feedback that LM Studio/Ollama is (or is not) reachable.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!endpoint.trim()) return;
      setReachability("checking");
      try {
        const res = await fetch(localChatUrl(endpoint).replace("/chat/completions", "/models"), {
          method: "GET",
        });
        if (!cancelled) setReachability(res.ok ? "up" : "down");
      } catch {
        if (!cancelled) setReachability("down");
      }
    };
    void probe();
    const timer = window.setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [endpoint]);

  // Relay loop: one request at a time; failures recorded to surface a hint.
  useEffect(() => {
    if (!relay || relay.status !== "pending" || busyRef.current) return;
    if (!endpoint.trim() || !isLocalUrl(endpoint)) return;
    busyRef.current = true;
    void (async () => {
      try {
        const res = await fetch(localChatUrl(endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: relayRequestBody(relay),
        });
        if (!res.ok) {
          throw new Error(`локальный сервер ответил ${res.status}`);
        }
        const body = (await res.json()) as Parameters<typeof relayResponsePayload>[0];
        await fulfill({ relayId: relay._id, payload: relayResponsePayload(body) });
        setConsecutiveFailures(0);
        setLastError(null);
      } catch (error) {
        setConsecutiveFailures((count) => count + 1);
        const message =
          error instanceof Error ? error.message : "не удалось связаться";
        setLastError(message);
        await fulfill({
          relayId: relay._id,
          payload: JSON.stringify({ error: message }),
        }).catch(() => undefined);
      } finally {
        busyRef.current = false;
      }
    })();
  }, [relay, endpoint, fulfill]);

  const up = reachability === "up";
  const warn =
    consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_WARN || reachability === "down";

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <Radio
            className={cn(
              "size-3.5 shrink-0",
              up ? "text-emerald-600" : warn ? "text-amber-600" : "text-muted-foreground",
            )}
          />
          <span className="truncate font-medium">Локальная модель</span>
          {relay ? (
            <Badge
              variant="outline"
              className="h-4 shrink-0 rounded-full px-1.5 text-[10px] font-normal"
            >
              запрос…
            </Badge>
          ) : null}
        </button>
        {up ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
        ) : reachability === "down" ? (
          <XCircle className="size-3.5 shrink-0 text-amber-600" />
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2.5 border-t border-border/60 pt-2.5">
          <div className="space-y-1">
            <Label htmlFor="rbuilder-local-endpoint" className="text-[11px]">
              Адрес локального сервера
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="rbuilder-local-endpoint"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="http://127.0.0.1:1234/v1"
                className="h-7 font-mono text-[11px]"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  const next = draft.trim() || LOCAL_PRESETS[0].url;
                  setEndpoint(next);
                  try {
                    window.localStorage.setItem(STORAGE_KEY, next);
                  } catch {
                    /* private mode: session-only */
                  }
                }}
              >
                Сохранить
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {LOCAL_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] text-muted-foreground"
                  onClick={() => {
                    setDraft(preset.url);
                    setEndpoint(preset.url);
                    try {
                      window.localStorage.setItem(STORAGE_KEY, preset.url);
                    } catch {
                      /* private mode: session-only */
                    }
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground/80">
            {up
              ? "Сервер отвечает — можно выбрать модель «Локальная модель» и работать без облака."
              : "Запустите LM Studio (Local Server) или Ollama на этом компьютере. Для Ollama задайте OLLAMA_ORIGINS=* — браузер отправляет запросы напрямую."}
          </p>
          {lastError ? (
            <p className="text-[10px] leading-4 text-destructive">{lastError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
