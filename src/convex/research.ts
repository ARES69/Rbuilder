import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  KEYLESS_LABEL,
  isFetchableUrl,
  pickProvider,
  stripHtml,
  type ResearchDigest,
  type ResearchSource,
  type SearchProvider,
} from "../lib/research";

/**
 * The research stage behind the `web_search` tool.
 *
 * Runs inside a Convex action, so it can use `fetch` and read the deployment's
 * env keys. Provider priority: Exa → Tavily → Brave → Serper. With no key it
 * falls back to Wikipedia + DuckDuckGo, so the tool still returns real sources
 * on a fresh install.
 */

const MAX_SOURCES = 5;
const MAX_TEXT_CHARS = 1200;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "RBuilder/1.0 (+research stage)";

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function trim(text: string | undefined, max = MAX_TEXT_CHARS): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

/* ------------------------------- providers ------------------------------- */

/** Every provider returns the same shape so the caller needs no narrowing. */
type ProviderResult = { sources: ResearchSource[]; answer?: string };

async function searchExa(key: string, query: string): Promise<ProviderResult> {
  const response = await timedFetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults: MAX_SOURCES,
      contents: { text: true },
    }),
  });
  if (!response.ok) throw new Error(`Exa ${response.status}`);
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
  };
  const sources = (data.results ?? [])
    .filter((r): r is { title?: string; url: string; text?: string } => !!r.url)
    .map((r) => ({
      title: r.title?.trim() || r.url,
      url: r.url,
      text: trim(r.text),
    }));
  return { sources };
}

async function searchTavily(key: string, query: string): Promise<ProviderResult> {
  const response = await timedFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      max_results: MAX_SOURCES,
      include_answer: true,
      search_depth: "basic",
    }),
  });
  if (!response.ok) throw new Error(`Tavily ${response.status}`);
  const data = (await response.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const sources = (data.results ?? [])
    .filter((r): r is { title?: string; url: string; content?: string } => !!r.url)
    .map((r) => ({
      title: r.title?.trim() || r.url,
      url: r.url,
      text: trim(r.content),
    }));
  return { sources, answer: trim(data.answer, 600) };
}

async function searchBrave(key: string, query: string): Promise<ProviderResult> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_SOURCES));
  const response = await timedFetch(url.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!response.ok) throw new Error(`Brave ${response.status}`);
  const data = (await response.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };
  const sources = (data.web?.results ?? [])
    .filter((r): r is { title?: string; url: string; description?: string } => !!r.url)
    .map((r) => ({
      title: r.title?.trim() || r.url,
      url: r.url,
      text: trim(stripHtml(r.description ?? "")),
    }));
  return { sources };
}

async function searchSerper(key: string, query: string): Promise<ProviderResult> {
  const response = await timedFetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: query, num: MAX_SOURCES }),
  });
  if (!response.ok) throw new Error(`Serper ${response.status}`);
  const data = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  const sources = (data.organic ?? [])
    .filter((r): r is { title?: string; link: string; snippet?: string } => !!r.link)
    .map((r) => ({
      title: r.title?.trim() || r.link,
      url: r.link,
      text: trim(stripHtml(r.snippet ?? "")),
    }));
  return { sources };
}

/* --------------------------- keyless fallback ---------------------------- */

async function searchWikipedia(
  query: string,
): Promise<{ sources: ResearchSource[] }> {
  const url = new URL("https://ru.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(MAX_SOURCES));
  url.searchParams.set("srprop", "snippet");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await timedFetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  const data = (await response.json()) as {
    query?: {
      search?: Array<{ title?: string; pageid?: number; snippet?: string }>;
    };
  };
  const sources = (data.query?.search ?? [])
    .filter((r): r is { title: string; pageid?: number; snippet?: string } => !!r.title)
    .map((r) => ({
      title: r.title,
      url: r.pageid
        ? `https://ru.wikipedia.org/?curid=${r.pageid}`
        : `https://ru.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
      text: trim(stripHtml(r.snippet ?? "")),
    }));
  return { sources };
}

async function searchDuckDuckGo(
  query: string,
): Promise<{ sources: ResearchSource[]; answer?: string }> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");
  const response = await timedFetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`DuckDuckGo ${response.status}`);
  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const sources: ResearchSource[] = [];
  if (data.AbstractText && data.AbstractURL) {
    sources.push({
      title: data.Heading?.trim() || data.AbstractURL,
      url: data.AbstractURL,
      text: trim(data.AbstractText),
    });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (sources.length >= MAX_SOURCES) break;
    if (topic.FirstURL && topic.Text) {
      sources.push({
        title: topic.Text.split(" - ")[0].slice(0, 120),
        url: topic.FirstURL,
        text: trim(topic.Text),
      });
    }
  }
  return { sources, answer: trim(data.AbstractText, 600) };
}

/* ---------------------------- deeper page read --------------------------- */

/** Fetch a page and reduce it to readable text (the `read_url` pass). */
async function readPage(url: string): Promise<string | undefined> {
  try {
    const response = await timedFetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return undefined;
    }
    const body = await response.text();
    // Guard against very large documents before cleaning them.
    return trim(stripHtml(body.slice(0, 200_000)));
  } catch {
    return undefined;
  }
}

/* --------------------------------- action -------------------------------- */

export const search = internalAction({
  args: {
    query: v.string(),
    /** Also fetch the top result pages — the `read_url` pass. */
    readPages: v.optional(v.boolean()),
  },
  handler: async (_ctx, { query, readPages }): Promise<ResearchDigest> => {
    const provider: SearchProvider | null = pickProvider(process.env);
    const key = provider ? process.env[provider.envVar] : undefined;

    let sources: ResearchSource[] = [];
    let answer: string | undefined;

    if (provider && key) {
      try {
        const result =
          provider.id === "exa"
            ? await searchExa(key, query)
            : provider.id === "tavily"
              ? await searchTavily(key, query)
              : provider.id === "brave"
                ? await searchBrave(key, query)
                : await searchSerper(key, query);
        sources = result.sources;
        answer = result.answer;
      } catch {
        // Provider failed (quota, key, outage) — fall through to keyless.
        sources = [];
        answer = undefined;
      }
    }

    let keyless = false;
    if (sources.length === 0) {
      keyless = true;
      const [wiki, ddg] = await Promise.allSettled([
        searchWikipedia(query),
        searchDuckDuckGo(query),
      ]);
      if (wiki.status === "fulfilled") sources.push(...wiki.value.sources);
      if (ddg.status === "fulfilled") {
        sources.push(...ddg.value.sources);
        answer = answer ?? ddg.value.answer;
      }
    }

    // De-duplicate by URL and keep the digest small.
    const seen = new Set<string>();
    sources = sources
      .filter((source) => {
        if (seen.has(source.url)) return false;
        seen.add(source.url);
        return true;
      })
      .slice(0, MAX_SOURCES);

    // The `read_url` pass: give the agents the actual page text where the
    // provider only returned a snippet.
    if (readPages) {
      const targets = sources
        .filter((source) => !source.text && isFetchableUrl(source.url))
        .slice(0, 2);
      const pages = await Promise.all(targets.map((t) => readPage(t.url)));
      pages.forEach((text, index) => {
        if (text) targets[index].text = text;
      });
    }

    return {
      provider: provider && sources.length > 0 && !keyless ? provider.label : KEYLESS_LABEL,
      keyless: keyless || !provider,
      query,
      answer,
      sources,
    };
  },
});
