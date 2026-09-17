/**
 * Deployment addressing.
 *
 * A published app gets a real, shareable URL served by the Convex deployment
 * itself (`https://<deployment>.convex.site/p/<slug>`), so "Deploy" produces a
 * link you can paste into Telegram instead of another localhost preview tab.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** "Мой магазин туров" → "moy-magazin-turov". */
export function slugify(input: string): string {
  const transliterated = input
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("");
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length >= SLUG_MIN ? slug : "rbuilder-app";
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return false;
  if (!/^[a-z0-9-]+$/.test(slug)) return false;
  return !slug.startsWith("-") && !slug.endsWith("-");
}

/**
 * Public base URL of the deployment's HTTP endpoints. Convex serves HTTP
 * actions from `<deployment>.convex.site`, while the client talks to
 * `<deployment>.convex.cloud`.
 */
export function siteBaseUrl(convexUrl: string | undefined): string {
  if (!convexUrl) return "";
  return convexUrl.replace(/\/$/, "").replace(".convex.cloud", ".convex.site");
}

/** Absolute (or relative, when the base is unknown) URL of a published app. */
export function publishUrl(slug: string, convexUrl?: string): string {
  const base = siteBaseUrl(convexUrl);
  return `${base}/p/${slug}`;
}

/** Short label for the toolbar, e.g. "my-app.rbuilder.app". */
export function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
