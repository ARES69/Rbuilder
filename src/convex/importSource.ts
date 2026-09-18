import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { getModel, getProvider } from "../lib/models";
import { apiModelFor } from "./generation";
import { resolveProviderEndpoint, missingKeyMessage } from "../lib/providers";
import { truncate } from "../lib/generation-core";
import {
  classifyUrl,
  classifyFile,
  describeSource,
  formatImportContext,
  extractPdfText,
  isUsableSpec,
  type ImportSource,
} from "../lib/import-sources";

/**
 * Import an existing source into a structured request block.
 *
 * Inputs: a pasted url (Figma / v0 / Lovable / any page) or a file already in
 * Convex storage (PDF spec or screenshot). The action returns ready-to-paste
 * prompt text; the client puts it in the composer so the user can review and
 * extend it before building — nothing is generated behind their back.
 *
 * Vision is used for screenshots (the model sees the image), text extraction
 * for PDFs, page fetching for urls. Figma public links are summarized from
 * their share page; with FIGMA_TOKEN set the REST API gives real structure.
 */

const FIGMA_IMPORT_SYSTEM = `Ты — аналитик интерфейсов RBuilder. По описанию/структуре страницы Figma верни краткую спецификацию для генератора приложений.

ФОРМАТ (markdown, по-русски):
## Экран
1 строка — что за экран.
## Секции
3-6 пунктов: какие блоки идут сверху вниз, с реальными заголовками/подписями из источника.
## Данные
1-3 пункта: сущности и поля, которые видны (кнопки, поля ввода, карточки).
## Стиль
1-2 строки: цвета, типографика, настроение — если различимы.

Только то, что есть в источнике. Без фантазий.`;

const VISION_IMPORT_SYSTEM = `Ты — аналитик интерфейсов RBuilder. Перед тобой скриншот сайта/приложения. Опиши его как спецификацию для генератора приложений.

ФОРМАТ (markdown, по-русски):
## Экран
1 строка.
## Секции
3-6 пунктов сверху вниз с реальными текстами с картинки.
## Данные
1-3 пункта: поля, кнопки, карточки, навигация.
## Стиль
1-2 строки: палитра, плотность, типографика.

Только то, что видно. Без выдумок.`;

const URL_IMPORT_SYSTEM = `Ты — аналитик RBuilder. По тексту веб-страницы верни краткую спецификацию приложения/лендинга, который можно построить по её мотивам.

ФОРМАТ (markdown, по-русски):
## Экран
## Секции
## Данные
## Стиль
Только факты из текста страницы. Без выдумок.`;

const MAX_URL_CHARS = 20_000;
const MAX_IMAGE_BYTES = 4_000_000;

interface Target {
  chatUrl: string;
  apiKey: string;
  providerLabel: string;
  relay?: boolean;
}

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

