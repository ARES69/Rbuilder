/**
 * Learned preferences.
 *
 * When the user edits generated code by hand in the Code panel, that edit is
 * the strongest signal about how they want their apps written. Instead of
 * letting those corrections disappear into a version history nobody reads, we
 * extract a small set of instruction-shaped patterns and feed them back into
 * the pipeline — so the next build already follows them.
 *
 * The detectors are deliberately plain regex checks on the *added* lines: they
 * are explainable ("мы заметили autoComplete 4 раза"), testable, and cannot
 * hallucinate a preference the user never showed.
 */

export interface DetectedPattern {
  kind: string;
  statement: string;
  evidence: string;
}

export interface PatternRecord {
  kind: string;
  statement: string;
  evidence: string[];
  strength: number;
}

const MAX_EVIDENCE = 5;
const EVIDENCE_LENGTH = 160;

interface Detector {
  kind: string;
  statement: string;
  /** Runs against the lines the user added, and the ones they removed. */
  test: (added: string, removed: string) => boolean;
}

export const PATTERN_DETECTORS: Detector[] = [
  {
    kind: "form.autocomplete",
    statement: "Проставляй autoComplete на поля ввода (email, password, name).",
    test: (added) => /autocomplete\s*=/i.test(added),
  },
  {
    kind: "ui.cursor",
    statement: "Добавляй cursor-pointer на кликабельные элементы.",
    test: (added) => /cursor-pointer/.test(added),
  },
  {
    kind: "form.required",
    statement: "Помечай обязательные поля атрибутом required.",
    test: (added) => /\brequired\b/.test(added),
  },
  {
    kind: "form.no-double-submit",
    statement:
      "Блокируй кнопку отправки, пока запрос в полёте — защита от двойной отправки формы.",
    test: (added) => /disabled=\{[^}]*\b(is)?submitt?ing/i.test(added),
  },
  {
    kind: "a11y.aria",
    statement: "Добавляй aria-label / aria-live для интерактивных и динамических элементов.",
    test: (added) => /aria-(label|labelledby|describedby|live|hidden)\s*=/.test(added),
  },
  {
    kind: "a11y.role-button",
    statement: 'Ставь role="button" и tabIndex на кликабельные div/span.',
    test: (added) => /role="button"/.test(added) || /tabindex=\{?0\}?/i.test(added),
  },
  {
    kind: "react.list-key",
    statement: "Всегда добавляй key в элементы, отрендеренные через map().",
    test: (added) => /key=\{/.test(added),
  },
  {
    kind: "async.try-catch",
    statement: "Оборачивай сетевые и асинхронные вызовы в try/catch с понятной ошибкой.",
    test: (added) => /try\s*\{/.test(added) && /await|fetch\(/.test(added),
  },
  {
    kind: "state.persistence",
    statement: "Сохраняй пользовательское состояние в localStorage с защитой от исключений.",
    test: (added) => /localStorage\.(get|set|remove)Item/.test(added),
  },
  {
    kind: "perf.memo",
    statement: "Оборачивай тяжёлые вычисления и колбэки в useMemo/useCallback.",
    test: (added) => /\buse(Memo|Callback)\(/.test(added),
  },
  {
    kind: "ui.transition",
    statement: "Добавляй плавные transition на hover-состояния.",
    test: (added) => /\btransition(-colors|-transform|-all)?\b/.test(added),
  },
  {
    kind: "theme.dark",
    statement: "Пиши стили сразу для тёмной темы через dark:.",
    test: (added) => /\bdark:/.test(added),
  },
  {
    kind: "types.no-any",
    statement: "Не используй any — указывай конкретный тип или unknown.",
    test: (added, removed) => /:\s*any\b/.test(removed) && /:\s*(unknown|[A-ZА-Я]\w*)\s*[;,)=]/.test(added),
  },
  {
    kind: "code.error-state",
    statement: "Показывай пользователю состояние ошибки, а не только успешный путь.",
    test: (added) => /(ошибк|Ошибк|error).{0,40}(toast|setError|state|message)/.test(added),
  },
];

/** Line chosen as the human-readable proof for each pattern. */
const EVIDENCE_PATTERNS: Record<string, RegExp> = {
  "form.autocomplete": /autocomplete=/i,
  "ui.cursor": /cursor-pointer/,
  "form.required": /required/,
  "form.no-double-submit": /disabled=\{/,
  "a11y.aria": /aria-/,
  "a11y.role-button": /role="button"|tabindex/i,
  "react.list-key": /key=\{/,
  "async.try-catch": /try\s*\{|await|fetch\(/,
  "state.persistence": /localstorage\./i,
  "perf.memo": /usememo\(|usecallback\(/i,
  "ui.transition": /transition/,
  "theme.dark": /dark:/,
  "types.no-any": /:\s*(unknown|[A-ZА-Я]\w*)\s*[;,)=]/,
  "code.error-state": /ошибк|error/i,
};

const HEX_COLOR = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const MAX_COLORS = 4;

function addedLines(before: string, after: string): { added: string; removed: string } {
  const beforeLines = new Set(before.split("\n").map((line) => line.trim()));
  const afterLines = after.split("\n").map((line) => line.trim());
  const added = afterLines.filter((line) => line && !beforeLines.has(line)).join("\n");

  const afterSet = new Set(afterLines);
  const removed = before
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !afterSet.has(line))
    .join("\n");

  return { added, removed };
}

function firstEvidence(added: string, test: RegExp): string {
  for (const line of added.split("\n")) {
    if (test.test(line)) return line.slice(0, EVIDENCE_LENGTH);
  }
  return "";
}

/** Extract the preferences a single manual edit demonstrates. */
export function detectPatterns(
  before: string,
  after: string,
  path: string,
): DetectedPattern[] {
  if (before === after) return [];
  const { added, removed } = addedLines(before, after);
  if (!added) return [];

  const found: DetectedPattern[] = [];
  for (const detector of PATTERN_DETECTORS) {
    let matched = false;
    try {
      matched = detector.test(added, removed);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    found.push({
      kind: detector.kind,
      statement: detector.statement,
      evidence:
        firstEvidence(added, EVIDENCE_PATTERNS[detector.kind] ?? /./) || path,
    });
  }

  // Colour preferences are project-specific, so they are collected separately
  // from the fixed detectors above.
  const beforeColors = new Set(before.match(HEX_COLOR) ?? []);
  const addedColors = (added.match(HEX_COLOR) ?? [])
    .map((color) => color.toLowerCase())
    .filter((color) => !beforeColors.has(color));
  const palette = Array.from(new Set(addedColors)).slice(0, MAX_COLORS);
  if (palette.length > 0) {
    found.push({
      kind: "style.palette",
      statement: `Держись этой палитры: ${palette.join(", ")}.`,
      evidence: palette.join(" "),
    });
  }

  return found;
}

/** Fold newly observed patterns into the stored ones. */
export function mergePatterns(
  existing: PatternRecord[],
  detected: DetectedPattern[],
): PatternRecord[] {
  const byKind = new Map(existing.map((row) => [row.kind, { ...row }]));
  for (const pattern of detected) {
    const current = byKind.get(pattern.kind);
    if (!current) {
      byKind.set(pattern.kind, {
        kind: pattern.kind,
        statement: pattern.statement,
        evidence: [pattern.evidence].filter(Boolean),
        strength: 1,
      });
      continue;
    }
    current.statement = pattern.statement;
    current.strength += 1;
    current.evidence = [pattern.evidence, ...current.evidence]
      .filter(Boolean)
      .slice(0, MAX_EVIDENCE);
  }
  return Array.from(byKind.values());
}

/** Strongest preferences first — the order the prompt uses. */
export function rankPatterns(patterns: PatternRecord[], limit = 12): PatternRecord[] {
  return [...patterns]
    .sort((a, b) => b.strength - a.strength || a.kind.localeCompare(b.kind))
    .slice(0, limit);
}

/** Prompt block injected into the builder/reviewer instructions. */
export function formatUserPatterns(patterns: PatternRecord[]): string {
  const ranked = rankPatterns(patterns);
  if (ranked.length === 0) return "";
  const lines = ranked.map(
    (pattern) =>
      `- ${pattern.statement}${
        pattern.strength > 1 ? ` (в его правках — ${pattern.strength} раз)` : ""
      }`,
  );
  return `ПОСТОЯННЫЕ ПРЕДПОЧТЕНИЯ ЭТОГО ПОЛЬЗОВАТЕЛЯ (выведены из его ручных правок — соблюдай их по умолчанию):\n${lines.join("\n")}`;
}
