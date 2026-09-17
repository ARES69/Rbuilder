/**
 * Pure helpers for the generation pipeline.
 *
 * Everything here is free of Convex and network access so it can be unit
 * tested and reasoned about on its own — the pipeline file only wires these
 * together.
 */

export interface GeneratedFile {
  path: string;
  content: string;
  language?: string;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n<!-- truncated -->`;
}

export function extractHtml(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const doc = body.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  return (doc ? doc[0] : body).trim();
}

export function extractProjectFiles(raw: string): GeneratedFile[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate) as { files?: unknown };
    if (Array.isArray(parsed.files)) {
      const files = parsed.files.filter(
        (file): file is GeneratedFile =>
          typeof file === "object" &&
          file !== null &&
          typeof (file as { path?: unknown }).path === "string" &&
          typeof (file as { content?: unknown }).content === "string",
      );
      if (files.length > 0) return files.slice(0, 50);
    }
  } catch {
    // Older/provider models may still return raw HTML; keep that format working.
  }
  return [{ path: "index.html", content: extractHtml(raw), language: "html" }];
}

/* --------------------------------- review --------------------------------- */

export interface ReviewResult {
  verdict: "ok" | "fix";
  issues: string[];
}

/** How many repair passes the pipeline is allowed to run. */
export const MAX_REVIEW_ROUNDS = 2;

/**
 * Reviewer output is parsed structurally instead of with a bare
 * `startsWith("FIX:")`: models routinely answer "Looks good, OK." or wrap the
 * answer in prose, and a prefix check then silently accepts a broken build.
 */
export function parseReview(raw: string): ReviewResult {
  const text = raw.trim();
  if (!text) return { verdict: "ok", issues: [] };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as {
        verdict?: unknown;
        issues?: unknown;
        problems?: unknown;
        fixes?: unknown;
      };
      const verdictText = String(parsed.verdict ?? "").toLowerCase();
      const rawIssues = parsed.issues ?? parsed.problems ?? parsed.fixes;
      const issues = Array.isArray(rawIssues)
        ? rawIssues.map((issue) => String(issue)).filter(Boolean)
        : typeof rawIssues === "string"
          ? splitIssues(rawIssues)
          : [];
      if (verdictText === "ok" || verdictText === "pass") {
        return { verdict: "ok", issues: [] };
      }
      if (verdictText === "fix" || verdictText === "fail" || issues.length > 0) {
        return { verdict: "fix", issues };
      }
    } catch {
      // fall through to the legacy heuristics below
    }
  }

  const legacy = text.match(/^\s*FIX\s*:?\s*([\s\S]*)$/i);
  if (legacy) {
    return { verdict: "fix", issues: splitIssues(legacy[1]) };
  }
  return { verdict: "ok", issues: [] };
}

function splitIssues(text: string): string[] {
  return text
    .split(/\n+|(?<=\.)\s+(?=[A-ZА-Я])/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 3)
    .slice(0, 12);
}

/** One reviewer instruction shared by the pipeline and its tests. */
export const REVIEW_PROMPT = `You are the reviewer agent in a web-app building pipeline. You receive an app's HTML plus the plan it was built from. Check it for: broken structure, unclosed tags, missing functionality versus the plan, stubs or placeholder text, undefined handlers, and script errors.

Answer with ONLY minified JSON, no prose and no markdown fences:
{"verdict":"ok"|"fix","issues":["short, concrete, actionable item"]}
Use "ok" only when the app is genuinely complete and self-consistent. List at most 5 issues.`;

/* --------------------------------- errors --------------------------------- */

/** Statuses worth one more attempt: transient provider/network failures. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/**
 * Human message for a failed model call. The provider body is deliberately
 * never echoed back: it can contain the API key prefix, internal URLs or the
 * full request — and it is unreadable for the user anyway.
 */
export function describeModelError(
  status: number,
  providerLabel: string,
  detail = "",
): string {
  const hint = detail.toLowerCase();
  if (status === 401 || status === 403) {
    return `Ключ ${providerLabel} отклонён. Проверьте API-ключ в настройках проекта.`;
  }
  if (status === 402) {
    return `На счёте ${providerLabel} закончились средства. Пополните баланс или выберите другую модель.`;
  }
  if (status === 404 || (status === 400 && hint.includes("model"))) {
    return `Провайдер ${providerLabel} не знает такую модель. Выберите модель из списка или обновите поле apiModel в каталоге.`;
  }
  if (status === 413 || hint.includes("too large") || hint.includes("maximum context")) {
    return `Запрос слишком большой для ${providerLabel}. Уменьшите объём вложений или размер файлов.`;
  }
  if (status === 400) {
    return `Провайдер ${providerLabel} отклонил запрос: неподдерживаемый параметр или слишком большой контекст. Попробуйте другую модель.`;
  }
  if (status === 429) {
    return `Провайдер ${providerLabel} ограничивает частоту запросов. Подождите 30 секунд и повторите.`;
  }
  if (status === 408 || status === 504) {
    return `Провайдер ${providerLabel} не успел ответить. Попробуйте ещё раз.`;
  }
  if (status >= 500) {
    return `Провайдер ${providerLabel} временно недоступен. Попробуйте через минуту.`;
  }
  return `Ошибка генерации (${status}). Проверьте настройки модели и попробуйте снова.`;
}

/* --------------------------- context selection ---------------------------- */

const STOP_WORDS = new Set([
  "этот", "этого", "чтобы", "который", "которая", "также", "нужно", "надо",
  "сделать", "сделай", "добавить", "добавь", "приложение", "проект", "меня",
  "него", "если", "для", "как", "все", "the", "and", "with", "that", "this",
  "make", "build", "app", "application", "project", "please",
]);

function promptKeywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-zа-я0-9_./-]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  return Array.from(new Set(words)).slice(0, 40);
}

/**
 * Pick the files that matter for this request instead of replaying the whole
 * project into the prompt. `index.html` always leads, since it is the preview
 * entry point, and the result stops at `budgetChars`.
 */
export function selectRelevantFiles(
  files: GeneratedFile[],
  prompt: string,
  budgetChars: number,
): GeneratedFile[] {
  if (files.length === 0) return [];
  const keywords = promptKeywords(prompt);
  const scored = files.map((file) => {
    const path = file.path.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (path.includes(keyword)) score += 6;
      else if (file.content.toLowerCase().includes(keyword)) score += 1;
    }
    if (path === "index.html") score += 100;
    else if (path.endsWith("index.html")) score += 50;
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const selected: GeneratedFile[] = [];
  let used = 0;
  for (const { file } of scored) {
    if (used >= budgetChars) break;
    const remaining = budgetChars - used;
    const content =
      file.content.length > remaining ? truncate(file.content, remaining) : file.content;
    selected.push({ ...file, content });
    used += content.length;
  }
  return selected;
}

/** Render the selected files as a compact, labelled context block. */
export function formatProjectContext(files: GeneratedFile[]): string {
  return files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
}

/* ------------------------------ rate limiting ----------------------------- */

export const RATE_LIMITS = {
  /** Generations per signed-in user per hour. */
  perUserPerHour: 12,
  /** Generations per signed-in user per day. */
  perUserPerDay: 60,
  /** Hard cap for anonymous (auto-created) accounts per day. */
  anonymousPerDay: 3,
};

export interface UsageRecordLike {
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
}

/** Count generations inside a rolling window. */
export function countWithinWindow(
  records: UsageRecordLike[],
  windowMs: number,
  now: number,
): number {
  return records.filter((record) => now - record.createdAt <= windowMs).length;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function rateLimitError(): string {
  return `Слишком много генераций. Лимит — ${RATE_LIMITS.perUserPerHour} в час. Подождите немного и повторите.`;
}

export function anonymousLimitError(): string {
  return "Для гостевого аккаунта доступно ограниченное число сборок в день. Войдите, чтобы продолжить.";
}
