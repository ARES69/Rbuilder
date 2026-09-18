/**
 * "Explain this file" — pure helpers.
 *
 * The docs are ordinary project files (`docs/<name>.md`) so they travel with
 * the project: they appear in the Code panel tree, they are exported with the
 * project, and the model can read them back on the next build. All logic that
 * is testable without Convex lives here.
 */

/** Docs produced by the explainer live under `docs/`. */
export const DOCS_DIR = "docs/";

/** Doc filename for a source file: `src/App.tsx` → `docs/App.md`. */
export function docPathFor(sourcePath: string): string {
  const name = sourcePath.split("/").pop() ?? sourcePath;
  const base = name.replace(/\.[^.]+$/, "") || name;
  return `${DOCS_DIR}${base || "file"}.md`;
}

/** Source file a doc was generated from: `docs/App.md` → `App`. */
export function sourceBaseFromDoc(docPath: string): string {
  return docPath.replace(DOCS_DIR, "").replace(/\.md$/, "");
}

export function isDocPath(path: string): boolean {
  return path.startsWith(DOCS_DIR) && path.endsWith(".md");
}

/** Rough language detection for the docs editor (Code panel uses it too). */
export function docsLanguage(path: string): "markdown" | "html" | undefined {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  return undefined;
}

/** The explainer must answer with real markdown, not prose about markdown. */
export function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^```|~~~/.test(trimmed)) return false; // wrapped in a fence
  return /(^|\n)#{1,4} |\n[-*] |\n\d+\. |`[^`]+`/.test(trimmed);
}

/** Stable order for the docs: README-style first, then alphabetical. */
export function sortDocPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aReadme = /readme/i.test(a) ? 0 : 1;
    const bReadme = /readme/i.test(b) ? 0 : 1;
    if (aReadme !== bReadme) return aReadme - bReadme;
    return a.localeCompare(b);
  });
}
