import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Terminal } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { siteBaseUrl } from "@/lib/deploy";
import { API_DOCS } from "@/lib/public-api";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

/**
 * Bearer-token access to the same generation pipeline the chat uses.
 *
 * Keys are shown once at creation and only ever stored hashed, so this panel is
 * the only place the plaintext can be copied.
 */
export function PublicApiPanel() {
  const keys = useQuery(api.apiKeys.list, {});
  const createKey = useAction(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const base = siteBaseUrl(CONVEX_URL);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createKey({ name: name.trim() || undefined });
      setFreshKey(result.key);
      setName("");
      toast.success("Ключ создан — скопируйте его сейчас");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать ключ");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Публичный API</span>
        </div>
        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
          {keys?.filter((key) => !key.revokedAt).length ?? 0} активных
        </Badge>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Тот же конвейер, что и в чате. Вызывайте генерацию из Telegram-бота, n8n,
        Make или своего продукта: ключ даёт доступ только к вашей квоте и не может
        войти в интерфейс.
      </p>

      <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/30 p-3">
        <code className="text-[11px] text-muted-foreground">
          {API_DOCS.generate.method} {base}
          {API_DOCS.generate.path}
        </code>
        <pre className="overflow-x-auto rounded border border-border/60 bg-background/60 p-2 text-[10px] leading-4">
{`curl -X POST ${base}${API_DOCS.generate.path} \\
  -H "Authorization: Bearer $RBUILDER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${API_DOCS.generate.body}'`}
        </pre>
        <p className="text-[10px] text-muted-foreground/70">
          Ответ: projectId, tokens, costRub и при <code>deploy: true</code> — ссылка
          на опубликованное приложение. Дополнительно: {API_DOCS.models.method}{" "}
          {base}
          {API_DOCS.models.path} и {API_DOCS.me.method} {base}
          {API_DOCS.me.path}.
        </p>
      </div>

      {freshKey ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3">
          <span className="text-[11px] text-emerald-200">
            Скопируйте ключ сейчас — он больше не будет показан.
          </span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-100">
              {freshKey}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[10px] text-emerald-200"
              onClick={() => {
                void navigator.clipboard?.writeText(freshKey);
                toast.success("Ключ скопирован");
              }}
            >
              <Copy className="size-3" /> Копировать
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="public-api-key-name" className="text-[11px] text-muted-foreground">
          Новый ключ
        </Label>
        <div className="flex gap-2">
          <Input
            id="public-api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например: telegram-bot"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0"
            disabled={creating}
            onClick={() => void handleCreate()}
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : "Создать"}
          </Button>
        </div>
      </div>

      {keys && keys.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/60">
          {keys.map((key) => (
            <li key={key._id} className="flex items-center gap-3 py-2">
              <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs">{key.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  {key.prefix} · {key.requestCount} запросов
                  {key.lastUsedAt
                    ? ` · последний ${new Date(key.lastUsedAt).toLocaleString("ru-RU")}`
                    : " · ещё не использовался"}
                  {key.revokedAt ? " · отозван" : ""}
                </span>
              </span>
              {!key.revokedAt ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1.5 text-[10px] text-destructive"
                  onClick={() => {
                    void revokeKey({ keyId: key._id }).then(() =>
                      toast.success("Ключ отозван"),
                    );
                  }}
                >
                  Отозвать
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground/70">
          Активных ключей нет. Создайте первый — он даёт доступ только к генерации и
          публикации в вашем аккаунте.
        </p>
      )}
    </section>
  );
}
