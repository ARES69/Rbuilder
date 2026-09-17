/**
 * Anti-pattern detection.
 *
 * Generated apps are usually pretty, and usually ship a few mistakes that a
 * beginner cannot spot: a `map()` without `key`, a clickable `div` with no
 * role, a secret pasted straight into the bundle. These rules are plain,
 * explainable checks over the generated source so the result can be reviewed
 * before the user shows it to anyone.
 *
 * Deliberately regex-based: no parser, no dependency, and every finding can be
 * pointed at a line the user can read.
 */

export type IssueSeverity = "error" | "warning" | "info";

export interface AntiPatternIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  path: string;
  line: number;
}

export interface SourceFile {
  path: string;
  content: string;
}

interface Rule {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Base pattern; every match is a candidate finding. */
  pattern: RegExp;
  /** The finding only counts when this is present nearby. */
  requireNear?: { pattern: RegExp; chars: number };
  /** The finding only counts when this is absent nearby. */
  forbidNear?: { pattern: RegExp; chars: number };
  /** Only these extensions are inspected. */
  extensions?: string[];
}

export const CODE_EXTENSIONS = [".html", ".htm", ".tsx", ".jsx", ".ts", ".js", ".css"];

export const ANTI_PATTERN_RULES: Rule[] = [
  {
    id: "react.effect-stale-props",
    severity: "warning",
    title: "useEffect с пустыми зависимостями читает props",
    detail:
      "Эффект запустится один раз и останется со старым значением props. Добавьте его в массив зависимостей или читайте значение внутри эффекта.",
    pattern: /useEffect\([\s\S]{0,500}?\},\s*\[\s*\]\s*\)/g,
    requireNear: { pattern: /\bprops\./, chars: 520 },
  },
  {
    id: "react.map-without-key",
    severity: "warning",
    title: "map() без key",
    detail:
      "Без key React переиспользует не те элементы при обновлении списка: строки «переезжают», состояние путается.",
    pattern: /\.map\(/g,
    forbidNear: { pattern: /\bkey=/, chars: 320 },
  },
  {
    id: "a11y.clickable-div",
    severity: "error",
    title: "Кликабельный div без role",
    detail:
      'С клавиатуры такой элемент недоступен. Используйте <button> или добавьте role="button", tabIndex={0} и обработчик Enter.',
    pattern: /<(?:div|span)\b[^>]*onClick=/g,
    forbidNear: { pattern: /role="button"|tabIndex=/, chars: 200 },
  },
  {
    id: "a11y.blank-target",
    severity: "warning",
    title: "target=\"_blank\" без rel=\"noreferrer\"",
    detail:
      "Открытая страница получает доступ к window.opener. Добавьте rel=\"noreferrer\".",
    pattern: /target=["']_blank["']/g,
    forbidNear: { pattern: /rel=/, chars: 160 },
  },
  {
    id: "a11y.image-alt",
    severity: "warning",
    title: "<img> без alt",
    detail: "Скринридер прочитает имя файла. Добавьте alt с описанием изображения.",
    pattern: /<img\b[^>]*>/g,
    forbidNear: { pattern: /\balt=/, chars: 200 },
  },
  {
    id: "async.fetch-in-loop",
    severity: "warning",
    title: "fetch внутри цикла",
    detail:
      "Такой цикл делает N запросов последовательно и вешает интерфейс. Загрузите данные одним запросом или через Promise.all.",
    pattern: /\b(?:for\s*\(|while\s*\(|\.map\()/g,
    requireNear: { pattern: /fetch\(/, chars: 420 },
  },
  {
    id: "async.unhandled-fetch",
    severity: "warning",
    title: "fetch без обработки ошибки",
    detail:
      "Сеть падает у реальных пользователей. Оберните запрос в try/catch и покажите понятное сообщение.",
    pattern: /await\s+fetch\(/g,
    forbidNear: { pattern: /catch\s*\(/, chars: 900 },
  },
  {
    id: "security.hardcoded-secret",
    severity: "error",
    title: "Секрет зашит в код",
    detail:
      "Ключ в браузерном коде видит любой пользователь. Храните секреты в переменных окружения на сервере.",
    pattern: /(?:password|api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{8,}["']/gi,
    forbidNear: { pattern: /process\.env|import\.meta\.env|placeholder/, chars: 220 },
  },
  {
    id: "security.javascript-url",
    severity: "error",
    title: 'href="javascript:"',
    detail: "Такой переход блокируется браузером и открывает XSS. Используйте обработчик onClick.",
    pattern: /href=["']javascript:/gi,
  },
  {
    id: "types.any",
    severity: "info",
    title: "Используется any",
    detail: "any отключает проверку типов. Опишите форму данных или используйте unknown.",
    pattern: /:\s*any\b/g,
  },
  {
    id: "debug.console-log",
    severity: "info",
    title: "Отладочный console.log",
    detail: "Уберите отладочный вывод перед публикацией, чтобы не мусорить в консоли пользователя.",
    pattern: /console\.log\(/g,
  },
  {
    id: "markup.string-handler",
    severity: "info",
    title: "Обработчик задан строкой",
    detail:
      'onclick="..." не видит замыкание и ломается при сборке. Навесьте обработчик из кода.',
    pattern: /on(?:click|submit|change|input)=["']/gi,
  },
  {
    id: "layout.fixed-width",
    severity: "info",
    title: "Жёсткая ширина больше экрана телефона",
    detail: "На 375px такой блок вызовет горизонтальный скролл. Используйте max-width и проценты.",
    pattern: /width:\s*(?:[3-9]\d{2}|\d{4,})px/g,
    extensions: [".css", ".html", ".htm"],
  },
];

function extensionOf(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index).toLowerCase();
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/** Run every rule over the project's source files. */
export function detectAntiPatterns(files: SourceFile[]): AntiPatternIssue[] {
  const issues: AntiPatternIssue[] = [];

  for (const file of files) {
    const extension = extensionOf(file.path);
    if (!CODE_EXTENSIONS.includes(extension)) continue;

    for (const rule of ANTI_PATTERN_RULES) {
      if (rule.extensions && !rule.extensions.includes(extension)) continue;

      let match: RegExpExecArray | null;
      rule.pattern.lastIndex = 0;
      while ((match = rule.pattern.exec(file.content)) !== null) {
        // Guard against zero-length matches looping forever.
        if (match[0].length === 0) {
          rule.pattern.lastIndex += 1;
          continue;
        }
        const start = match.index;
        const window = file.content.slice(
          Math.max(0, start - 0),
          start + Math.max(rule.requireNear?.chars ?? 0, rule.forbidNear?.chars ?? 0, match[0].length),
        );
        if (rule.requireNear && !rule.requireNear.pattern.test(window)) continue;
        if (rule.forbidNear && rule.forbidNear.pattern.test(window)) continue;

        issues.push({
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          detail: rule.detail,
          path: file.path,
          line: lineAt(file.content, start),
        });
        // One finding per rule per file keeps the list readable.
        break;
      }
    }
  }

  const weight: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort(
    (a, b) => weight[a.severity] - weight[b.severity] || a.path.localeCompare(b.path),
  );
}

export function countIssues(issues: AntiPatternIssue[]): {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
} {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const infos = issues.filter((issue) => issue.severity === "info").length;
  return { errors, warnings, infos, total: issues.length };
}

/** Composer prompt that asks the agent to clean up a selected finding set. */
export function issuesToPrompt(issues: AntiPatternIssue[]): string {
  if (issues.length === 0) return "";
  const lines = issues.map(
    (issue) => `- [${issue.severity}] ${issue.path}:${issue.line} — ${issue.title}. ${issue.detail}`,
  );
  return `Исправь проблемы, найденные статическим анализом:\n${lines.join("\n")}\n\nНичего другого не меняй.`;
}
