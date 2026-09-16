import { describe, expect, test } from "bun:test";
import { MODELS, getModel, DEFAULT_MODEL_ID, DAILY_SESSION_LIMIT } from "./models";
import { BUILT_IN_SKILLS, parseCustomSkill, SKILL_CATEGORIES } from "./skills";
import { STARTER_TEMPLATES } from "./templates";
import { CAPABILITIES } from "./capabilities";
import { RU_SERVICES, SERVICE_CATEGORIES, findService } from "./ru-services";
import { THEMES } from "./theme";
import {
  ARCHITECTURES,
  DEFAULT_ARCHITECTURE_ID,
  architectureContract,
  getArchitecture,
} from "./architecture";
import {
  KEYLESS_LABEL,
  MAX_RESEARCH_QUERY,
  SEARCH_PROVIDERS,
  buildResearchQuery,
  formatResearch,
  isFetchableUrl,
  pickProvider,
  stripHtml,
} from "./research";
import { SNIPPETS, SNIPPET_CATEGORIES } from "./snippets";
import { PROMPT_PRESETS } from "./prompt-presets";
import {
  getDesktopRuntime,
  isDesktopRuntime,
  DESKTOP_COMMANDS,
} from "./desktop-bridge";
import {
  TOOLS,
  TOOL_GROUPS,
  defaultEnabledToolIds,
  findTool,
  hasTool,
  resolveEnabledTools,
  toolDirectives,
} from "./tools";

/* --------------------------------- models -------------------------------- */

describe("models catalog", () => {
  test("has a non-empty catalog with unique ids", () => {
    expect(MODELS.length).toBeGreaterThan(0);
    const ids = new Set(MODELS.map((m) => m.id));
    expect(ids.size).toBe(MODELS.length);
  });

  test("default model id points at a real model", () => {
    expect(MODELS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true);
  });

  test("getModel falls back to the first model on unknown id", () => {
    const fallback = getModel("no-such-model");
    expect(fallback.id).toBe(MODELS[0].id);
    expect(getModel(undefined).id).toBe(MODELS[0].id);
    expect(getModel(null).id).toBe(MODELS[0].id);
  });

  test("getModel returns the requested model when it exists", () => {
    const model = getModel("gpt-5.6-luna");
    expect(model.name).toBe("GPT-5.6 Luna");
  });

  test("session-based models declare costsSession consistently", () => {
    for (const model of MODELS) {
      if (model.access === "full") {
        expect(model.costsSession).toBe(true);
      }
      if (model.costsSession) {
        expect(model.dataNotice).toBeTruthy();
      }
    }
  });

  test("session limit is 6 per day", () => {
    expect(DAILY_SESSION_LIMIT).toBe(6);
  });
});

/* --------------------------------- skills -------------------------------- */

describe("skills", () => {
  test("built-in skills are complete and unique", () => {
    const ids = new Set(BUILT_IN_SKILLS.map((s) => s.id));
    expect(ids.size).toBe(BUILT_IN_SKILLS.length);
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.prompt.length).toBeGreaterThan(20);
      expect(skill.builtIn).toBe(true);
    }
  });

  test("every built-in skill has a valid category", () => {
    const categoryIds = new Set(SKILL_CATEGORIES.map((c) => c.id));
    for (const skill of BUILT_IN_SKILLS) {
      expect(categoryIds.has(skill.category)).toBe(true);
    }
  });

  test("parseCustomSkill splits first line as name", () => {
    const parsed = parseCustomSkill("Всегда тёмная тема\nUSE_DARK_THEME: rule 1\nrule 2");
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Всегда тёмная тема");
    expect(parsed!.prompt).toContain("rule 1");
    expect(parsed!.prompt).toContain("rule 2");
  });

  test("parseCustomSkill falls back to the whole text when there is no body", () => {
    const parsed = parseCustomSkill("Только название");
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Только название");
    expect(parsed!.prompt).toBe("Только название");
  });

  test("parseCustomSkill trims whitespace and rejects empty input", () => {
    expect(parseCustomSkill("   ")).toBeNull();
    expect(parseCustomSkill("")).toBeNull();
    const padded = parseCustomSkill("  Имя  \n\n  Тело  ");
    expect(padded!.name).toBe("Имя");
    expect(padded!.prompt).toBe("Тело");
  });

  test("parseCustomSkill caps the name length", () => {
    const parsed = parseCustomSkill(`${"x".repeat(100)}\nbody`);
    expect(parsed!.name.length).toBeLessThanOrEqual(60);
  });
});

