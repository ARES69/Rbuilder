/**
 * Public API surface.
 *
 * RBuilder already generates and publishes apps; this exposes the same pipeline
 * to the outside world (bots, n8n/Make, agencies, other products) behind a
 * bearer token. The interesting part is what is *not* here: an API key never
 * grants access to the account's UI session, only to its own quota — checks are
 * always made against the key's owner.
 */

export const API_KEY_PREFIX = "rbr_";
const API_KEY_HEX_BYTES = 24;
export const MAX_PROMPT_CHARS = 8000;
export const MIN_PROMPT_CHARS = 3;
export const MAX_PROJECT_NAME = 80;

/** `rbr_` + 48 hex characters. Shown to the user exactly once. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(API_KEY_HEX_BYTES);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/** Only a hash is stored — a leaked database must not leak working keys. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(`rbuilder:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function isApiKeyShaped(key: string): boolean {
  return (
    key.startsWith(API_KEY_PREFIX) &&
    key.length === API_KEY_PREFIX.length + API_KEY_HEX_BYTES * 2 &&
    /^[0-9a-f]+$/.test(key.slice(API_KEY_PREFIX.length))
  );
}

/** `Authorization: Bearer rbr_…` → the token, or null. */
export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (!match) return null;
  const token = match[1].trim();
  return isApiKeyShaped(token) ? token : null;
}

/** Display form: never the full key. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export interface GenerateRequest {
  prompt: string;
  model?: string;
  project?: string;
  deploy: boolean;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate and normalise a `POST /v1/generate` body. */
export function parseGenerateBody(raw: unknown): ParseResult<GenerateRequest> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Тело запроса должно быть JSON-объектом." };
  }
  const body = raw as Record<string, unknown>;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT_CHARS) {
    return { ok: false, error: "Укажите prompt — описание приложения." };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: `prompt длиннее ${MAX_PROMPT_CHARS} символов.` };
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return { ok: false, error: "model должен быть строкой (id модели)." };
  }
  if (body.deploy !== undefined && typeof body.deploy !== "boolean") {
    return { ok: false, error: "deploy должен быть true или false." };
  }
  if (
    body.project !== undefined &&
    (typeof body.project !== "string" || body.project.length > MAX_PROJECT_NAME)
  ) {
    return { ok: false, error: `project — строка до ${MAX_PROJECT_NAME} символов.` };
  }

  return {
    ok: true,
    value: {
      prompt,
      model: typeof body.model === "string" ? body.model.trim() : undefined,
      project: typeof body.project === "string" ? body.project.trim() : undefined,
      deploy: body.deploy === true,
    },
  };
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extra,
    },
  });
}

/** Owner-facing documentation, rendered in the app's API dialog. */
export const API_DOCS = {
  generate: {
    method: "POST",
    path: "/v1/generate",
    body: `{
  "prompt": "CRM для стоматологии: пациенты, записи, оплаты",
  "model": "deepseek-chat",
  "project": "smile-crm",
  "deploy": true
}`,
    response: `{
  "ok": true,
  "projectId": "jd7…",
  "version": 1,
  "url": "https://<deployment>.convex.site/p/smile-crm",
  "tokens": 21340,
  "costRub": 4.12
}`,
  },
  models: { method: "GET", path: "/v1/models" },
  me: { method: "GET", path: "/v1/me" },
} as const;
