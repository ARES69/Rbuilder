/**
 * Model providers.
 *
 * RBuilder talks to any OpenAI-compatible `/chat/completions` endpoint. A model
 * catalog entry names its provider, and the provider decides which base URL and
 * which API key are used — instead of sending every request to one global
 * `OPENAI_BASE_URL`, which silently breaks the moment the catalog and the
 * gateway disagree about model names.
 *
 * Priority when resolving an endpoint:
 *  1. `OPENAI_BASE_URL` — explicit single-gateway mode (proxy, self-hosted,
 *     corporate gateway). Keeps existing deployments working.
 *  2. the provider's own `<PROVIDER>_BASE_URL`.
 *  3. the provider's public API.
 */

export type ModelProvider = "deepseek" | "openai" | "zhipu" | "local";

export interface ProviderDef {
  id: ModelProvider;
  label: string;
  /** Public OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string;
  /** Environment variables holding the API key, in priority order. */
  keyEnv: string[];
  /** Environment variable overriding the base URL. */
  baseUrlEnv: string;
  /** Shown to the user when the key is missing. */
  keyLabel: string;
  docs: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"],
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    keyLabel: "DEEPSEEK_API_KEY",
    docs: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: ["OPENAI_API_KEY"],
    baseUrlEnv: "OPENAI_BASE_URL_OVERRIDE",
    keyLabel: "OPENAI_API_KEY",
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "zhipu",
    label: "Zhipu / GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keyEnv: ["ZHIPU_API_KEY", "GLM_API_KEY"],
    baseUrlEnv: "ZHIPU_BASE_URL",
    keyLabel: "ZHIPU_API_KEY",
    docs: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "local",
    label: "Локальный шлюз",
    baseUrl: "http://127.0.0.1:11434/v1",
    keyEnv: ["LOCAL_API_KEY", "OPENAI_API_KEY"],
    baseUrlEnv: "LOCAL_BASE_URL",
    keyLabel: "LOCAL_BASE_URL",
    docs: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
  },
];

export const DEFAULT_PROVIDER: ModelProvider = "deepseek";

export function getProvider(id: string | undefined | null): ProviderDef {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

export interface ProviderEndpoint {
  provider: ModelProvider;
  baseUrl: string;
  /** `<baseUrl>/chat/completions` */
  chatUrl: string;
  apiKey: string;
  /** Name of the env var the key came from (for error messages). */
  keyEnv?: string;
  /** True when `OPENAI_BASE_URL` forced a single gateway. */
  gatewayOverride: boolean;
}

type EnvReader = (name: string) => string | undefined;

function readEnv(env: EnvReader, names: string[]): string {
  for (const name of names) {
    const value = env(name)?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolve the endpoint for a provider. Pure — the env reader is injected so
 * this is testable outside the Convex runtime.
 */
export function resolveProviderEndpoint(
  provider: ProviderDef,
  env: EnvReader,
): ProviderEndpoint {
  const gateway = env("OPENAI_BASE_URL")?.trim();
  const own = env(provider.baseUrlEnv)?.trim();
  const baseUrl = (
    gateway && provider.id !== "local" ? gateway : own || provider.baseUrl
  ).replace(/\/$/, "");

  let apiKey = readEnv(env, provider.keyEnv);
  let keyEnv: string | undefined;
  for (const name of provider.keyEnv) {
    if (env(name)?.trim()) {
      keyEnv = name;
      break;
    }
  }
  if (!apiKey && gateway) {
    apiKey = readEnv(env, ["OPENAI_API_KEY"]);
    keyEnv = apiKey ? "OPENAI_API_KEY" : undefined;
  }

  return {
    provider: provider.id,
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    apiKey,
    keyEnv,
    gatewayOverride: Boolean(gateway) && provider.id !== "local",
  };
}

/** Human-readable, non-leaky explanation of what is missing. */
export function missingKeyMessage(
  provider: ProviderDef,
  endpoint: ProviderEndpoint,
): string {
  return [
    `Модель работает через ${provider.label}, но ключ не задан.`,
    `Добавьте ${provider.keyLabel} в API-ключи проекта`,
    endpoint.gatewayOverride
      ? ` (сейчас запросы идут через OPENAI_BASE_URL: ${endpoint.baseUrl}).`
      : ` (${provider.docs}).`,
  ].join("");
}

/**
 * Approximate price per 1M tokens, in USD. Only models with a published,
 * verifiable price are listed — for anything else we record tokens and report
 * no money instead of inventing a number.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  "deepseek-chat": { input: 0.28, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export const DEFAULT_USD_RUB_RATE = 95;

/**
 * Estimated cost of one call in rubles, or `null` when the price is unknown.
 * The rate is only a default — set `USD_RUB_RATE` to keep the estimate honest.
 */
export function estimateCostRub(
  apiModel: string,
  promptTokens: number,
  completionTokens: number,
  usdRubRate: number = DEFAULT_USD_RUB_RATE,
): number | null {
  const price = MODEL_PRICING_USD_PER_MTOK[apiModel];
  if (!price) return null;
  const usd =
    (promptTokens / 1_000_000) * price.input +
    (completionTokens / 1_000_000) * price.output;
  return Math.round(usd * usdRubRate * 100) / 100;
}
