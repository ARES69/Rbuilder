import { describe, expect, test } from "bun:test";
import { MODELS, getModel, DEFAULT_MODEL_ID, DAILY_SESSION_LIMIT } from "./models";
import { BUILT_IN_SKILLS, parseCustomSkill, SKILL_CATEGORIES } from "./skills";
import { STARTER_TEMPLATES } from "./templates";
import { CAPABILITIES } from "./capabilities";
import { RU_SERVICES, SERVICE_CATEGORIES, findService } from "./ru-services";
import { THEMES } from "./theme";

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
