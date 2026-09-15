export interface ModelDef {
  id: string;
  name: string;
  /** "full" = costs a daily session; "full-and-limited" = unmetered */
  access: "full" | "full-and-limited";
  costsSession: boolean;
  /** short capability label, e.g. context size / trial note */
  context: string;
  bestFor: string;
  /** shown in the picker before you start (Freebuff-style data-use notice) */
  dataNotice?: string;
  /** upstream API model this catalog entry routes to */
  apiModel: string;
}

export const MODELS: ModelDef[] = [
  {
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    access: "full-and-limited",
    costsSession: false,
    context: "Unmetered",
    bestFor: "The default everywhere; deepest reasoning",
    apiModel: "gpt-4.1-mini",
  },
  {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    access: "full-and-limited",
    costsSession: false,
    context: "Unmetered",
    bestFor: "Fast coding and tool use",
    apiModel: "gpt-4o-mini",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    access: "full",
    costsSession: true,
    context: "Native images",
    bestFor: "Strong all-around with native images",
    dataNotice: "May use data for AI training.",
    apiModel: "gpt-4o",
  },
  {
    id: "mimo-2.5",
    name: "MiMo 2.5",
    access: "full-and-limited",
    costsSession: false,
    context: "Unmetered",
    bestFor: "Balanced performance with image support",
    apiModel: "gpt-4o-mini",
  },
  {
    id: "solar-pro-4",
    name: "Solar Pro 4",
    access: "full-and-limited",
    costsSession: false,
    context: "524K context · trial",
    bestFor: "Long-context work, text only",
    apiModel: "gpt-4.1",
  },
  {
    id: "muse-spark-1.2",
    name: "Muse Spark 1.2",
    access: "full",
    costsSession: true,
    context: "1M context",
    bestFor: "Agentic coding model; queues when busy",
    dataNotice: "May use data for AI training.",
    apiModel: "gpt-4o",
  },
];

export const DEFAULT_MODEL_ID = "glm-5.3-flash";

export function getModel(id: string | undefined | null): ModelDef {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export const DAILY_SESSION_LIMIT = 6;
