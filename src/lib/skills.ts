/**
 * Skills — installable capability modules for the RBuilder agent.
 *
 * A skill is a prompt module (instructions + optional constraints) that gets
 * injected into the agent pipeline when enabled. Skills can come from any
 * model vendor — they are vendor-neutral building blocks.
 *
 * `compatibleModels` lists model catalog ids the skill is tuned for; the UI
 * shows a hint when the active model is not in the list. Empty array = works
 * with every model.
 */

export type SkillCategory = "design" | "code" | "data" | "integration" | "quality";

export interface Skill {
  id: string;
  name: string;
  /** Model/origin the skill is attributed to, e.g. "GPT", "Claude", "DeepSeek", "RBuilder". */
  source: string;
  category: SkillCategory;
  desc: string;
  /** Prompt module injected into the builder/reviewer when the skill is enabled. */
  prompt: string;
  /** Model catalog ids the skill is tuned for; [] = universal. */
  compatibleModels: string[];
  /** Built-in skills cannot be deleted (only toggled). */
  builtIn: boolean;
}

export const SKILL_CATEGORIES: { id: SkillCategory; label: string }[] = [
  { id: "design", label: "Дизайн" },
  { id: "code", label: "Код" },
  { id: "data", label: "Данные" },
  { id: "integration", label: "Интеграции" },
  { id: "quality", label: "Качество" },
];

export const BUILT_IN_SKILLS: Skill[] = [
  {
    id: "minimal-design",
    name: "Минималистичный дизайн",
    source: "RBuilder",
    category: "design",
    desc: "Сдержанная типографика, воздух, монохром с одним акцентом",
    prompt:
      "DESIGN SKILL (minimal design): use restrained typography with a clear scale, generous whitespace, near-monochrome palette with exactly one accent color, hairline borders, subtle hover states. No decorative gradients, no heavy shadows.",
    compatibleModels: [],
    builtIn: true,
  },
  {
    id: "mobile-first",
    name: "Mobile-first",
    source: "RBuilder",
    category: "design",
    desc: "Раскладка от узких экранов, крупные цели нажатия",
    prompt:
      "DESIGN SKILL (mobile-first): start layouts from the narrow viewport, use fluid grids, ≥44px touch targets, stacked cards on mobile with responsive multi-column on desktop. Test the layout mentally at 375px and 1440px.",
    compatibleModels: [],
    builtIn: true,
  },
  {
    id: "clean-code",
    name: "Чистый код",
    source: "Claude",
    category: "code",
    desc: "Понятные имена,small функции, никаких заглушек",
    prompt:
      "CODE SKILL (clean code): use descriptive names, small pure functions, group JS in clearly labeled sections, never leave stubs or TODO comments — every handler must be fully implemented.",
    compatibleModels: [],
    builtIn: true,
  },
  {
    id: "deepseek-perf",
    name: "Оптимизация производительности",
    source: "DeepSeek",
    category: "code",
    desc: "Дебаунс, ленивые списки, переиспользование DOM",
    prompt:
      "CODE SKILL (performance): debounce input handlers (200ms), render long lists lazily or with pagination, avoid layout thrashing (batch DOM reads/writes), prefer event delegation for repeated items, use requestAnimationFrame for animations.",
    compatibleModels: ["deepseek-chat", "deepseek-reasoner", "glm-4-flash", "glm-4-plus"],
    builtIn: true,
  },
  {
    id: "chart-pack",
    name: "Графики и дашборды",
    source: "GPT",
    category: "data",
    desc: "SVG-графики без библиотек, оси, тултипы",
    prompt:
      "DATA SKILL (charts): build charts as inline SVG without external libraries. Include axes with tick labels, gridlines, tooltips on hover, and a legend. Use the app's palette; make charts responsive via viewBox.",
    compatibleModels: ["gpt-4o", "gpt-4o-mini"],
    builtIn: true,
  },
  {
    id: "forms-ux",
    name: "Формы и валидация",
    source: "GPT",
    category: "quality",
    desc: "Инлайн-ошибки, состояния загрузки, блокировка двойной отправки",
    prompt:
      "QUALITY SKILL (forms UX): validate fields inline on blur with specific error messages, disable the submit button while a request is in flight with a visible loading state, prevent double submission, confirm destructive actions.",
    compatibleModels: [],
    builtIn: true,
  },
  {
    id: "a11y",
    name: "Доступность",
    source: "Mistral",
    category: "quality",
    desc: "Семантика, aria-атрибуты, контраст, клавиатура",
    prompt:
      "QUALITY SKILL (accessibility): use semantic HTML (nav, main, button), label all form controls, add aria-labels to icon buttons, keep contrast ≥4.5:1, ensure full keyboard operability with visible focus states.",
    compatibleModels: [],
    builtIn: true,
  },
  {
    id: "ru-commerce",
    name: "Ру-коммерce паттерны",
    source: "RBuilder",
    category: "integration",
    desc: "Цены в рублях, СДЭК/ЮKassa-паттерны, ИНН-валидация",
    prompt:
      "INTEGRATION SKILL (RU commerce): format prices as «12 900 ₽» with non-breaking spaces, include delivery options (Курьер/ПВЗ СДЭК/Boxberry), validate ИНН (10 or 12 digits with checksum), phone format +7 (___) ___-__-__, mock payment flow in ЮKassa style (hold/capture statuses).",
    compatibleModels: [],
    builtIn: true,
  },
];

export const CUSTOM_SKILLS_DOC_URL = "https://rbuilder.dev/skills";

/** Parse a user-provided skill definition: first line = name, rest = prompt. */
export function parseCustomSkill(text: string): { name: string; prompt: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [firstLine, ...rest] = trimmed.split("\n");
  const name = firstLine.trim().slice(0, 60);
  const prompt = rest.join("\n").trim() || firstLine.trim();
  if (!name || !prompt) return null;
  return { name, prompt };
}

export function findSkill(
  skills: Skill[],
  id: string,
): Skill | undefined {
  return skills.find((skill) => skill.id === id);
}
