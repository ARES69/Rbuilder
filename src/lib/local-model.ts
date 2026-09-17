/**
 * Local-model bridge (LM Studio / Ollama / vLLM) — pure helpers.
 *
 * The Convex action cannot reach a user's `127.0.0.1`, but their browser can.
 * The pipeline parks a request in `modelRelay`; this module holds the shared
 * vocabulary between the parked row and the browser bridge that fulfils it:
 * what the bridge must send back and how the payload is validated.
 */

export interface RelayUsage {
  promptTokens: number;
  completionTokens: number;
}

export type RelayPayloadResult =
  | { ok: true; value: { text: string; usage?: RelayUsage } }
  | { ok: false; error: string };

/**
 * Validate the JSON string the bridge posts back through `modelRelay.fulfill`.
 *
 * Accepts `{ "text": "...", "usage": {...} }` on success and
 * `{ "error": "..." }` as a graceful failure; anything else is a bridge bug
 * and must surface as an error on the row instead of hanging the pipeline.
 */
export function parseRelayPayload(raw: string): RelayPayloadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Локальный мост вернул не-JSON ответ." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Локальный мост вернул неожиданный формат." };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return { ok: false, error: record.error.trim() };
  }
  if (typeof record.text !== "string") {
    return { ok: false, error: "В ответе локального моста нет поля text." };
  }
  let usage: RelayUsage | undefined;
  if (
    record.usage !== null &&
    typeof record.usage === "object" &&
    !Array.isArray(record.usage)
  ) {
    const rawUsage = record.usage as Record<string, unknown>;
    usage = {
      promptTokens:
        typeof rawUsage.promptTokens === "number" ? rawUsage.promptTokens : 0,
      completionTokens:
        typeof rawUsage.completionTokens === "number" ? rawUsage.completionTokens : 0,
    };
  }
  return { ok: true, value: { text: record.text, usage } };
}

/**
 * Build the OpenAI-compatible chat URL from what the bridge POSTs to.
 * Accepts `http://127.0.0.1:1234`, `…/v1`, `…/v1/` and a full URL.
 */
export function localChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/** True when the base URL points at the local machine. */
export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url.trim());
}

export interface LocalPreset {
  id: string;
  label: string;
  url: string;
  hint: string;
}

export const LOCAL_PRESETS: LocalPreset[] = [
  {
    id: "lmstudio",
    label: "LM Studio",
    url: "http://127.0.0.1:1234/v1",
    hint: "Включите Local Server в LM Studio",
  },
  {
    id: "ollama",
    label: "Ollama",
    url: "http://127.0.0.1:11434/v1",
    hint: "OLLAMA_ORIGINS=* для запросов из браузера",
  },
  {
    id: "vllm",
    label: "vLLM",
    url: "http://127.0.0.1:8000/v1",
    hint: "Запуск: vllm serve <model>",
  },
];

/** The bridge's own fetch request body, derived from a parked relay row. */
export function relayRequestBody(row: {
  apiModel: string;
  system: string;
  user: string;
  maxTokens: number;
}): string {
  return JSON.stringify({
    model: row.apiModel,
    messages: [
      { role: "system", content: row.system },
      { role: "user", content: row.user },
    ],
    temperature: 0.4,
    max_tokens: row.maxTokens,
  });
}

/** Extract completion text and usage from an OpenAI-compatible response. */
export function relayResponsePayload(body: {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}): string {
  return JSON.stringify({
    text: body.choices?.[0]?.message?.content ?? "",
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    },
  });
}
