import { query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { pickProvider } from "../lib/research";

/**
 * Non-secret status of the platform keys this deployment can use.
 * Only booleans cross the wire — never key values.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return {
      authenticated: !!user,
      aiKey: !!process.env.OPENAI_API_KEY,
      // Not a secret: the OpenAI-compatible endpoint the pipeline calls.
      // RF users can point it at DeepSeek / GLM (rubles, no foreign card).
      aiBaseUrl:
        (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      integrationKey: !!process.env.VLY_INTEGRATION_KEY,
      // Web research for the `web_search` tool. With no key the pipeline uses
      // the keyless Wikipedia + DuckDuckGo fallback, so the tool still works.
      searchProvider: pickProvider(process.env)?.label ?? null,
      searchKey: SEARCH_PROVIDER_VARS.some((name) => !!process.env[name]),
      emailKey: !!process.env.RESEND_API_KEY,
      paymentsKey: !!process.env.STRIPE_SECRET_KEY,
      // Optional: unlocks real Figma REST structure for url-imports.
      figmaToken: !!process.env.FIGMA_TOKEN,
    };
  },
});

/** Env var names (not values) that enable a search provider. */
const SEARCH_PROVIDER_VARS = [
  "EXA_API_KEY",
  "TAVILY_API_KEY",
  "BRAVE_API_KEY",
  "SERPER_API_KEY",
];
