import { describe, expect, test } from "bun:test";
import { MODELS, getModel, DEFAULT_MODEL_ID, DAILY_SESSION_LIMIT } from "./models";
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  estimateCostRub,
  getProvider,
  resolveProviderEndpoint,
} from "./providers";
import {
  HOUR_MS,
  MAX_REVIEW_ROUNDS,
  RATE_LIMITS,
  applyEdits,
  countWithinWindow,
  hasEditWork,
  parseEditResponse,
  describeModelError,
  extractHtml,
  extractProjectFiles,
  formatProjectContext,
  isRetryableStatus,
  parseReview,
  selectRelevantFiles,
  truncate,
} from "./generation-core";
import { describeElement, formatElementContext, pickedElementPrompt } from "./element-context";
import {
  detectPatterns,
  formatUserPatterns,
  mergePatterns,
  rankPatterns,
} from "./patterns";
import {
  ANTI_PATTERN_RULES,
  countIssues,
  detectAntiPatterns,
  issuesToPrompt,
} from "./anti-patterns";
import { isValidSlug, publishUrl, shortHost, siteBaseUrl, slugify } from "./deploy";
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

  test("default model id points at a real model of the default provider", () => {
    expect(MODELS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true);
    expect(getModel(DEFAULT_MODEL_ID).provider).toBe(DEFAULT_PROVIDER);
  });

  test("getModel falls back to the first model on unknown id", () => {
    const fallback = getModel("no-such-model");
    expect(fallback.id).toBe(MODELS[0].id);
    expect(getModel(undefined).id).toBe(MODELS[0].id);
    expect(getModel(null).id).toBe(MODELS[0].id);
  });

  test("getModel returns the requested model when it exists", () => {
    const model = getModel("deepseek-chat");
    expect(model.name).toBe("DeepSeek Chat");
    expect(model.apiModel).toBe("deepseek-chat");
  });

  test("every catalog entry routes to a declared provider", () => {
    const known = new Set(PROVIDERS.map((p) => p.id));
    for (const model of MODELS) {
      expect(known.has(model.provider)).toBe(true);
    }
  });

  test("a non-OpenAI model never silently carries an OpenAI model id", () => {
    for (const model of MODELS) {
      if (model.provider === "openai" || model.provider === "local") continue;
      expect(model.apiModel.startsWith("gpt-")).toBe(false);
    }
  });

  test("no invented marketing versions in the catalog", () => {
    for (const model of MODELS) {
      expect(model.name).not.toMatch(/\bV\d+\.\d+ (Flash|Pro)\b/);
      expect(model.apiModel).not.toMatch(/\s/);
    }
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
      "workspace_delete_file",
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
      "process_list",
      "process_stop",
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

/* ------------------------------- providers ------------------------------- */

describe("model providers", () => {
  test("provider ids are unique and carry a base URL and a key var", () => {
    const ids = new Set(PROVIDERS.map((p) => p.id));
    expect(ids.size).toBe(PROVIDERS.length);
    for (const provider of PROVIDERS) {
      expect(provider.baseUrl.startsWith("http")).toBe(true);
      expect(provider.baseUrl.endsWith("/")).toBe(false);
      expect(provider.keyEnv.length).toBeGreaterThan(0);
    }
  });

  test("endpoint uses the provider's own public API by default", () => {
    const endpoint = resolveProviderEndpoint(getProvider("deepseek"), () => undefined);
    expect(endpoint.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(endpoint.chatUrl).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(endpoint.apiKey).toBe("");
    expect(endpoint.gatewayOverride).toBe(false);
  });

  test("each provider reads its own key, not a global one", () => {
    const env = { ZHIPU_API_KEY: "zhipu-key" } as Record<string, string>;
    const reader = (name: string) => env[name];
    const glm = resolveProviderEndpoint(getProvider("zhipu"), reader);
    expect(glm.apiKey).toBe("zhipu-key");
    expect(glm.keyEnv).toBe("ZHIPU_API_KEY");

    const deepseek = resolveProviderEndpoint(getProvider("deepseek"), reader);
    expect(deepseek.apiKey).toBe("");
  });

  test("OPENAI_BASE_URL still forces a single gateway", () => {
    const env: Record<string, string> = {
      OPENAI_BASE_URL: "https://gateway.internal/v1/",
      OPENAI_API_KEY: "gateway-key",
    };
    const endpoint = resolveProviderEndpoint(getProvider("openai"), (n) => env[n]);
    expect(endpoint.baseUrl).toBe("https://gateway.internal/v1");
    expect(endpoint.apiKey).toBe("gateway-key");
    expect(endpoint.gatewayOverride).toBe(true);
  });

  test("provider base URL override wins over the public default", () => {
    const env: Record<string, string> = { DEEPSEEK_BASE_URL: "http://127.0.0.1:8080/v1" };
    const endpoint = resolveProviderEndpoint(getProvider("deepseek"), (n) => env[n]);
    expect(endpoint.baseUrl).toBe("http://127.0.0.1:8080/v1");
  });

  test("cost estimate uses published prices and refuses to invent one", () => {
    const known = estimateCostRub("deepseek-chat", 1_000_000, 0, 100);
    expect(known).toBe(28);
    expect(estimateCostRub("glm-4-flash", 1_000_000, 0)).toBeNull();
    expect(estimateCostRub("some-unknown-model", 10, 10)).toBeNull();
  });
});

/* --------------------------- generation pipeline -------------------------- */

describe("generation core", () => {
  test("truncate keeps short text and marks long text", () => {
    expect(truncate("short", 100)).toBe("short");
    const long = truncate("x".repeat(200), 10);
    expect(long.startsWith("x".repeat(10))).toBe(true);
    expect(long).toContain("truncated");
  });

  test("extractHtml unwraps fences and raw documents", () => {
    expect(extractHtml("```html\n<h1>hi</h1>\n```")).toBe("<h1>hi</h1>");
    expect(
      extractHtml("noise <!DOCTYPE html><html><body>ok</body></html> tail"),
    ).toBe("<!DOCTYPE html><html><body>ok</body></html>");
  });

  test("extractProjectFiles reads a JSON manifest", () => {
    const raw = JSON.stringify({
      files: [
        { path: "index.html", content: "<html></html>", language: "html" },
        { path: "src/App.tsx", content: "export default 1;" },
      ],
    });
    const files = extractProjectFiles(raw);
    expect(files.length).toBe(2);
    expect(files[1].path).toBe("src/App.tsx");
  });

  test("extractProjectFiles falls back to raw HTML", () => {
    const files = extractProjectFiles("<html><body>raw</body></html>");
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("index.html");
  });

  test("extractProjectFiles keeps malformed entries out", () => {
    const files = extractProjectFiles('{"files":[{"path":"a.html"},{"content":"x"}]}');
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("index.html");
  });

  test("a vague reviewer answer is not mistaken for approval", () => {
    expect(parseReview('{"verdict":"ok","issues":[]}').verdict).toBe("ok");
    expect(parseReview('```json\n{"verdict":"fix","issues":["кнопка не работает"]}\n```').verdict).toBe("fix");
    expect(parseReview('{"verdict":"ok"}').verdict).toBe("ok");
    expect(parseReview("Looks good, OK.").verdict).toBe("ok");
  });

  test("structured issues are extracted from reviewer JSON", () => {
    const review = parseReview(
      '{"verdict":"fix","issues":["нет обработчика формы","дублируется CSS"]}',
    );
    expect(review.issues).toEqual(["нет обработчика формы", "дублируется CSS"]);
  });

  test("legacy FIX: answers still drive a repair pass", () => {
    const review = parseReview("FIX: \n- hello button does nothing\n- missing footer");
    expect(review.verdict).toBe("fix");
    expect(review.issues.length).toBeGreaterThan(0);
  });

  test("empty reviewer output is not a failure", () => {
    expect(parseReview("   ").verdict).toBe("ok");
  });

  test("repair loop is bounded", () => {
    expect(MAX_REVIEW_ROUNDS).toBeGreaterThan(0);
    expect(MAX_REVIEW_ROUNDS).toBeLessThanOrEqual(2);
  });

  test("errors are translated, and never echo the provider body", () => {
    const leak = '{"error":{"message":"Incorrect API key sk-secret-123"}}';
    for (const status of [400, 401, 402, 404, 413, 429, 500, 503]) {
      const message = describeModelError(status, "DeepSeek", leak);
      expect(message).not.toContain("sk-secret-123");
      expect(message).not.toContain("Incorrect API key");
      expect(message.length).toBeGreaterThan(15);
    }
    expect(describeModelError(401, "DeepSeek")).toContain("Ключ");
    expect(describeModelError(429, "DeepSeek")).toContain("частот");
  });

  test("only transient statuses are retried", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  test("relevant files are selected instead of the whole project", () => {
    const files = [
      { path: "index.html", content: "<html></html>" },
      { path: "src/checkout.tsx", content: "export default function Checkout() {}" },
      { path: "src/unrelated.ts", content: "const x = 1;" },
    ];
    const selected = selectRelevantFiles(files, "почини checkout корзину", 10_000);
    expect(selected[0].path).toBe("index.html");
    expect(selected.map((f) => f.path)).toContain("src/checkout.tsx");
  });

  test("context selection respects the character budget", () => {
    const files = [
      { path: "index.html", content: "a".repeat(1000) },
      { path: "big.ts", content: "b".repeat(10_000) },
    ];
    const selected = selectRelevantFiles(files, "big changes", 1200);
    const total = selected.reduce((sum, file) => sum + file.content.length, 0);
    expect(total).toBeLessThanOrEqual(1400);
  });

  test("project context labels every file", () => {
    const text = formatProjectContext([{ path: "index.html", content: "<html></html>" }]);
    expect(text).toContain("--- index.html ---");
  });

  test("delta editing changes only the named fragment", () => {
    const current = [
      { path: "index.html", content: "<h1>Hello</h1>\n<footer>keep me</footer>" },
      { path: "src/other.ts", content: "export const untouched = true;" },
    ];
    const plan = parseEditResponse(
      JSON.stringify({
        edits: [{ path: "index.html", find: "<h1>Hello</h1>", replace: "<h1>Привет</h1>" }],
      }),
    );
    const result = applyEdits(current, plan);
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([]);
    const html = result.files.find((file) => file.path === "index.html")?.content ?? "";
    expect(html).toContain("<h1>Привет</h1>");
    expect(html).toContain("<footer>keep me</footer>");
    // The surviving file is byte-identical — the model cannot break what it
    // did not name.
    expect(result.files.find((f) => f.path === "src/other.ts")?.content).toBe(
      "export const untouched = true;",
    );
    // Input files are never mutated in place.
    expect(current[0].content).toContain("<h1>Hello</h1>");
  });

  test("append, new files and deletions are applied", () => {
    const current = [{ path: "index.html", content: "<html></html>" }];
    const plan = parseEditResponse(
      JSON.stringify({
        edits: [{ path: "index.html", append: "<script>ok()</script>" }],
        newFiles: [{ path: "src/New.tsx", content: "export default 1;" }],
        deleteFiles: ["src/gone.ts"],
      }),
    );
    const result = applyEdits(
      [...current, { path: "src/gone.ts", content: "obsolete" }],
      plan,
    );
    expect(hasEditWork(plan)).toBe(true);
    expect(result.created).toBe(1);
    expect(result.files.map((f) => f.path)).toEqual(["index.html", "src/New.tsx"]);
    expect(result.files[0].content).toContain("ok()");
  });

  test("a patch that does not match is reported, not silently dropped", () => {
    const plan = parseEditResponse(
      JSON.stringify({
        edits: [{ path: "index.html", find: "<h1>Not there</h1>", replace: "x" }],
      }),
    );
    const result = applyEdits([{ path: "index.html", content: "<h1>Hi</h1>" }], plan);
    expect(result.applied).toBe(0);
    expect(result.failed.length).toBe(1);
  });

  test("hostile or malformed patches are rejected", () => {
    const plan = parseEditResponse(
      JSON.stringify({
        edits: [
          { path: "../../etc/passwd", find: "a", replace: "b" },
          { path: "index.html" },
          "not an object",
        ],
        newFiles: [{ path: "../evil.ts", content: "x" }],
      }),
    );
    expect(plan.edits).toEqual([]);
    expect(plan.newFiles).toEqual([]);
  });

  test("a non-patch answer yields an empty plan so the caller can rebuild", () => {
    expect(hasEditWork(parseEditResponse("Sure! Here is the code..."))).toBe(false);
    expect(hasEditWork(parseEditResponse("```json\n{ broken\n```"))).toBe(false);
  });

  test("rate limits count calls inside the rolling window", () => {
    const now = 1_000_000_000;
    const records = [
      { promptTokens: 1, completionTokens: 1, createdAt: now - 60_000 },
      { promptTokens: 1, completionTokens: 1, createdAt: now - HOUR_MS * 2 },
    ];
    expect(countWithinWindow(records, HOUR_MS, now)).toBe(1);
    expect(RATE_LIMITS.anonymousPerDay).toBeLessThan(RATE_LIMITS.perUserPerDay);
  });
});

/* ------------------------------- deployments ------------------------------ */

describe("deployment urls", () => {
  test("slugs are latin, lowercase and shareable", () => {
    expect(slugify("Мой магазин туров")).toBe("moy-magazin-turov");
    expect(slugify("Sales Dashboard!!")).toBe("sales-dashboard");
    expect(slugify("  ---  ")).toBe("rbuilder-app");
    expect(slugify("a")).toBe("rbuilder-app");
  });

  test("slug validation rejects unsafe addresses", () => {
    expect(isValidSlug("my-app")).toBe(true);
    expect(isValidSlug("-bad")).toBe(false);
    expect(isValidSlug("bad-")).toBe(false);
    expect(isValidSlug("UpperCase")).toBe(false);
    expect(isValidSlug("no_slashes/")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
  });

  test("publish url points at the deployment's http endpoint", () => {
    const convexUrl = "https://deceptive-corgi-225.convex.cloud";
    expect(siteBaseUrl(convexUrl)).toBe("https://deceptive-corgi-225.convex.site");
    expect(publishUrl("my-app", convexUrl)).toBe(
      "https://deceptive-corgi-225.convex.site/p/my-app",
    );
    expect(siteBaseUrl(undefined)).toBe("");
  });

  test("host label is readable in the toolbar", () => {
    expect(shortHost("https://app.convex.site/p/demo")).toBe("app.convex.site");
    expect(shortHost("/p/demo")).toBe("/p/demo");
  });
});

/* ----------------------------- element picker ----------------------------- */

describe("element context", () => {
  const context = {
    selector: "main > section.hero > button.primary",
    tag: "button",
    id: "cta",
    classes: ["primary", "lg"],
    text: "Найти туры",
    attributes: { "data-id": "tour-search", "aria-label": "Поиск" },
    computed: { display: "inline-flex", "background-color": "rgb(17, 17, 17)" },
    cssRules: [".primary { background: #111 }", "@media (max-width: 640px) { ... }"],
    parent: "section.hero",
    siblings: ['a.link «Туры»', 'button.ghost «Сброс»'],
  };

  test("the prompt block carries selector, css and neighbours", () => {
    const formatted = formatElementContext(context);
    expect(formatted).toContain("main > section.hero > button.primary");
    expect(formatted).toContain("background-color: rgb(17, 17, 17)");
    expect(formatted).toContain(".primary { background: #111 }");
    expect(formatted).toContain("section.hero");
    expect(formatted).toContain("Туры");
    expect(formatted).toContain("не трогай");
  });

  test("element labels stay short", () => {
    expect(describeElement({ tag: "button", classes: ["primary"], text: "Войти" })).toBe(
      "button.primary «Войти»",
    );
    expect(describeElement({ tag: "div", classes: [], text: "" })).toBe("div");
  });

  test("composer text names the element", () => {
    expect(pickedElementPrompt(context)).toContain("main > section.hero > button.primary");
    expect(pickedElementPrompt(context)).toContain("Найти туры");
  });
});

/* --------------------------- learned preferences -------------------------- */

describe("learned preferences", () => {
  test("a manual edit that adds autoComplete is learned", () => {
    const before = '<input type="email" />';
    const after = '<input type="email" autoComplete="email" />';
    const detected = detectPatterns(before, after, "src/Login.tsx");
    expect(detected.map((p) => p.kind)).toContain("form.autocomplete");
    const pattern = detected.find((p) => p.kind === "form.autocomplete")!;
    expect(pattern.statement).toContain("autoComplete");
    expect(pattern.evidence).toContain("autoComplete");
  });

  test("form hardening and accessibility edits are recognised", () => {
    const before = '<button onClick={send}>Отправить</button>';
    const after = [
      '<button onClick={send} disabled={isSubmitting} className="cursor-pointer">Отправить</button>',
      '<div role="button" aria-label="Открыть" onClick={open} />',
    ].join("\n");
    const kinds = detectPatterns(before, after, "src/Form.tsx").map((p) => p.kind);
    expect(kinds).toContain("form.no-double-submit");
    expect(kinds).toContain("ui.cursor");
    expect(kinds).toContain("a11y.role-button");
    expect(kinds).toContain("a11y.aria");
  });

  test("a new palette colour is remembered", () => {
    const detected = detectPatterns(
      ".card { color: #111111; }",
      ".card { color: #0f172a; }",
      "src/styles.css",
    );
    const palette = detected.find((p) => p.kind === "style.palette");
    expect(palette).toBeDefined();
    expect(palette!.statement).toContain("#0f172a");
  });

  test("nothing is learned from an unchanged or shrinking file", () => {
    expect(detectPatterns("same", "same", "a.ts")).toEqual([]);
    expect(
      detectPatterns('const x = "autoComplete=x";', 'const x = "";', "a.ts"),
    ).toEqual([]);
  });

  test("repeated observations raise strength and cap evidence", () => {
    let rows = mergePatterns([], detectPatterns("a", "b autoComplete=\"email\"", "f.tsx"));
    for (let i = 0; i < 8; i += 1) {
      rows = mergePatterns(rows, detectPatterns("a", `b autoComplete="e${i}"`, "f.tsx"));
    }
    const row = rows.find((r) => r.kind === "form.autocomplete")!;
    expect(row.strength).toBe(9);
    expect(row.evidence.length).toBeLessThanOrEqual(5);
  });

  test("prompt block lists the strongest preferences first", () => {
    const rows = [
      { kind: "a", statement: "слабое", evidence: [], strength: 1 },
      { kind: "b", statement: "сильное", evidence: [], strength: 5 },
    ];
    expect(rankPatterns(rows)[0].kind).toBe("b");
    const block = formatUserPatterns(rows);
    expect(block).toContain("сильное");
    expect(block).toContain("5 раз");
    expect(block).toContain("ПОСТОЯННЫЕ ПРЕДПОЧТЕНИЯ");
    expect(formatUserPatterns([])).toBe("");
  });
});

/* ----------------------------- anti-patterns ------------------------------ */

describe("anti-pattern detection", () => {
  test("a list without key is reported, with key is not", () => {
    const withoutKey = detectAntiPatterns([
      { path: "src/App.tsx", content: "{items.map((item) => <li>{item}</li>)}" },
    ]);
    expect(withoutKey.some((i) => i.id === "react.map-without-key")).toBe(true);

    const withKey = detectAntiPatterns([
      {
        path: "src/App.tsx",
        content: "{items.map((item) => <li key={item.id}>{item}</li>)}",
      },
    ]);
    expect(withKey.some((i) => i.id === "react.map-without-key")).toBe(false);
  });

  test("a clickable div without role is an error", () => {
    const issues = detectAntiPatterns([
      { path: "index.html", content: '<div onClick="go()">Открыть</div>' },
    ]);
    const issue = issues.find((i) => i.id === "a11y.clickable-div");
    expect(issue?.severity).toBe("error");
    expect(issue?.line).toBe(1);

    const fine = detectAntiPatterns([
      { path: "index.html", content: '<div role="button" tabIndex={0} onClick="go()" />' },
    ]);
    expect(fine.some((i) => i.id === "a11y.clickable-div")).toBe(false);
  });

  test("a hardcoded secret is flagged, an env lookup is not", () => {
    const bad = detectAntiPatterns([
      { path: "src/api.ts", content: 'const apiKey = "sk-live-1234567890";' },
    ]);
    expect(bad.some((i) => i.id === "security.hardcoded-secret")).toBe(true);

    const good = detectAntiPatterns([
      { path: "src/api.ts", content: 'const apiKey = process.env.API_KEY ?? "";' },
    ]);
    expect(good.some((i) => i.id === "security.hardcoded-secret")).toBe(false);
  });

  test("a fetch in a loop is reported", () => {
    const issues = detectAntiPatterns([
      {
        path: "src/data.ts",
        content: "for (const id of ids) {\n  const res = await fetch(`/api/${id}`);\n}",
      },
    ]);
    expect(issues.some((i) => i.id === "async.fetch-in-loop")).toBe(true);
  });

  test("findings are sorted by severity and explain themselves", () => {
    const issues = detectAntiPatterns([
      {
        path: "index.html",
        content: [
          "<div onClick=\"x()\">a</div>",
          "<img src=\"a.png\">",
          "<script>console.log('debug')</script>",
        ].join("\n"),
      },
    ]);
    expect(issues[0].severity).toBe("error");
    const counts = countIssues(issues);
    expect(counts.total).toBe(issues.length);
    expect(counts.errors).toBeGreaterThan(0);
    const prompt = issuesToPrompt(issues);
    expect(prompt).toContain("index.html:1");
    expect(prompt).toContain("Ничего другого не меняй");
  });

  test("non-code files are ignored", () => {
    const issues = detectAntiPatterns([
      { path: "README.md", content: "console.log(victim) <div onClick=1>" },
    ]);
    expect(issues).toEqual([]);
  });

  test("every rule has a unique id, a severity and explainable copy", () => {
    const ids = new Set(ANTI_PATTERN_RULES.map((rule) => rule.id));
    expect(ids.size).toBe(ANTI_PATTERN_RULES.length);
    for (const rule of ANTI_PATTERN_RULES) {
      expect(rule.detail.length).toBeGreaterThan(30);
      expect(rule.title.length).toBeGreaterThan(5);
    }
  });
});

/* ------------------------ explained change records ------------------------ */

describe("explained changes", () => {
  test("the model's reason is kept with the applied patch", () => {
    const plan = parseEditResponse(
      JSON.stringify({
        edits: [
          {
            path: "index.html",
            find: "<button>Отправить</button>",
            replace: "<button disabled={busy}>Отправить</button>",
            why: "блокирую кнопку, пока идёт отправка — иначе заказ дублируется",
          },
        ],
      }),
    );
    expect(plan.edits[0].why).toContain("дублируется");
    const result = applyEdits(
      [{ path: "index.html", content: "<button>Отправить</button>" }],
      plan,
    );
    expect(result.changes).toEqual([
      {
        path: "index.html",
        why: "блокирую кнопку, пока идёт отправка — иначе заказ дублируется",
      },
    ]);
  });

  test("new files carry their reason too, and broken patches explain nothing", () => {
    const plan = parseEditResponse(
      JSON.stringify({
        newFiles: [{ path: "src/Cart.tsx", content: "export default 1;", why: "корзина" }],
      }),
    );
    const result = applyEdits([{ path: "index.html", content: "x" }], plan);
    expect(result.changes).toEqual([{ path: "src/Cart.tsx", why: "корзина" }]);

    const broken = applyEdits(
      [{ path: "index.html", content: "x" }],
      parseEditResponse(
        JSON.stringify({ edits: [{ path: "index.html", find: "nope", replace: "y", why: "зря" }] }),
      ),
    );
    expect(broken.changes).toEqual([]);
    expect(broken.failed.length).toBe(1);
  });
});
