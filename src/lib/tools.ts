/**
 * Tools — the agent tool belt.
 *
 * Directly modelled on the tool set the Freebuff/Codebuff agent runtime ships
 * (`common/src/tools/` + the agent roster in `agents/`): file tools, search,
 * terminal, browser automation, web research, the multi-agent roster and the
 * delivery tools. Every entry keeps the upstream tool name so the mapping back
 * to the runtime is obvious.
 *
 * A tool is *enabled per user* and does two things:
 *  1. its `directive` is appended to the builder + reviewer instructions, and
 *  2. tools with an `effect` change the pipeline itself (skip a stage).
 *
 * Tools born in RBuilder (persistence, RU-UX, …) are marked `origin: "rbuilder"`
 * so it stays clear what was ported and what is native.
 */

export type ToolGroupId =
  | "files"
  | "search"
  | "terminal"
  | "browser"
  | "web"
  | "agents"
  | "delivery"
  | "app";

export interface ToolGroup {
  id: ToolGroupId;
  label: string;
  hint: string;
}

export const TOOL_GROUPS: ToolGroup[] = [
  { id: "files", label: "Файлы", hint: "Чтение и запись кода" },
  { id: "search", label: "Поиск", hint: "Навигация по проекту" },
  { id: "terminal", label: "Терминал", hint: "Проверки и команды" },
  { id: "browser", label: "Браузер", hint: "Автопроверка результата" },
  { id: "web", label: "Веб", hint: "Внешние данные и источники" },
  { id: "agents", label: "Агенты", hint: "Роли конвейера" },
  { id: "delivery", label: "Выпуск", hint: "Интеграции и публикация" },
  { id: "app", label: "Приложение", hint: "Возможности самого билда" },
];

/** Which runtime a tool came from. */
export type ToolOrigin = "freebuff" | "rbuilder";

export interface ToolDef {
  id: string;
  name: string;
  group: ToolGroupId;
  origin: ToolOrigin;
  desc: string;
  /** Instruction appended to the builder/reviewer prompts when enabled. */
  directive: string;
  /** On for a user who never opened the Tools tab. */
  defaultEnabled: boolean;
  /** Tools that change the pipeline itself rather than just its instructions. */
  effect?: "plan" | "review";
}