/* ------------------------------- templates ------------------------------- */

describe("starter templates", () => {
  test("have unique ids and valid capabilities", () => {
    const ids = new Set(STARTER_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(STARTER_TEMPLATES.length);
    const capabilityIds = new Set(CAPABILITIES.map((c) => c.id));
    for (const template of STARTER_TEMPLATES) {
      expect(capabilityIds.has(template.capability)).toBe(true);
      expect(template.prompt.length).toBeGreaterThan(30);
    }
  });
});

/* ------------------------------ capabilities ------------------------------ */

describe("capabilities", () => {
  test("starters are prompt prefixes ending with a colon", () => {
    for (const capability of CAPABILITIES) {
      expect(capability.starter.trim().endsWith(":")).toBe(true);
    }
  });
});

/* -------------------------------- themes --------------------------------- */

describe("themes", () => {
  test("catalog has unique ids with labels and hints", () => {
    const ids = new Set(THEMES.map((t) => t.id));
    expect(ids.size).toBe(THEMES.length);
    for (const theme of THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.hint.length).toBeGreaterThan(0);
    }
  });

  test("all four themes are present, including Tomorrow Dark Blue", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "light",
      "dark",
      "tomorrow",
      "tomorrow-dark",
    ]);
    const darkBlue = THEMES.find((t) => t.id === "tomorrow-dark");
    expect(darkBlue!.label).toBe("Tomorrow Dark Blue");
  });
});

/* ---------------------------- architectures ----------------------------- */

describe("architecture catalog", () => {
  test("has unique profiles with complete stack fields", () => {
    const ids = new Set(ARCHITECTURES.map((profile) => profile.id));
    expect(ids.size).toBe(ARCHITECTURES.length);
    for (const profile of ARCHITECTURES) {
      expect(profile.name.length).toBeGreaterThan(0);
      expect(profile.frontend.length).toBeGreaterThan(0);
      expect(profile.backend.length).toBeGreaterThan(0);
      expect(profile.database.length).toBeGreaterThan(0);
      expect(profile.auth.length).toBeGreaterThan(0);
      expect(profile.constraints.length).toBeGreaterThan(0);
    }
  });

  test("falls back safely and produces an architecture contract", () => {
    expect(getArchitecture("unknown").id).toBe(DEFAULT_ARCHITECTURE_ID);
    const contract = architectureContract("crm-russia");
    expect(contract).toContain("ARCHITECTURE: Российская CRM");
    expect(contract).toContain("Convex actions + webhooks");
  });
});

/* ---------------------------- snippets/presets --------------------------- */

