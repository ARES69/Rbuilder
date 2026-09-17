import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  getProvider,
  type ModelProvider,
} from "./providers";

/**
 * Model catalog.
 *
 * Every entry names the provider and the **real** upstream model id sent to
 * `/chat/completions`. A display name is just a label — it never reaches the
 * API. If you add a model, verify the id against the provider's docs first:
 * a wrong id turns into a 404 "model not found" for the user, which is exactly
 * the failure this catalog used to have (friendly names mapped onto unrelated
 * OpenAI models).
 *
 * The provider is not necessarily wired up on a given deployment. Selecting a
 * model whose key is missing produces a clear message instead of a silent
 * fallback to a different model.
 */
export interface ModelDef {
  id: string;
  name: string;
  /** Which provider this entry routes to. */
  provider: ModelProvider;
  /** "full" = costs a daily session; "full-and-limited" = unmetered */
  access: "full" | "full-and-limited";
  costsSession: boolean;
  /** short capability label, e.g. context size / trial note */
  context: string;
  bestFor: string;
  /** shown in the picker before you start (Freebuff-style data-use notice) */
  dataNotice?: string;
  /** Real upstream model id sent to the provider API. */
  apiModel: string;
}

export const MODELS: ModelDef[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    access: "full-and-limited",
    costsSession: false,
    context: "128K context",
    bestFor: "Быстрый кодинг и tool use, дешёвый по умолчанию",
    apiModel: "deepseek-chat",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "deepseek",
    access: "full",
    costsSession: true,
    context: "128K context",
    bestFor: "Сложные многошаговые задачи с рассуждением",
    dataNotice: "Медленнее и дороже: включает reasoning-токены.",
    apiModel: "deepseek-reasoner",
  },
  {
    id: "glm-4-flash",
    name: "GLM-4 Flash",
    provider: "zhipu",
    access: "full-and-limited",
    costsSession: false,
    context: "128K context",
    bestFor: "Бесплатный уровень Zhipu, быстрые ответы",
    apiModel: "glm-4-flash",
  },
  {
    id: "glm-4-plus",
    name: "GLM-4 Plus",
    provider: "zhipu",
    access: "full",
    costsSession: true,
    context: "128K context",
    bestFor: "Сильная модель Zhipu для агентных задач",
    dataNotice: "Платный тариф провайдера.",
    apiModel: "glm-4-plus",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    access: "full-and-limited",
    costsSession: false,
    context: "128K context",
    bestFor: "Недорогой универсальный вариант OpenAI",
    apiModel: "gpt-4o-mini",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    access: "full",
    costsSession: true,
    context: "128K context · vision",
    bestFor: "Сильная универсальная модель с картинками",
    dataNotice: "Дороже остальных моделей в каталоге.",
    apiModel: "gpt-4o",
  },
  {
    id: "local-model",
    name: "Локальный шлюз",
    provider: "local",
    access: "full-and-limited",
    costsSession: false,
    context: "Зависит от модели",
    bestFor: "Ollama / vLLM / LM Studio на своём железе, без биллинга",
    // Overridable per deployment with LOCAL_MODEL_ID (see generation.ts).
    apiModel: "llama3.1",
  },
];

export const DEFAULT_MODEL_ID: string =
  MODELS.find((model) => model.provider === DEFAULT_PROVIDER)?.id ??
  MODELS[0].id;

export function getModel(id: string | undefined | null): ModelDef {
  return MODELS.find((model) => model.id === id) ?? MODELS[0];
}

/** The providers actually referenced by the catalog. */
export function catalogProviders() {
  const ids = new Set(MODELS.map((model) => model.provider));
  return PROVIDERS.filter((provider) => ids.has(provider.id));
}

export function modelsForProvider(provider: ModelProvider): ModelDef[] {
  return MODELS.filter((model) => model.provider === provider);
}

export { getProvider };

export const DAILY_SESSION_LIMIT = 6;
