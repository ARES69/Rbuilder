import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { getModel, getProvider } from "../lib/models";
import { apiModelFor } from "./generation";
import { resolveProviderEndpoint, missingKeyMessage } from "../lib/providers";
import { looksLikeMarkdown, docPathFor } from "../lib/file-docs";
import { truncate } from "../lib/generation-core";
import { defaultEnabledToolIds, toolDirectives } from "../lib/tools";

const EXPLAIN_SYSTEM = `Ты — senior-инженер и технический писатель RBuilder. Объясни указанный файл проекта тому, кто учится программировать.

ФОРМАТ (строго markdown, без вступлений):
# <имя файла>
## Что это
2–4 предложения: роль файла в приложении.
## Как это работает
3–6 пунктов списком: ключевые блоки кода и что они делают. Цитируй реальные имена функций/переменных из файла.
## Связи
1–3 пункта: какие файлы/модули этот файл использует и кто использует его.
## На что обратить внимание
1–3 пункта: подводные камни, где легко сломать, что доработать.

Пиши по-русски, конкретно, без воды. Не выдумывай код, которого нет в файле.`;

const MAX_FILE_CHARS = 60_000;
const MAX_DOC_CHARS = 30_000;

interface Target {
  chatUrl: string;
  apiKey: string;
  providerLabel: string;
  relay?: boolean;
}

/** Clean, human-readable failure — provider bodies never reach the user. */
function describeError(status: number, label: string): string {
  if (status === 401) return `Ключ ${label} отклонён. Проверьте ключ в настройках.`;
  if (status === 402) return `Закончились средства у провайдера ${label}.`;
  if (status === 429) return `${label} ограничивает частоту. Подождите немного.`;
  if (status >= 500) return `${label} недоступен. Попробуйте через минуту.`;
  return `Ошибка провайдера ${label} (${status}).`;
}

async function sleep(ms: number): Promise<void> {
  if (typeof setTimeout !== "function") return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One model call through the same targets the build pipeline uses — cloud
 * keys or the browser relay for local models. Kept small on purpose: this
 * action does not need the planner/reviewer machinery.
 */
async function callModel(
  ctx: ActionCtx,
  userId: Id<"users">,
  target: Target,
  apiModel: string,
  system: string,
  user: string,
): Promise<string> {
  if (target.relay) {
    const relayId = await ctx.runMutation(internal.modelRelay.enqueue, {
      userId,
      apiModel,
      system,
      user,
      maxTokens: 2000,
    });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const row = await ctx.runQuery(internal.modelRelay.get, { relayId });
      if (!row) throw new Error("Локальный мост: запрос потерян.");
      if (row.status === "done" && typeof row.result === "string") {
        await ctx.runMutation(internal.modelRelay.cleanup, { userId });
        return row.result;
      }
      if (row.status === "error") {
        throw new Error(`Локальная модель недоступна: ${row.error ?? "мост вернул ошибку"}`);
      }
      await sleep(1_500);
    }
    throw new Error(
      "Локальный мост не ответил. Запустите LM Studio/Ollama и держите вкладку RBuilder открытой.",
    );
  }
  const response = await fetch(target.chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      model: apiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });
  if (!response.ok) {
    const status = response.status;
    throw new Error(describeError(status, target.providerLabel));
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export const explain = action({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    modelId: v.optional(v.string()),
    toolIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { projectId, path, modelId, toolIds }): Promise<{ docPath: string; doc: string }> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

    const project = await ctx.runQuery(api.projects.get, { projectId });
    if (!project) throw new Error("Проект не найден");

    const files = await ctx.runQuery(api.projectFiles.list, { projectId });
    const normalized = path.replace(/^\/+/, "");
    const file = files.find((f) => f.path === normalized) ?? files[0];
    if (!file) throw new Error("Файл не найден — сначала соберите проект.");

    const model = getModel(modelId);
    const provider = getProvider(model.provider);
    const endpoint = resolveProviderEndpoint(provider, (name) => process.env[name]);
    const apiModel = apiModelFor(model.provider, model.apiModel);
    const viaRelay = provider.id === "local" && !endpoint.apiKey;

    if (!endpoint.apiKey && !viaRelay) {
      throw new Error(missingKeyMessage(provider, endpoint));
    }

    const target: Target = {
      chatUrl: endpoint.chatUrl,
      apiKey: endpoint.apiKey,
      providerLabel: provider.label,
      ...(viaRelay ? { relay: true } : {}),
    };

    const activeTools = toolIds ?? defaultEnabledToolIds();
    const directives = toolDirectives(activeTools).filter((d) => !/review|plan/i.test(d));
    const toolsBlock =
      directives.length > 0 ? `\n\nENABLED TOOLS (follow strictly):\n${directives.map((d) => `- ${d}`).join("\n")}` : "";

    const neighbors = files
      .filter((f) => f.path !== file.path && !f.path.startsWith("docs/"))
      .slice(0, 10)
      .map((f) => `- ${f.path}`)
    .join("\n");

    const userPrompt = [
      `Файл: ${file.path}`,
      file.language ? `Язык: ${file.language}` : null,
      neighbors ? `Другие файлы проекта:\n${neighbors}` : null,
      `Содержимое файла:\n\`\`\`\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``,
    ]
      .filter(Boolean)
      .join("\n\n");

    let doc = await callModel(ctx, user._id, target, apiModel, EXPLAIN_SYSTEM + toolsBlock, userPrompt);
    if (!looksLikeMarkdown(doc)) {
      doc = `# ${file.path}\n\n${doc.trim()}`;
    }
    doc = truncate(doc, MAX_DOC_CHARS);

    const docPath = docPathFor(file.path);
    // Doc is a normal project file: shows in the Code panel tree, exported
    // with the project, readable by the model on the next build.
    await ctx.runMutation(api.projectFiles.upsert, {
      projectId,
      path: docPath,
      content: doc,
      language: "markdown",
      version: project.version ?? 0,
      learn: false,
    });

    return { docPath, doc };
  },
});