describe("snippets and prompt presets", () => {
  test("snippets have unique ids and usable prompts", () => {
    const ids = new Set(SNIPPETS.map((snippet) => snippet.id));
    expect(ids.size).toBe(SNIPPETS.length);
    const categories = new Set(SNIPPET_CATEGORIES.map((category) => category.id));
    for (const snippet of SNIPPETS) {
      expect(categories.has(snippet.category)).toBe(true);
      expect(snippet.prompt.length).toBeGreaterThan(30);
      expect(snippet.files.length).toBeGreaterThan(0);
    }
  });

  test("presets have unique ids and non-empty requirements", () => {
    const ids = new Set(PROMPT_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(PROMPT_PRESETS.length);
    for (const preset of PROMPT_PRESETS) {
      expect(preset.prompt.length).toBeGreaterThan(40);
    }
  });
});

/* ---------------------------- desktop bridge ---------------------------- */

describe("desktop bridge", () => {
  test("falls back safely in the browser and exposes an allow-listed contract", () => {
    const runtime = getDesktopRuntime();
    expect(runtime.available).toBe(false);
    expect(isDesktopRuntime(runtime)).toBe(false);
    expect(Object.values(DESKTOP_COMMANDS)).toEqual([
      "workspace_pick",
      "workspace_list_files",
      "workspace_read_file",
      "workspace_write_file",
      "git_status",
      "git_diff",
      "git_commit",
      "git_branches",
      "git_checkout",
      "git_create_branch",
      "git_pull",
      "git_push",
      "git_stash",
      "terminal_run",
      "preview_start",
    ]);
  });
});

/* ---------------------------------- tools -------------------------------- */

describe("agent tools", () => {
  test("catalog has unique ids, names and complete directives", () => {
    const ids = new Set(TOOLS.map((t) => t.id));
    expect(ids.size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.desc.length).toBeGreaterThan(0);
      expect(tool.directive.startsWith("TOOL ")).toBe(true);
      expect(tool.directive.length).toBeGreaterThan(40);
    }
  });

  test("every tool belongs to a declared group", () => {
    const groupIds = new Set(TOOL_GROUPS.map((g) => g.id));
    for (const tool of TOOLS) {
      expect(groupIds.has(tool.group)).toBe(true);
    }
  });

  test("tools ported from the freebuff runtime are the majority", () => {
    const ported = TOOLS.filter((t) => t.origin === "freebuff");
    expect(ported.length).toBeGreaterThan(15);
    for (const id of [
      "read_files",
      "write_file",
      "str_replace",
      "code_search",
      "run_terminal_command",
      "browser_navigate",
      "web_search",
      "thinker",
      "context_pruner",
      "editor_best_of_n",
      "file_picker",
      "basher",
      "gravity_index",
    ]) {
      expect(findTool(id)).toBeDefined();
      expect(findTool(id)!.origin).toBe("freebuff");
    }
  });

  test("stage-owning tools are thinker (plan) and reviewer (review)", () => {
    const withEffect = TOOLS.filter((t) => t.effect);
    expect(withEffect.map((t) => [t.id, t.effect])).toEqual([
      ["thinker", "plan"],
      ["reviewer", "review"],
    ]);
    expect(defaultEnabledToolIds()).toContain("thinker");
    expect(defaultEnabledToolIds()).toContain("reviewer");
  });

  test("resolveEnabledTools starts from defaults with no rows", () => {
    expect(resolveEnabledTools([])).toEqual(defaultEnabledToolIds());
  });

  test("resolveEnabledTools applies stored rows over the defaults", () => {
    const enabled = resolveEnabledTools([
      { toolId: "write_file", enabled: false },
      { toolId: "browser_click", enabled: true },
    ]);
    expect(enabled).not.toContain("write_file");
    expect(enabled).toContain("browser_click");
    // Untouched defaults survive.
    expect(enabled).toContain("read_files");
  });

  test("resolveEnabledTools ignores unknown ids from older catalogs", () => {
    const enabled = resolveEnabledTools([
      { toolId: "does_not_exist", enabled: true },
    ]);
    expect(enabled).toEqual(defaultEnabledToolIds());
  });

  test("toolDirectives follows catalog order and drops unknown ids", () => {
    const directives = toolDirectives(["reviewer", "read_files", "nope"]);
    expect(directives).toHaveLength(2);
    expect(directives[0]).toBe(findTool("read_files")!.directive);
    expect(directives[1]).toBe(findTool("reviewer")!.directive);
    expect(toolDirectives([])).toEqual([]);
  });

  test("hasTool is an exact id check", () => {
    expect(hasTool(["thinker", "reviewer"], "thinker")).toBe(true);
    expect(hasTool(["thinker"], "think")).toBe(false);
    expect(hasTool([], "thinker")).toBe(false);
  });
});

/* -------------------------------- research -------------------------------- */