export const TOOLS: ToolDef[] = [
  /* --------------------------------- files -------------------------------- */
  {
    id: "read_files",
    name: "read_files",
    group: "files",
    origin: "freebuff",
    desc: "Читает вложения и текущую версию кода целиком",
    directive:
      "TOOL read_files: read every attached file and the current app version in full before planning. Never assume a file's contents or structure.",
    defaultEnabled: true,
  },
  {
    id: "write_file",
    name: "write_file",
    group: "files",
    origin: "freebuff",
    desc: "Отдаёт полный файл целиком, без фрагментов",
    directive:
      "TOOL write_file: always return one complete, self-contained file. Never emit placeholders like '… rest unchanged' or partial fragments.",
    defaultEnabled: true,
  },
  {
    id: "str_replace",
    name: "str_replace",
    group: "files",
    origin: "freebuff",
    desc: "Меняет только нужные участки, остальное сохраняет",
    directive:
      "TOOL str_replace: when a previous version exists, change only what the request requires and keep every untouched section, class name and asset identical.",
    defaultEnabled: true,
  },
  {
    id: "find_files",
    name: "find_files",
    group: "files",
    origin: "freebuff",
    desc: "Перечисляет маршруты/экраны до начала сборки",
    directive:
      "TOOL find_files: enumerate the app's screens, sections and shared assets up front, then keep that naming consistent throughout the document.",
    defaultEnabled: true,
  },
  {
    id: "list_directory",
    name: "list_directory",
    group: "files",
    origin: "freebuff",
    desc: "Инвентаризация содержимого каталога",
    directive:
      "TOOL list_directory: start from a short inventory of what already exists in the app before adding anything new.",
    defaultEnabled: false,
  },

  /* -------------------------------- search -------------------------------- */
  {
    id: "code_search",
    name: "code_search",
    group: "search",
    origin: "freebuff",
    desc: "Переиспользует уже существующие имена и ключи",
    directive:
      "TOOL code_search: reuse identifiers, CSS class names and data keys that already exist in the current version instead of inventing near-duplicates.",
    defaultEnabled: true,
  },
  {
    id: "file_picker",
    name: "file_picker",
    group: "search",
    origin: "freebuff",
    desc: "Агент file-picker: какие экраны затрагивает запрос",
    directive:
      "TOOL file_picker: before implementing, state which screens and components the request touches and which stay untouched.",
    defaultEnabled: true,
  },

  /* ------------------------------- terminal ------------------------------- */
  {
    id: "run_terminal_command",
    name: "run_terminal_command",
    group: "terminal",
    origin: "freebuff",
    desc: "Прогоняет результат как проверку перед выдачей",
    directive:
      "TOOL run_terminal_command: before returning, trace the script by hand — every referenced function, element id and event handler must exist and be wired.",
    defaultEnabled: false,
  },
  {
    id: "basher",
    name: "basher",
    group: "terminal",
    origin: "freebuff",
    desc: "Агент basher: жёсткая проверка ошибок выполнения",
    directive:
      "TOOL basher: treat the build as if a shell run had failed on the first console error. Fix it before returning anything.",
    defaultEnabled: false,
  },

  /* -------------------------------- browser -------------------------------- */
  {
    id: "browser_navigate",
    name: "browser_navigate",
    group: "browser",
    origin: "freebuff",
    desc: "Открывает результат на узком и широком экране",
    directive:
      "TOOL browser_navigate: verify the layout renders correctly at 375px and at 1440px, with no horizontal overflow at either width.",
    defaultEnabled: false,
  },
  {
    id: "browser_screenshot",
    name: "browser_screenshot",
    group: "browser",
    origin: "freebuff",
    desc: "Проверяет первый экран: заголовок, действие, воздух",
    directive:
      "TOOL browser_screenshot: make the first viewport present a clear heading, one primary call to action and generous whitespace.",
    defaultEnabled: false,
  },
  {
    id: "browser_click",
    name: "browser_click",
    group: "browser",
    origin: "freebuff",
    desc: "Проверяет, что каждый элемент управления работает",
    directive:
      "TOOL browser_click: every button, tab, filter and row action must actually respond. No dead controls, no handlers that only log.",
    defaultEnabled: false,
  },
  {
    id: "browser_evaluate",
    name: "browser_evaluate",
    group: "browser",
    origin: "freebuff",
    desc: "Проверяет консоль на ошибки",
    directive:
      "TOOL browser_evaluate: run the JavaScript mentally and confirm zero console errors on load and after the first interaction.",
    defaultEnabled: false,
  },

  /* ---------------------------------- web --------------------------------- */
  {
    id: "web_search",
    name: "web_search",
    group: "web",
    origin: "freebuff",
    desc: "Реальный поиск источников: конвейер добавляет этап исследования",
    directive:
      "TOOL web_search: the attached research notes come from a real web search — use those names, prices and facts in the app instead of inventing them, and keep them internally consistent.",
    defaultEnabled: false,
  },
  {
    id: "read_url",
    name: "read_url",
    group: "web",
    origin: "freebuff",
    desc: "Дочитывает страницы источников целиком (глубже, но медленнее)",
    directive:
      "TOOL read_url: mirror the information architecture of established products in this domain — the sections users already expect to find.",
    defaultEnabled: false,
  },

  /* -------------------------------- agents -------------------------------- */
  {
    id: "thinker",
    name: "thinker",
    group: "agents",
    origin: "freebuff",
    desc: "Этап планирования: сначала план, потом код",
    directive:
      "TOOL thinker: plan before writing. The plan in the trace must match what you actually build.",
    defaultEnabled: true,
    effect: "plan",
  },
  {
    id: "context_pruner",
    name: "context_pruner",
    group: "agents",
    origin: "freebuff",
    desc: "Агент context-pruner: без дублей в документе",
    directive:
      "TOOL context_pruner: keep the document lean — no duplicated CSS rules, no unused classes, no repeated markup blocks.",
    defaultEnabled: true,
  },
  {
    id: "editor_best_of_n",
    name: "editor_best_of_n",
    group: "agents",
    origin: "freebuff",
    desc: "Агент editor: выбирает лучший из вариантов",
    directive:
      "TOOL editor_best_of_n: internally consider two or three approaches for the hardest screen and implement the strongest one, not the first that comes to mind.",
    defaultEnabled: false,
  },
  {
    id: "reviewer",
    name: "reviewer",
    group: "agents",
    origin: "freebuff",
    desc: "Этап ревью: самопроверка и один ремонт",
    directive:
      "TOOL reviewer: self-review the result against the plan and repair any gap once before returning.",
    defaultEnabled: true,
    effect: "review",
  },
  {
    id: "knowledge",
    name: "knowledge",
    group: "agents",
    origin: "freebuff",
    desc: "Опорные файлы проекта (knowledge.md)",
    directive:
      "TOOL knowledge: honour the attached project files and the established decisions of this project above your own defaults.",
    defaultEnabled: true,
  },

  /* ------------------------------- delivery ------------------------------- */
  {
    id: "gravity_index",
    name: "gravity_index",
    group: "delivery",
    origin: "freebuff",
    desc: "Подбор сервисов под задачу (оплата, доставка, CRM)",
    directive:
      "TOOL gravity_index: when the app needs a third party (оплата, доставка, CRM, SMS, хранилище), model it against the connected service catalog — ЮKassa, Т-Банк, СДЭК, Битрикс24, DaData — with the correct fields and statuses.",
    defaultEnabled: false,
  },
  {
    id: "render_ui",
    name: "render_ui",
    group: "delivery",
    origin: "freebuff",
    desc: "Интерактивные виджеты внутри результата",
    directive:
      "TOOL render_ui: where an inline interactive widget communicates better than text (a picker, a stepper, a preview card), build the widget instead of describing it.",
    defaultEnabled: false,
  },
  {
    id: "deploy",
    name: "deploy",
    group: "delivery",
    origin: "freebuff",
    desc: "Результат готов к публикации",
    directive:
      "TOOL deploy: produce a publish-ready file — no localhost URLs, no dev banners, no debug output left in the markup.",
    defaultEnabled: false,
  },

  /* ---------------------------------- app --------------------------------- */
  {
    id: "persistence",
    name: "persistence",
    group: "app",
    origin: "rbuilder",
    desc: "Состояние сохраняется между перезагрузками",
    directive:
      "TOOL persistence: persist user state in localStorage (with a safe guard for sandboxed environments) so data survives a reload.",
    defaultEnabled: true,
  },
  {
    id: "ru_ux",
    name: "ru_ux",
    group: "app",
    origin: "rbuilder",
    desc: "Русская копия, ₽, +7, ИНН",
    directive:
      "TOOL ru_ux: all interface copy in Russian, prices as «12 900 ₽» with non-breaking spaces, phones as +7 (___) ___-__-__, and ИНН validation (10 or 12 digits with checksum) where a legal entity is entered.",
    defaultEnabled: true,
  },
  {
    id: "dark_mode",
    name: "dark_mode",
    group: "app",
    origin: "rbuilder",
    desc: "Тёмная тема с переключателем",
    directive:
      "TOOL dark_mode: ship both a light and a dark palette driven by CSS custom properties, with a visible theme toggle that remembers the choice.",
    defaultEnabled: false,
  },
  {
    id: "offline",
    name: "offline",
    group: "app",
    origin: "rbuilder",
    desc: "Работает без сети",
    directive:
      "TOOL offline: the app must keep working with no network — no runtime dependency on remote APIs, all data bundled inline.",
    defaultEnabled: false,
  },
];

export function findTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** Ids enabled by default (used when the pipeline gets no explicit list). */
export function defaultEnabledToolIds(): string[] {
  return TOOLS.filter((t) => t.defaultEnabled).map((t) => t.id);
}

/**
 * Merge stored per-user rows over the defaults. A tool without a row keeps its
 * default state, so a brand-new account gets a sensible belt immediately.
 */
export function resolveEnabledTools(
  rows: { toolId: string; enabled: boolean }[],
): string[] {
  const state = new Map(TOOLS.map((t) => [t.id, t.defaultEnabled] as const));
  for (const row of rows) {
    if (state.has(row.toolId)) state.set(row.toolId, row.enabled);
  }
  return TOOLS.filter((t) => state.get(t.id)).map((t) => t.id);
}

export function hasTool(ids: string[], id: string): boolean {
  return ids.includes(id);
}

/** Directives for the enabled tools, in catalog order. */
export function toolDirectives(ids: string[]): string[] {
  const enabled = new Set(ids);
  return TOOLS.filter((t) => enabled.has(t.id)).map((t) => t.directive);
}
