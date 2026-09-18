/**
 * Skill trends — pure helpers.
 *
 * Two questions this module answers:
 * 1. Platform level: which skills are popular this week (adoption share,
 *    week-over-week growth) — computed from anonymous counts, never from
 *    user-identifiable rows.
 * 2. Project level: which disabled skills look relevant to the user's current
 *    project files ("в твоём проекте 8 компонентов без тёмной темы — включить
 *    скилл dark-mode?").
 */

import type { Skill } from "./skills";

/** A per-skill usage count for one time window (from the Convex query). */
export interface SkillCount {
  skillId: string;
  enabled: number;
}

/** Raw platform data the trends aggregation consumes. */
export interface TrendsInput {
  currentWeek: SkillCount[];
  previousWeek: SkillCount[];
  /** Number of distinct users seen in the current window (denominator). */
  totalUsers: number;
}

export interface SkillTrend {
  skillId: string;
  /** Share of users with this skill on, 0..1, current week. */
  adoption: number;
  /** Adoption a week ago (0 when the skill is new). */
  previousAdoption: number;
  /** Growth in percentage points, current minus previous. */
  growth: number;
  /** Absolute user count with the skill enabled. */
  users: number;
}

const MIN_USERS_FOR_TREND = 3;

function countMap(rows: SkillCount[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.skillId === "string" && Number.isFinite(row.enabled)) {
      map.set(row.skillId, (map.get(row.skillId) ?? 0) + row.enabled);
    }
  }
  return map;
}

/** Aggregate platform-wide adoption and growth per skill. */
export function computeTrends(input: TrendsInput): SkillTrend[] {
  const current = countMap(input.currentWeek);
  const previous = countMap(input.previousWeek);
  const ids = new Set([...current.keys(), ...previous.keys()]);
  const total = Math.max(input.totalUsers, 1);

  const trends: SkillTrend[] = [];
  for (const skillId of ids) {
    const users = current.get(skillId) ?? 0;
    const before = previous.get(skillId) ?? 0;
    const adoption = users / total;
    const previousAdoption = before / total;
    trends.push({
      skillId,
      adoption,
      previousAdoption,
      growth: Math.round((adoption - previousAdoption) * 100),
      users,
    });
  }
  return trends.sort((a, b) => b.users - a.users || a.skillId.localeCompare(b.skillId));
}

/** The week's headline: e.g. "Неделя: 40% юзеров включили dark-mode". */
export function formatTopTrend(
  trends: SkillTrend[],
  skillName: (id: string) => string,
): string | null {
  const top = trends.find((trend) => trend.users >= MIN_USERS_FOR_TREND);
  if (!top) return null;
  const percent = Math.round(top.adoption * 100);
  return `Неделя: ${percent}% юзеров включили скилл «${skillName(top.skillId)}»`;
}

/** Rising skills worth a look, biggest growth first. */
export function risingSkills(trends: SkillTrend[], limit = 3): SkillTrend[] {
  return trends
    .filter((trend) => trend.users >= MIN_USERS_FOR_TREND && trend.growth > 0)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, limit);
}

/** Human label for growth, e.g. "+300%". */
export function formatGrowth(growth: number): string {
  if (growth > 0) return `+${growth}%`;
  return `${growth}%`;
}

/* --------------------- project → skill suggestions ----------------------- */

/** Minimal project file shape (path + content) for signal detection. */
export interface ProjectSignalFile {
  path: string;
  content: string;
}

export interface SkillSuggestion {
  skillId: string;
  /** Why the skill looks relevant, shown in the UI. */
  reason: string;
  /** Strength: how strongly the project signals the need. */
  score: number;
}

interface SignalRule {
  /** BUILT_IN_SKILLS id the rule maps to. */
  skillId: string;
  /** Runs against the concatenated project sources. */
  test: (code: string, files: ProjectSignalFile[]) => boolean;
  /** Builds the reason shown to the user. */
  reason: (files: ProjectSignalFile[]) => string;
  score: number;
}

const countMatches = (code: string, re: RegExp): number => (code.match(re) ?? []).length;

const SIGNAL_RULES: SignalRule[] = [
  {
    skillId: "mobile-first",
    test: (code) =>
      countMatches(code, /@media[^{]*min-width/g) === 0 &&
      countMatches(code, /max-width:\s*\d{3,4}px/g) > 2,
    reason: (files) =>
      `в ${files.filter((f) => /max-width:\s*\d{3,4}px/.test(f.content)).length} файлах только desktop-брейкпоинты`,
    score: 2,
  },
  {
    skillId: "a11y",
    test: (code) => {
      const imgs = countMatches(code, /<img(?![^>]*\balt=)[^>]*>/g);
      const iconButtons = countMatches(code, /<button[^>]*>\s*<(i|svg|[A-Z]\w*Icon)/g);
      return imgs > 0 || iconButtons > 1;
    },
    reason: (files) => {
      const imgs = files.filter((f) => /<img(?![^>]*\balt=)[^>]*>/.test(f.content)).length;
      return imgs > 0
        ? `в ${imgs} файлах картинки без alt`
        : "иконки-кнопки без aria-label";
    },
    score: 2,
  },
  {
    skillId: "forms-ux",
    test: (code) =>
      countMatches(code, /<form[\s>]/g) > 0 &&
      countMatches(code, /disabled=\{[^}]*(sending|loading|submitting)/i) === 0,
    reason: () => "форма отправляется без блокировки двойной отправки",
    score: 3,
  },
  {
    skillId: "chart-pack",
    test: (code) =>
      countMatches(code, /(dashboard|график|chart|аналитик)/i) > 2 &&
      countMatches(code, /<svg/g) === 0,
    reason: () => "дашборд/графики упоминаются, но SVG-графиков нет",
    score: 2,
  },
  {
    skillId: "deepseek-perf",
    test: (code) => countMatches(code, /\.map\(/g) > 4,
    reason: (files) =>
      `много списков (.map() в ${files.filter((f) => f.content.includes(".map(")).length} файлах) — стоит добавить ленивый рендер`,
    score: 1,
  },
  {
    skillId: "ru-commerce",
    test: (code) =>
      /(корзин|заказ|цена|товар|доставк)/i.test(code) &&
      !/₽/.test(code) &&
      !/ИНН/.test(code),
    reason: () => "магазин есть, а рублей и ИНН-валидации нет",
    score: 3,
  },
];

/**
 * Which disabled built-in skills look relevant to the project's files.
 * `enabledIds` are excluded — suggestions never repeat what is already on.
 */
export function suggestSkills(
  files: ProjectSignalFile[],
  enabledIds: Set<string>,
  knownSkills: Skill[],
): SkillSuggestion[] {
  const code = files.map((file) => file.content).join("\n");
  if (!code.trim()) return [];
  const known = new Set(knownSkills.map((skill) => skill.id));
  const suggestions: SkillSuggestion[] = [];
  for (const rule of SIGNAL_RULES) {
    if (enabledIds.has(rule.skillId) || !known.has(rule.skillId)) continue;
    if (rule.test(code, files)) {
      suggestions.push({
        skillId: rule.skillId,
        reason: rule.reason(files),
        score: rule.score,
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
}