describe("web research", () => {
  test("provider catalog has unique ids, env vars and docs links", () => {
    const ids = new Set(SEARCH_PROVIDERS.map((p) => p.id));
    expect(ids.size).toBe(SEARCH_PROVIDERS.length);
    for (const provider of SEARCH_PROVIDERS) {
      expect(provider.envVar).toMatch(/^[A-Z0-9_]+_API_KEY$/);
      expect(provider.docsUrl.startsWith("https://")).toBe(true);
    }
  });

  test("pickProvider returns nothing when no key is configured", () => {
    expect(pickProvider({})).toBeNull();
    expect(pickProvider({ OPENAI_API_KEY: "x" })).toBeNull();
  });

  test("pickProvider honours the documented priority order", () => {
    expect(pickProvider({ EXA_API_KEY: "a" })!.id).toBe("exa");
    expect(pickProvider({ TAVILY_API_KEY: "b" })!.id).toBe("tavily");
    expect(pickProvider({ BRAVE_API_KEY: "c" })!.id).toBe("brave");
    expect(pickProvider({ SERPER_API_KEY: "d" })!.id).toBe("serper");
    expect(
      pickProvider({ SERPER_API_KEY: "d", EXA_API_KEY: "a" })!.id,
    ).toBe("exa");
  });

  test("providers that return page text are marked as such", () => {
    const withContent = SEARCH_PROVIDERS.filter((p) => p.returnsContent);
    expect(withContent.map((p) => p.id)).toEqual(["exa", "tavily"]);
  });

  test("buildResearchQuery collapses whitespace and caps the length", () => {
    expect(buildResearchQuery("  доставка   еды  \n москва ")).toBe(
      "доставка еды москва",
    );
    const long = buildResearchQuery("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(MAX_RESEARCH_QUERY);
  });

  test("stripHtml drops scripts, styles, tags and entities", () => {
    const html =
      '<div><script>bad()</script><style>.a{}</style><p>Цена&nbsp;12&nbsp;900&nbsp;₽ &amp; доставка</p></div>';
    const text = stripHtml(html);
    expect(text).not.toContain("bad()");
    expect(text).not.toContain(".a{}");
    expect(text).not.toContain("<p>");
    expect(text).toContain("Цена 12 900 ₽ & доставка");
  });

  test("formatResearch renders provider, query and numbered sources", () => {
    const text = formatResearch({
      provider: "Exa",
      keyless: false,
      query: "доставка еды",
      answer: "Ответ",
      sources: [
        { title: "СДЭК", url: "https://cdek.ru", text: "Тарифы" },
        { title: "Boxberry", url: "https://boxberry.ru" },
      ],
    });
    expect(text).toContain("Provider: Exa");
    expect(text).toContain("Query: доставка еды");
    expect(text).toContain("1. СДЭК — https://cdek.ru");
    expect(text).toContain("2. Boxberry — https://boxberry.ru");
    expect(text).not.toContain("keyless fallback");
  });

  test("formatResearch marks the keyless fallback and truncates", () => {
    const keyless = formatResearch({
      provider: KEYLESS_LABEL,
      keyless: true,
      query: "q",
      sources: [{ title: "t", url: "https://example.com" }],
    });
    expect(keyless).toContain("(keyless fallback)");

    const long = formatResearch(
      {
        provider: "Exa",
        keyless: false,
        query: "q",
        sources: [{ title: "t", url: "https://example.com", text: "y".repeat(900) }],
      },
      120,
    );
    expect(long.length).toBe(121);
    expect(long.endsWith("…")).toBe(true);
  });

  test("isFetchableUrl accepts pages and rejects binaries", () => {
    expect(isFetchableUrl("https://cdek.ru/tarify")).toBe(true);
    expect(isFetchableUrl("http://example.com")).toBe(true);
    expect(isFetchableUrl("ftp://example.com")).toBe(false);
    expect(isFetchableUrl("https://a.ru/logo.png")).toBe(false);
    expect(isFetchableUrl("https://a.ru/doc.pdf")).toBe(false);
  });
});

/* ------------------------------ ru-services ------------------------------ */

describe("ru services catalog", () => {
  test("has unique ids and required fields with help texts", () => {
    const ids = new Set(RU_SERVICES.map((s) => s.id));
    expect(ids.size).toBe(RU_SERVICES.length);
    for (const service of RU_SERVICES) {
      for (const field of service.fields) {
        if (field.required) {
          expect(field.label.length).toBeGreaterThan(0);
        }
      }
      expect(service.docsUrl.startsWith("https://")).toBe(true);
    }
  });

  test("categories are consistent between catalog and filter list", () => {
    const used = new Set(RU_SERVICES.map((s) => s.category));
    for (const category of SERVICE_CATEGORIES) {
      // every declared category should be usable by at least the filter UI
      expect(typeof category).toBe("string");
    }
    for (const service of RU_SERVICES) {
      expect(SERVICE_CATEGORIES).toContain(service.category as never);
    }
    expect(used.size).toBeGreaterThan(0);
  });

  test("yandex disk connector exists with OAuth token field", () => {
    const yadisk = findService("yadisk");
    expect(yadisk).toBeDefined();
    expect(yadisk!.pattern).toBe("yadisk-oauth");
    const tokenField = yadisk!.fields.find((f) => f.id === "accessToken");
    expect(tokenField).toBeDefined();
    expect(tokenField!.required).toBe(true);
  });

  test("key russian services are present", () => {
    for (const id of ["bitrix24", "o3", "amocrm", "yookassa", "cdek", "dadata", "telegram"]) {
      expect(findService(id)).toBeDefined();
    }
  });
});
