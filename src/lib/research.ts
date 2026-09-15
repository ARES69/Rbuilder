/**
 * Web research for the `web_search` / `read_url` tools.
 *
 * A real search stage: the pipeline asks a search provider for sources and
 * grounds the build in what it finds. Providers are picked from whichever key
 * is present, and a keyless fallback (Wikipedia + DuckDuckGo) means the stage
 * works with zero configuration — important because RBuilder must be usable
 * without buying a foreign service.
 *
 * The pure helpers here are shared by the Convex action and the UI (and are
 * unit-tested); only `convex/research.ts` performs network calls.
 */

export interface SearchProvider {
  id: string;
  label: string;
  envVar: string;
  docsUrl: string;
  /** The provider returns page text alongside each result (no extra fetch). */
  returnsContent: boolean;
}

export const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    id: "exa",
    label: "Exa",
    envVar: "EXA_API_KEY",
    docsUrl: "https://dashboard.exa.ai/api-keys",
    returnsContent: true,
  },
  {
    id: "tavily",
    label: "Tavily",
    envVar: "TAVILY_API_KEY",
    docsUrl: "https://app.tavily.com/home",
    returnsContent: true,
  },
  {
    id: "brave",
    label: "Brave Search",
    envVar: "BRAVE_API_KEY",
    docsUrl: "https://api-dashboard.search.brave.com/app/keys",
    returnsContent: false,
  },
  {
    id: "serper",
    label: "Serper (Google)",
    envVar: "SERPER_API_KEY",
    docsUrl: "https://serper.dev/dashboard",
    returnsContent: false,
  },
];

/** Human label for the zero-config path. */
export const KEYLESS_LABEL = "Wikipedia + DuckDuckGo";

/** First provider whose key is configured, or null → keyless fallback. */
export function pickProvider(
  env: Record<string, string | undefined>,
): SearchProvider | null {
  return SEARCH_PROVIDERS.find((provider) => !!env[provider.envVar]) ?? null;
}

export interface ResearchSource {
  title: string;
  url: string;
  /** Page text or snippet, when the provider (or a page read) supplies it. */
  text?: string;
}

export interface ResearchDigest {
  provider: string;
  keyless: boolean;
  query: string;
  answer?: string;
  sources: ResearchSource[];
}

export const MAX_RESEARCH_QUERY = 200;
export const MAX_RESEARCH_CHARS = 6000;

/** Turn a free-form request into a compact search query. */
export function buildResearchQuery(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_RESEARCH_QUERY) return cleaned;
  return cleaned.slice(0, MAX_RESEARCH_QUERY).trimEnd();
}

/** Strip tags, scripts and entities down to readable text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Render the digest as the prompt block handed to the agents. */
export function formatResearch(
  digest: ResearchDigest,
  maxChars: number = MAX_RESEARCH_CHARS,
): string {
  const lines: string[] = [
    `Provider: ${digest.provider}${digest.keyless ? " (keyless fallback)" : ""}`,
    `Query: ${digest.query}`,
  ];
  if (digest.answer) lines.push(`Answer: ${digest.answer}`);
  lines.push("Sources:");
  digest.sources.forEach((source, index) => {
    lines.push(`${index + 1}. ${source.title} — ${source.url}`);
    if (source.text) lines.push(`   ${source.text}`);
  });
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** True when a URL is worth fetching during the deeper `read_url` pass. */
export function isFetchableUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // Skip obvious non-article hosts that only add noise to the prompt.
  return !/\.(png|jpe?g|gif|svg|webp|pdf|zip)(\?|$)/i.test(url);
}
