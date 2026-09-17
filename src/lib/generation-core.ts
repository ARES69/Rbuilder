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

/* ------------------------------ delta editing ----------------------------- */

/**
 * Editing an existing project returns *patches*, not whole files.
 *
 * Sending a complete manifest back for a one-line change is what made every
 * iteration cost tens of thousands of tokens, and it is also how a model breaks
 * code it was never asked to touch. A patch can only change what it names.
 */
export interface EditOp {
  path: string;
  /** Exact fragment to locate in the file. Must be unique. */
  find?: string;
  replace?: string;
  /** Appended to the end of the file. */
  append?: string;
}

export interface EditPlan {
  edits: EditOp[];
  newFiles: GeneratedFile[];
  deleteFiles: string[];
}

export const EMPTY_EDIT_PLAN: EditPlan = { edits: [], newFiles: [], deleteFiles: [] };

export const EDIT_PROMPT = `You are RBuilder, an expert web app editor. The project already exists — you receive its relevant files. Return ONLY the changes, never the whole project.

STRICT OUTPUT RULES:
1. Output ONLY valid JSON. No markdown fences, no explanation, no commentary.
2. Shape: {"edits":[{"path":"src/App.tsx","find":"exact existing fragment","replace":"new fragment"}],"newFiles":[{"path":"src/New.tsx","content":"...","language":"tsx"}],"deleteFiles":["src/old.ts"]}
3. \`find\` must be copied character-for-character from the provided file and must occur exactly once in it. Include enough surrounding lines to be unique. Never invent or paraphrase it.
4. Put every brand-new file into \`newFiles\` with its complete content, and use \`append\` instead of \`find\`/\`replace\` when the change adds lines to the end of a file.
5. Send no edit for code you are not changing. Untouched files must not appear in the answer at all.
6. Omit empty arrays. Fully implement the requested behaviour — never leave stubs or placeholders.`;

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

function isSafePath(path: string): boolean {
  return Boolean(path) && !path.includes("..") && !path.startsWith(".");
}

/** Parse a delta-editing answer. Unparseable output yields an empty plan. */
export function parseEditResponse(raw: string): EditPlan {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return EMPTY_EDIT_PLAN;

  let parsed: { edits?: unknown; newFiles?: unknown; deleteFiles?: unknown };
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return EMPTY_EDIT_PLAN;
  }

  const edits: EditOp[] = Array.isArray(parsed.edits)
    ? parsed.edits
        .map((entry): EditOp | null => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const path = typeof record.path === "string" ? normalizePath(record.path) : "";
          if (!isSafePath(path)) return null;
          const find = typeof record.find === "string" ? record.find : undefined;
          const replace = typeof record.replace === "string" ? record.replace : undefined;
          const append = typeof record.append === "string" ? record.append : undefined;
          if (append && !find) return { path, append };
          if (find && replace !== undefined) return { path, find, replace };
          return null;
        })
        .filter((edit): edit is EditOp => edit !== null)
        .slice(0, 60)
    : [];

  const newFiles: GeneratedFile[] = Array.isArray(parsed.newFiles)
    ? parsed.newFiles
        .map((entry): GeneratedFile | null => {
          if (typeof entry !== "object" || entry === null) return null;
          const record = entry as Record<string, unknown>;
          const path = typeof record.path === "string" ? normalizePath(record.path) : "";
          if (!isSafePath(path) || typeof record.content !== "string") return null;
          return {
            path,
            content: record.content,
            language: typeof record.language === "string" ? record.language : undefined,
          };
        })
        .filter((file): file is GeneratedFile => file !== null)
        .slice(0, 30)
    : [];

  const deleteFiles: string[] = Array.isArray(parsed.deleteFiles)
    ? parsed.deleteFiles
        .filter((path): path is string => typeof path === "string")
        .map(normalizePath)
        .filter(isSafePath)
        .slice(0, 30)
    : [];

  return { edits, newFiles, deleteFiles };
}

export interface AppliedEdits {
  files: GeneratedFile[];
  /** Patches that landed, including created files. */
  applied: number;
  created: number;
  /** Human-readable reasons for patches that could not be applied. */
  failed: string[];
}

/** Apply a patch plan on top of the current files. Never mutates its input. */
export function applyEdits(
  current: GeneratedFile[],
  plan: EditPlan,
): AppliedEdits {
  const byPath = new Map(current.map((file) => [file.path, { ...file }]));
  const failed: string[] = [];
  let applied = 0;
  let created = 0;

  for (const edit of plan.edits) {
    const file = byPath.get(edit.path);
    if (!file) {
      failed.push(`${edit.path}: файла нет в проекте`);
      continue;
    }
    if (edit.append) {
      file.content = `${file.content.replace(/\s*$/, "")}\n${edit.append.trim()}\n`;
      applied += 1;
      continue;
    }
    const find = edit.find ?? "";
    if (!find || edit.replace === undefined) {
      failed.push(`${edit.path}: пустой find`);
      continue;
    }
    const index = file.content.indexOf(find);
    if (index === -1) {
      failed.push(`${edit.path}: фрагмент не найден дословно`);
      continue;
    }
    file.content =
      file.content.slice(0, index) + edit.replace + file.content.slice(index + find.length);
    applied += 1;
  }

  for (const file of plan.newFiles) {
    byPath.set(file.path, { ...file });
    created += 1;
  }

  for (const path of plan.deleteFiles) {
    byPath.delete(path);
  }

  const files = Array.from(byPath.values()).sort((a, b) => {
    if (a.path === "index.html") return -1;
    if (b.path === "index.html") return 1;
    return a.path.localeCompare(b.path);
  });

  return { files, applied: applied + created, created, failed };
}

/** Whether a plan actually changes anything. */
export function hasEditWork(plan: EditPlan): boolean {
  return plan.edits.length > 0 || plan.newFiles.length > 0 || plan.deleteFiles.length > 0;
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
