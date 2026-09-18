/**
 * Import from existing sources — pure helpers.
 *
 * The user arrives with a Figma link, an export from v0/Lovable, a website
 * screenshot or a PDF spec. This module classifies what they handed over and
 * builds the structured request block the pipeline can act on. All functions
 * are pure and testable; the Convex action does the IO (fetch, storage).
 */

/** What kind of source the user is importing. */
export type ImportKind = "figma" | "v0" | "lovable" | "screenshot" | "pdf" | "url" | "unknown";

export interface ImportSource {
  kind: ImportKind;
  /** Normalized url for fetchable sources (figma/v0/url). */
  url?: string;
  /** Figma file key extracted from the url. */
  figmaFileKey?: string;
  /** Figma node id if the link points at a specific frame. */
  figmaNodeId?: string;
}

const FIGMA_RE = /^https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([A-Za-z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([\w-]+))?/i;
const V0_RE = /^https?:\/\/(?:www\.)?v0\.dev\/r?\/?([A-Za-z0-9_-]+)/i;
const LOVABLE_RE = /^https?:\/\/(?:www\.)?lovable\.dev\/projects\/([A-Za-z0-9-]+)/i;

/** Classify a pasted url (or non-url source descriptor). */
export function classifyUrl(raw: string): ImportSource {
  const value = raw.trim();
  if (!value) return { kind: "unknown" };

  const figma = value.match(FIGMA_RE);
  if (figma) {
    const nodeId = figma[2] ? decodeURIComponent(figma[2]).replace(/-/g, ":") : undefined;
    return { kind: "figma", url: value, figmaFileKey: figma[1], figmaNodeId: nodeId };
  }
  if (V0_RE.test(value)) return { kind: "v0", url: value };
  if (LOVABLE_RE.test(value)) return { kind: "lovable", url: value };
  if (/^https?:\/\//i.test(value)) return { kind: "url", url: value };
  return { kind: "unknown" };
}

/** Classify an uploaded file by mime/extension. */
export function classifyFile(
  name: string,
  mimeType: string,
): { kind: ImportKind; reason?: string } {
  const lower = name.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return { kind: "pdf" };
  }
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    return { kind: "screenshot" };
  }
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx") || lower.endsWith(".zip")) {
    return { kind: "v0", reason: "экспорт кода" };
  }
  return { kind: "unknown" };
}

const MAX_SPEC_CHARS = 8_000;

/** Wrap extracted text into a request block for the pipeline. */
export function formatImportContext(
  source: ImportSource | { kind: ImportKind; label: string },
  detail: string,
): string {
  const header =
    source.kind === "figma"
      ? `Импорт из Figma${"figmaFileKey" in source && source.figmaFileKey ? ` (файл ${source.figmaFileKey})` : ""}`
      : source.kind === "v0"
        ? "Импорт из v0/Lovable (код проекта)"
        : source.kind === "screenshot"
          ? "Импорт из скриншота"
          : source.kind === "pdf"
            ? "Импорт из PDF с ТЗ"
            : `Импорт из источника (${source.kind})`;
  return `=== ${header} ===\n${detail.slice(0, MAX_SPEC_CHARS).trim()}\n=== Конец импорта ===\nРеализуй описанное в этом блоке как основу запроса. Не выдумывай разделы, которых нет в источнике; недостающие детали дозаполни минимально.`;
}

/** Human-readable one-liner for toasts/menu of a classified source. */
export function describeSource(source: ImportSource): string {
  switch (source.kind) {
    case "figma":
      return `Figma${source.figmaNodeId ? " (выделенный фрейм)" : ""}`;
    case "v0":
      return "v0.dev — код проекта";
    case "lovable":
      return "Lovable — код проекта";
    case "screenshot":
      return "Скриншот — визуальный референс";
    case "pdf":
      return "PDF — текст ТЗ";
    case "url":
      return "Веб-страница — по ссылке";
    default:
      return "Источник не распознан";
  }
}

/* --------------------------- pdf text extraction -------------------------- */

/**
 * Extract readable text from PDF bytes without dependencies: walk raw
 * content streams and pick literal strings from Tj/TJ operators. Works for
 * most text-based PDFs produced by office suites; scanned images yield no
 * text and the caller falls back to the model path.
 */
export function extractPdfText(bytes: Uint8Array): string {
  let latin: string;
  try {
    latin = new TextDecoder("latin1").decode(bytes);
  } catch {
    return "";
  }
  if (!latin.startsWith("%PDF")) return "";

  const chunks: string[] = [];
  // Literal strings from show-text operators: (…) Tj and […...] TJ
  const showText = /\((?:\\.|[^\\()])*\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g;
  for (const match of latin.matchAll(showText)) {
    const raw = match[0];
    const strings = raw.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
    let line = "";
    for (const str of strings) {
      line += decodePdfString(str.slice(1, -1));
      // TJ arrays separate glyphs; small gaps are the same word
      line += " ";
    }
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed) chunks.push(trimmed);
  }
  const text = chunks.join("\n");
  // De-hyphenate wrapped words and collapse spacing
  return text
    .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Unescape PDF literal-string escapes. */
function decodePdfString(body: string): string {
  return body
    .replace(/\\([nrtbf()\\])/g, (_, ch: string) => {
      const map: Record<string, string> = {
        n: "\n", r: "\r", t: "\t", b: "\b", f: "\f",
        "(": "(", ")": ")", "\\": "\\",
      };
      return map[ch] ?? ch;
    })
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) =>
      String.fromCharCode(parseInt(oct, 8)),
    );
}

/** Rough spec readability gate: too little text → let the model look instead. */
export function isUsableSpec(text: string): boolean {
  const letters = text.replace(/\s/g, "");
  return letters.length >= 120;
}