/** One model call; cloud endpoint or browser relay for local models. */
async function callModel(
  ctx: ActionCtx,
  userId: Id<"users">,
  target: Target,
  apiModel: string,
  system: string,
  user: unknown,
  maxTokens = 800,
): Promise<string> {
  if (target.relay) {
    const relayId = await ctx.runMutation(internal.modelRelay.enqueue, {
      userId,
      apiModel,
      system,
      user: typeof user === "string" ? user : JSON.stringify(user),
      maxTokens,
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
    throw new Error("Локальный мост не ответил. Запустите LM Studio/Ollama.");
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
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    throw new Error(describeError(response.status, target.providerLabel));
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Read a stored attachment (getForGeneration checks ownership via project). */
async function readAttachment(
  ctx: ActionCtx,
  attachmentId: Id<"attachments">,
): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
  const meta = await ctx.runQuery(api.attachments.getForGeneration, { attachmentId });
  if (!meta || !meta.storageId) return null;
  const blob = await ctx.storage.get(meta.storageId);
  if (!blob) return null;
  return {
    name: meta.name,
    mimeType: meta.mimeType,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

async function summarizeWithModel(
  ctx: ActionCtx,
  userId: Id<"users">,
  target: Target,
  apiModel: string,
  system: string,
  promptText: string,
): Promise<string> {
  const raw = await callModel(ctx, userId, target, apiModel, system, promptText);
  return truncate(raw.trim(), 6000);
}

/** Vision summary of a screenshot (OpenAI-style image_url content parts). */
async function summarizeImage(
  ctx: ActionCtx,
  userId: Id<"users">,
  target: Target,
  apiModel: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<string> {
  if (target.relay) {
    // Local relays (LM Studio/Ollama vision) accept the same OpenAI shape,
    // but base64 payloads are heavy for the relay table — describe by name.
    return summarizeWithModel(
      ctx,
      userId,
      target,
      apiModel,
      URL_IMPORT_SYSTEM,
      "Пользователь загрузил скриншот, но локальный мост не передаёт изображения. Попросите описать экран словами или используйте облачную модель.",
    );
  }
  const base64 = btoa(String.fromCharCode(...bytes.subarray(0, MAX_IMAGE_BYTES)));
  const content = [
    { type: "text", text: "Опиши этот интерфейс по формату." },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
  ];
  const raw = await callModel(ctx, userId, target, apiModel, VISION_IMPORT_SYSTEM, content, 900);
  return truncate(raw.trim(), 6000);
}

/** Fetch a public page and keep readable text only. */
async function fetchPageText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Страница недоступна (${response.status}). Проверьте ссылку.`);
  }
  const html = await response.text();
  return truncate(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
    MAX_URL_CHARS,
  );
}

export const importSource = action({
  args: {
    /** Pasted link: figma / v0 / lovable / any page. */
    url: v.optional(v.string()),
    /** Already-uploaded attachment (pdf or screenshot). */
    attachmentId: v.optional(v.id("attachments")),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, { url, attachmentId, modelId }): Promise<{ prompt: string; source: string }> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

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

    /* URL path ---------------------------------------------------------- */
    if (url?.trim()) {
      const source = classifyUrl(url);
      if (source.kind === "unknown") {
        throw new Error(
          "Ссылка не распознана. Поддерживаются Figma, v0.dev, lovable.dev и любые http(s)-страницы.",
        );
      }

      if (source.kind === "figma") {
        // REST structure when a token exists, else the public share page.
        const token = process.env.FIGMA_TOKEN?.trim();
        let detail = "";
        if (token && source.figmaFileKey) {
          const node = source.figmaNodeId ? `&ids=${encodeURIComponent(source.figmaNodeId)}` : "";
          const apiResponse = await fetch(
            `https://api.figma.com/v1/files/${source.figmaFileKey}?depth=4${node}`,
            { headers: { "X-Figma-Token": token } },
          );
          if (apiResponse.ok) {
            const data = (await apiResponse.json()) as {
              name?: string;
              document?: { children?: Array<{ name?: string; type?: string }> };
            };
            const tree = (data.document?.children ?? [])
              .map((child) => `- ${child.type}: ${child.name}`)
              .join("\n");
            detail = `Файл Figma: ${data.name ?? source.figmaFileKey}\nСтруктура:\n${tree}`;
          }
        }
        if (!detail) {
          const page = await fetchPageText(source.url!);
          detail = `Публичная страница Figma (название файла и превью):\n${page.slice(0, 3000)}`;
        }
        const summary = await summarizeWithModel(
          ctx,
          user._id,
          target,
          apiModel,
          FIGMA_IMPORT_SYSTEM,
          detail,
        );
        return {
          prompt: formatImportContext(source, summary),
          source: describeSource(source),
        };
      }

      // v0 / lovable / any page: fetch readable text.
      const page = await fetchPageText(source.url!);
      const summary = await summarizeWithModel(
        ctx,
        user._id,
        target,
        apiModel,
        URL_IMPORT_SYSTEM,
        page,
      );
      return {
        prompt: formatImportContext(source, summary),
        source: describeSource(source),
      };
    }

    /* File path ---------------------------------------------------------- */
    if (attachmentId) {
      const file = await readAttachment(ctx, attachmentId);
      if (!file) throw new Error("Файл не найден или уже удалён.");

      const classified = classifyFile(file.name, file.mimeType);
      if (classified.kind === "pdf") {
        const text = extractPdfText(file.bytes);
        if (!isUsableSpec(text)) {
          // Scanned pdf without a text layer — let the vision model try later;
          // here we are honest about the limit.
          throw new Error(
            "В PDF не найден текстовый слой (скан?). Загрузите скриншоты страниц или текстовый PDF.",
          );
        }
        const source: ImportSource = { kind: "pdf" };
        return {
          prompt: formatImportContext(
            { kind: "pdf", label: file.name },
            `Документ: ${file.name}\n\n${text}`,
          ),
          source: describeSource(source),
        };
      }
      if (classified.kind === "screenshot") {
        const summary = await summarizeImage(
          ctx,
          user._id,
          target,
          apiModel,
          file.mimeType,
          file.bytes,
        );
        return {
          prompt: formatImportContext({ kind: "screenshot", label: file.name }, summary),
          source: describeSource({ kind: "screenshot" }),
        };
      }
      if (classified.kind === "v0") {
        // Code export: no model round-trip — the sources are already prompts.
        const text = new TextDecoder().decode(file.bytes.subarray(0, MAX_URL_CHARS));
        return {
          prompt: formatImportContext(
            { kind: "v0", label: file.name },
            `Файл: ${file.name}\n\n${text}`,
          ),
          source: describeSource({ kind: "v0" }),
        };
      }
      throw new Error("Тип файла не поддерживается для импорта.");
    }

    throw new Error("Укажите ссылку или файл импорта.");
  },
});
