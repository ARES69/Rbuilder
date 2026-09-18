/**
 * Theme contrast smoke test — extracts the token values of all four themes
 * from src/index.css and checks WCAG contrast for the UI's critical
 * text/background pairs. This is the programmatic version of "look at the
 * screenshot in every theme".
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface Palette {
  name: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  popover: string;
  popoverForeground: string;
  sidebar: string;
  sidebarForeground: string;
}

/** --- tiny CSS parsing ---------------------------------------------------- */

function extractBlock(css: string, selector: string): string | null {
  // Match the selector only at a rule start (line beginning), so occurrences
  // inside comments/variants like `@custom-variant dark (&:is(.dark *))` and
  // compound selectors do not hijack the search.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleStart = new RegExp(`(?:^|\\n)\\s*${escaped}[^,{]*\\{`, "m");
  const match = css.match(ruleStart);
  if (!match) return null;
  const open = (match.index ?? 0) + match[0].length - 1;
  let depth = 1;
  let end = open + 1;
  while (depth > 0 && end < css.length) {
    if (css[end] === "{") depth += 1;
    if (css[end] === "}") depth -= 1;
    end += 1;
  }
  return css.slice(open + 1, end - 1);
}

function parseVars(block: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1], match[2].trim());
  }
  return vars;
}

/** --- color parsing: oklch / hex / rgb ------------------------------------ */

function parseColor(raw: string): [number, number, number] {
  const value = raw.trim();
  const oklch = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.-]+)/i);
  if (oklch) return oklchToRgb(parseFloat(oklch[1]), parseFloat(oklch[2]), parseFloat(oklch[3]));
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
  // rgba() with alpha over an assumed white bg (borders are not tested anyway)
  return [0, 0, 0];
}

function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = Math.cos(h) * c;
  const b = Math.sin(h) * c;
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const r = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, v * 255));
  };
  return [gamma(r), gamma(g), gamma(bl)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(parseColor(fg));
  const l2 = luminance(parseColor(bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** --- load themes ---------------------------------------------------------- */

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function paletteOf(name: string, selector: string, inherited?: Palette): Palette {
  const vars = parseVars(extractBlock(css, selector) ?? "");
  const get = (key: string, fallback?: string) =>
    vars.get(key) ?? (fallback ?? "");
  return {
    name,
    background: get("background", inherited?.background),
    foreground: get("foreground", inherited?.foreground),
    card: get("card", inherited?.card),
    cardForeground: get("card-foreground", inherited?.cardForeground),
    muted: get("muted", inherited?.muted),
    mutedForeground: get("muted-foreground", inherited?.mutedForeground),
    primary: get("primary", inherited?.primary),
    primaryForeground: get("primary-foreground", inherited?.primaryForeground),
    accent: get("accent", inherited?.accent),
    accentForeground: get("accent-foreground", inherited?.accentForeground),
    border: get("border", inherited?.border),
    popover: get("popover", inherited?.popover),
    popoverForeground: get("popover-foreground", inherited?.popoverForeground),
    sidebar: get("sidebar", inherited?.sidebar),
    sidebarForeground: get("sidebar-foreground", inherited?.sidebarForeground),
  };
}

const THEMES: Palette[] = [
  paletteOf("light", ":root"),
  paletteOf("dark", ".dark"),
  paletteOf("tomorrow", ".theme-tomorrow"),
  // tomorrow-dark is defined as ".theme-tomorrow-dark, .dark.theme-tomorrow-dark"
  paletteOf("tomorrow-dark", ".theme-tomorrow-dark,"),
];

/** --- the actual checks ---------------------------------------------------- */

describe("Theme contrast (all 4 themes)", () => {
  test("all four themes define a complete palette", () => {
    expect(THEMES.map((t) => t.name)).toEqual(["light", "dark", "tomorrow", "tomorrow-dark"]);
    for (const theme of THEMES) {
      for (const [key, value] of Object.entries(theme)) {
        if (key === "name") continue;
        expect(`${theme.name}.${key}=${value}`).not.toBe("");
      }
    }
  });

  for (const theme of THEMES) {
    describe(theme.name, () => {
      const pairs: [string, string, number][] = [
        ["text on background", theme.foreground, theme.background, 7],
        ["text on card", theme.cardForeground, theme.card, 7],
        ["secondary text on background", theme.mutedForeground, theme.background, 4.5],
        ["primary button text", theme.primaryForeground, theme.primary, 4.5],
        ["accent text", theme.accentForeground, theme.accent, 4.5],
        ["popover text", theme.popoverForeground, theme.popover, 7],
        ["sidebar text", theme.sidebarForeground, theme.sidebar, 7],
        ["border visible on background", theme.border, theme.background, 1.2],
      ];
      for (const [label, fg, bg, min] of pairs) {
        test(`${label}: ${fg} on ${bg} ≥ ${min}:1`, () => {
          const ratio = contrastRatio(fg, bg);
          expect(ratio).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});
