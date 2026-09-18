/**
 * Global snapshots ("recipes") — pure helpers.
 *
 * A snapshot captures the full state of a user's RBuilder environment:
 * skills, tools, architecture and rules from the workspace — everything the
 * pipeline reads before writing code. Recipes are snapshots published for
 * everyone. Deploying one clones that configuration into your own account,
 * like dotfiles for the app generator.
 *
 * Secrets (integration credentials, API keys) are deliberately excluded:
 * a recipe must never carry another user's tokens.
 */

export const SNAPSHOT_FORMAT_VERSION = 1;

/** The workspace fields a snapshot restores. */
export interface SnapshotWorkspace {
  architectureId?: string;
  rules?: string;
}

export interface SnapshotSkill {
  /** Built-in id (lib/skills.ts) or a custom id (`custom-…`). */
  skillId: string;
  enabled: boolean;
  /** Present for custom (vendor-neutral prompt modules) skills. */
  custom?: {
    name: string;
    desc: string;
    prompt: string;
    category: "design" | "code" | "data" | "integration" | "quality";
    source?: string;
    compatibleModels?: string[];
  };
}

export interface SnapshotTool {
  toolId: string;
  enabled: boolean;
}

export interface SnapshotRecipe {
  formatVersion: number;
  name: string;
  description?: string;
  createdAt: number;
  workspace: SnapshotWorkspace;
  skills: SnapshotSkill[];
  tools: SnapshotTool[];
}

/** Raw row as stored in Convex — may miss optional fields (old snapshots). */
export type RawSnapshot = Partial<Omit<SnapshotRecipe, "formatVersion" | "name">> & {
  formatVersion?: number;
  name?: string;
};

const MAX_NAME_CHARS = 80;
const MAX_DESC_CHARS = 400;
const MAX_RULES_CHARS = 10_000;
const MAX_ITEMS = 100;

function sanitizeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Build a normalised recipe from untrusted input (DB row or imported JSON).
 * Unknown/oversized content is dropped, never trusted.
 */
export function buildRecipe(
  raw: RawSnapshot,
  fallbackName: string,
): SnapshotRecipe {
  const name = sanitizeText(raw.name, MAX_NAME_CHARS) || sanitizeText(fallbackName, MAX_NAME_CHARS) || "Снапшот";
  const skills = Array.isArray(raw.skills) ? raw.skills.slice(0, MAX_ITEMS) : [];
  const tools = Array.isArray(raw.tools) ? raw.tools.slice(0, MAX_ITEMS) : [];
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    name,
    description: sanitizeText(raw.description, MAX_DESC_CHARS) || undefined,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    workspace: {
      architectureId:
        sanitizeText(raw.workspace?.architectureId, 100) || undefined,
      rules: sanitizeText(raw.workspace?.rules, MAX_RULES_CHARS) || undefined,
    },
    skills: skills
      .filter((s): s is SnapshotSkill => Boolean(s && typeof s.skillId === "string" && s.skillId.length > 0 && s.skillId.length <= 200))
      .map((s) => ({
        skillId: s.skillId,
        enabled: s.enabled === true,
        ...(s.custom &&
        typeof s.custom.name === "string" &&
        typeof s.custom.prompt === "string" &&
        s.custom.prompt.length > 0
          ? {
              custom: {
                name: sanitizeText(s.custom.name, 100),
                desc: sanitizeText(s.custom.desc, 300),
                prompt: s.custom.prompt.slice(0, MAX_RULES_CHARS),
                category: (
                  ["design", "code", "data", "integration", "quality"] as const
                ).includes(s.custom.category)
                  ? s.custom.category
                  : "code",
                ...(typeof s.custom.source === "string"
                  ? { source: sanitizeText(s.custom.source, 100) }
                  : {}),
                ...(Array.isArray(s.custom.compatibleModels)
                  ? {
                      compatibleModels: s.custom.compatibleModels
                        .filter((m) => typeof m === "string")
                        .slice(0, 20),
                    }
                  : {}),
              },
            }
          : {}),
      })),
    tools: tools
      .filter((t): t is SnapshotTool => Boolean(t && typeof t.toolId === "string" && t.toolId.length > 0 && t.toolId.length <= 100))
      .map((t) => ({ toolId: t.toolId, enabled: t.enabled === true })),
  };
}

/** Serialize to a portable JSON string (file export / clipboard). */
export function serializeRecipe(recipe: SnapshotRecipe): string {
  return JSON.stringify(recipe, null, 2);
}

/** Result of parsing an exported recipe file. */
export type ParseRecipeResult =
  | { ok: true; recipe: SnapshotRecipe }
  | { ok: false; error: string };

/** Parse a previously exported recipe. Tolerant, never throws. */
export function parseRecipe(text: string): ParseRecipeResult {
  if (!text.trim()) return { ok: false, error: "Файл пуст" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Файл не является корректным JSON" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Ожидается JSON-объект рецепта" };
  }
  const raw = data as RawSnapshot;
  if (typeof raw.formatVersion === "number" && raw.formatVersion > SNAPSHOT_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Рецепт из новой версии RBuilder (${raw.formatVersion}). Обновите приложение.`,
    };
  }
  const recipe = buildRecipe(raw, "Импортированный рецепт");
  if (recipe.skills.length === 0 && recipe.tools.length === 0 && !recipe.workspace.rules && !recipe.workspace.architectureId) {
    return { ok: false, error: "В рецепте нет настроек — нечего разворачивать" };
  }
  return { ok: true, recipe };
}

/** One-line human summary, e.g. "4 навыка · 6 инструментов · архитектура". */
export function recipeSummary(recipe: SnapshotRecipe): string {
  const parts: string[] = [];
  const customCount = recipe.skills.filter((s) => s.custom).length;
  const enabledCount = recipe.skills.filter((s) => s.enabled).length;
  if (recipe.skills.length > 0) {
    parts.push(
      `${recipe.skills.length} навыков${customCount > 0 ? ` (${customCount} своих)` : ""} · вкл ${enabledCount}`,
    );
  }
  if (recipe.tools.length > 0) {
    parts.push(`${recipe.tools.length} инструментов`);
  }
  if (recipe.workspace.architectureId) parts.push("архитектура");
  if (recipe.workspace.rules) parts.push("правила");
  return parts.length > 0 ? parts.join(" · ") : "пустой снапшот";
}

/** Validate user-supplied name/description before creating a snapshot. */
export function validateSnapshotMeta(
  name: string,
  description: string,
): string | null {
  if (!name.trim()) return "Введите название снапшота";
  if (name.trim().length > MAX_NAME_CHARS) {
    return `Название длиннее ${MAX_NAME_CHARS} символов`;
  }
  if (description.trim().length > MAX_DESC_CHARS) {
    return `Описание длиннее ${MAX_DESC_CHARS} символов`;
  }
  return null;
}
