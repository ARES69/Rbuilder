import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getModel, getProvider } from "../lib/models";
import {
  DEFAULT_USD_RUB_RATE,
  estimateCostRub,
  missingKeyMessage,
  resolveProviderEndpoint,
} from "../lib/providers";
import {
  DAY_MS,
  EDIT_PROMPT,
  HOUR_MS,
  MAX_REVIEW_ROUNDS,
  REVIEW_PROMPT,
  applyEdits,
  describeModelError,
  hasEditWork,
  parseEditResponse,
  extractProjectFiles,
  formatProjectContext,
  isRetryableStatus,
  parseReview,
  selectRelevantFiles,
  truncate,
  type GeneratedFile,
} from "../lib/generation-core";
import { decideRateLimit } from "./usage";
import { formatUserPatterns } from "../lib/patterns";
import type { FileChange } from "../lib/generation-core";
import { architectureContract } from "../lib/architecture";
import { buildResearchQuery, formatResearch } from "../lib/research";
import { defaultEnabledToolIds, hasTool, toolDirectives } from "../lib/tools";

const MAX_ATTACHMENT_CHARS = 12_000;
const MAX_HTML_CHARS = 400_000;
/** How much existing code goes back into the prompt. */
const MAX_CONTEXT_CHARS = 120_000;

interface TraceEntry {
  agent: string;
  note?: string;
  ms: number;
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * What a build returns. Declared explicitly so the public action and the shared
 * pipeline do not type each other in a circle (TS7022).
 */
export interface GenerationResult {
  html: string;
  files?: GeneratedFile[];
  demo: boolean;
  /** Present on the demo path: why the selected model could not be used. */
  notice?: string;
  trace: TraceEntry[];
  changes?: FileChange[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    costRub: number | null;
    provider: string;
    apiModel: string;
  };
}

interface Target {
  chatUrl: string;
  apiKey: string;
  providerLabel: string;
}

const CONTEXT_PROMPT = `You are the context agent in a web-app building pipeline. Given the user's request and optional attached files, produce a concise brief: what kind of app is needed, key screens/features, and any requirements from the attachments. Reply in 3-6 bullet points. No preamble.`;

const PLAN_PROMPT = `You are the planner agent in a web-app building pipeline. Given a brief and the current app code (if any), decide the implementation steps. Reply with 3-6 short imperative steps, one per line, no numbering. Focus on what changes and what stays intact.`;

const BUILD_PROMPT = `You are RBuilder, an expert web app builder. Return a complete working project as a JSON file manifest.

STRICT OUTPUT RULES:
1. Output ONLY valid JSON. No markdown fences, no explanation, no commentary.
2. Use this exact shape: {"files":[{"path":"index.html","content":"...","language":"html"}]}. Always include index.html.
3. You may include additional files such as src/App.tsx, src/styles.css, package.json and README.md when they make the project clearer. Each file must be complete.
4. index.html must be directly previewable: include a complete document with inline styles/scripts when the project does not have a build setup.
5. Make it beautiful: intentional typography, spacing, a restrained color palette, hover states, and responsive layout.
6. Fully implement the described functionality — working state, event handlers, and realistic seed data. Never leave stubs.

If previous files are provided, treat them as the current code and change only what the plan requires, keeping everything else byte-identical.`;

const PLANNING_PROMPT = `You are the solution architect for RBuilder. Analyze the user's product request and return a concise Russian project plan with exactly these sections:
Цель:
Пользователи:
Экраны:
Данные:
Интеграции:
Этапы:
Риски:
Use concrete names, avoid generic filler, and keep the whole answer under 1800 characters.`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fallbackPlan(prompt: string): string {
  return `Цель:\nСоздать рабочее веб-приложение по запросу пользователя.\n\nПользователи:\nОпределяются ролями и сценариями из запроса.\n\nЭкраны:\nГлавный экран, рабочий раздел, настройки и состояния загрузки/ошибок.\n\nДанные:\nОсновные сущности приложения, записи пользователя и настройки проекта.\n\nИнтеграции:\nПодключать только те сервисы, которые нужны запросу: API-ключи хранятся на сервере.\n\nЭтапы:\n1. Создать структуру экранов.\n2. Добавить состояние и основные действия.\n3. Подключить данные и интеграции.\n4. Проверить адаптивность и ошибки.\n\nРиски:\nНужно уточнить роли, реальные источники данных и требования к публикации.\n\nЗапрос:\n${prompt}`;
}

/** Deterministic fallback app shown when the selected provider has no key. */
function fallbackHtml(prompt: string, reason: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Предпросмотр</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #fafafa; color: #171717;
    min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 560px; width: 100%; border: 1px solid #e5e5e5; border-radius: 12px; padding: 40px; background: #fff; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin-top: 12px; font-size: 14px; line-height: 1.6; color: #737373; }
  .prompt { margin-top: 20px; padding: 14px 16px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 8px;
    font-size: 13px; line-height: 1.5; color: #404040; white-space: pre-wrap; }
  code { font-size: 12px; background: #f5f5f5; padding: 2px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Предпросмотр приложения</h1>
    <p>${escapeHtml(reason)}</p>
    <div class="prompt">${escapeHtml(prompt)}</div>
  </div>
</body>
</html>`;
}

/** Timers exist in the Convex action runtime; degrade to no delay if absent. */
async function sleep(ms: number): Promise<void> {
  if (typeof setTimeout !== "function") return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One model call, with retry on transient failures.
 *
 * Failures are translated into readable messages — the provider body is never
 * forwarded, because it leaks keys and internal URLs and is unreadable anyway.
 */
async function callModel(
  target: Target,
  apiModel: string,
  system: string,
  user: string,
  maxTokens: number,
  options?: { json?: boolean },
): Promise<{ text: string; usage: Usage }> {
  let lastError: Error | null = null;
  const attempts = 2;
  // `response_format` is not supported by every OpenAI-compatible gateway, so
  // it is dropped and the request repeated rather than failing the build.
  let useJson = Boolean(options?.json);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const body = JSON.stringify({
      model: apiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
      ...(useJson ? { response_format: { type: "json_object" } } : {}),
    });
    let response: Response;
    try {
      response = await fetch(target.chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
        },
        body,
      });
    } catch {
      lastError = new Error(
        `Не удалось связаться с ${target.providerLabel}. Проверьте соединение и повторите.`,
      );
      if (attempt < attempts - 1) await sleep(600 * (attempt + 1));
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (useJson && (response.status === 400 || response.status === 422)) {
        useJson = false;
        continue;
      }
      const message = describeModelError(
        response.status,
        target.providerLabel,
        detail,
      );
      if (isRetryableStatus(response.status) && attempt < attempts - 1) {
        lastError = new Error(message);
        // Rate limits need a real pause; provider hiccups just need a beat.
        await sleep(response.status === 429 ? 2_000 : 800);
        continue;
      }
      throw new Error(message);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  throw lastError ?? new Error("Модель не ответила. Попробуйте ещё раз.");
}

const previousFilesValidator = v.optional(
  v.array(
    v.object({
      path: v.string(),
      content: v.string(),
      language: v.optional(v.string()),
    }),
  ),
);

export const plan = action({
  args: {
    prompt: v.string(),
    modelId: v.optional(v.string()),
    architectureId: v.optional(v.string()),
  },
  handler: async (ctx, { prompt, modelId, architectureId }) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

    const model = getModel(modelId);
    const provider = getProvider(model.provider);
    const endpoint = resolveProviderEndpoint(provider, (name) => process.env[name]);
    if (!endpoint.apiKey) {
      return { plan: fallbackPlan(prompt), demo: true, model: model.apiModel };
    }
    const contract = architectureContract(architectureId);
    const result = await callModel(
      {
        chatUrl: endpoint.chatUrl,
        apiKey: endpoint.apiKey,
        providerLabel: provider.label,
      },
      apiModelFor(model.provider, model.apiModel),
      PLANNING_PROMPT,
      `${contract}\n\nЗапрос пользователя:\n${prompt}`,
      900,
    );
    return {
      plan: result.text.trim() || fallbackPlan(prompt),
      demo: false,
      model: model.apiModel,
    };
  },
});

/** The local provider's model id is a deployment setting, not a catalog fact. */
function apiModelFor(provider: string, apiModel: string): string {
  if (provider === "local") return process.env.LOCAL_MODEL_ID ?? apiModel;
  return apiModel;
}

const generationArgs = {
  prompt: v.string(),
  modelId: v.optional(v.string()),
  architectureId: v.optional(v.string()),
  projectId: v.optional(v.id("projects")),
  previousHtml: v.optional(v.string()),
  /** Canonical source of the current code — preferred over `previousHtml`. */
  previousFiles: previousFilesValidator,
  attachmentIds: v.optional(v.array(v.id("attachments"))),
  /** Enabled skill prompt modules (from the Skills tab). */
  skillPrompts: v.optional(v.array(v.string())),
  /** Enabled tool ids (from the Tools tab). */
  toolIds: v.optional(v.array(v.string())),
  /** Agent run row to stream progress into (from the Workspaces panel). */
  runId: v.optional(v.id("agentRuns")),
};

/**
 * The pipeline, for an explicit user.
 *
 * The session-based action below and the public API both funnel through here,
 * so an API key gets exactly the same pipeline, limits and accounting as the
 * signed-in UI — no second implementation to keep in sync.
 */
export const runForUser = internalAction({
  args: {
    userId: v.id("users"),
    ...generationArgs,
  },
  handler: async (
    ctx,
    {
      userId,
      prompt,
      modelId,
      architectureId,
      projectId,
      previousHtml,
      previousFiles,
      attachmentIds,
      skillPrompts,
      toolIds,
      runId,
    },
  ): Promise<GenerationResult> => {
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user) throw new Error("Пользователь не найден");

    const model = getModel(modelId);
    const provider = getProvider(model.provider);
    const endpoint = resolveProviderEndpoint(provider, (name) => process.env[name]);
    const apiModel = apiModelFor(model.provider, model.apiModel);
    const target: Target = {
      chatUrl: endpoint.chatUrl,
      apiKey: endpoint.apiKey,
      providerLabel: provider.label,
    };
    const contract = architectureContract(architectureId);
    const total: Usage = { promptTokens: 0, completionTokens: 0 };
    const changes: FileChange[] = [];

    const trace: TraceEntry[] = [];
    /** Announce the stage that is about to run (live progress in the UI). */
    const begin = async (agent: string, note: string) => {
      if (!runId) return;
      await ctx.runMutation(internal.workspaces.progress, {
        runId,
        step: `${agent} · ${note}`,
      });
    };
    /** Close a stage and append it to the trace. */
    const end = async (agent: string, note: string, startedAt: number) => {
      const entry: TraceEntry = { agent, note, ms: Date.now() - startedAt };
      trace.push(entry);
      if (runId) {
        await ctx.runMutation(internal.workspaces.progress, { runId, entry });
      }
    };
    const call = async (
      system: string,
      user: string,
      maxTokens: number,
      options?: { json?: boolean },
    ) => {
      const result = await callModel(target, apiModel, system, user, maxTokens, options);
      total.promptTokens += result.usage.promptTokens;
      total.completionTokens += result.usage.completionTokens;
      return result.text;
    };
    /**
     * Reviewer call. Strict JSON is requested for reliability, but not every
     * OpenAI-compatible gateway supports `response_format` — if it is rejected
     * we retry without it and let the parser handle prose, instead of failing
     * a whole build over an optional parameter.
     */
    const callReview = (user: string) =>
      call(REVIEW_PROMPT, user, 600, { json: true });

    // Enabled skills are appended to the builder instructions
    const skillsBlock =
      skillPrompts && skillPrompts.length > 0
        ? `\n\nENABLED SKILLS (follow strictly):\n${skillPrompts.map((s) => `- ${s}`).join("\n")}`
        : "";

    // Enabled tools: directives for the prompts, plus stage toggles for the
    // tools that own a pipeline stage (thinker → planning, reviewer → review).
    const activeTools = toolIds ?? defaultEnabledToolIds();
    const directives = toolDirectives(activeTools);
    const toolsBlock =
      directives.length > 0
        ? `\n\nENABLED TOOLS (follow strictly):\n${directives.map((d) => `- ${d}`).join("\n")}`
        : "";
    const usePlanner = hasTool(activeTools, "thinker");
    const useReviewer = hasTool(activeTools, "reviewer");

    // Collect text attachment contents so the model can use uploaded files.
    const attachmentContext: string[] = [];
    if (attachmentIds?.length) {
      for (const id of attachmentIds.slice(0, 5)) {
        const meta = await ctx.runQuery(api.attachments.getForGeneration, {
          attachmentId: id,
        });
        if (!meta) continue;
        // Only text-shaped attachments are inlined. Dumping a PNG through
        // `blob.text()` would paste binary noise into the prompt.
        const isText =
          meta.mimeType.startsWith("text/") ||
          /(json|javascript|typescript|xml|svg|csv|yaml|markdown|sql)/.test(meta.mimeType);
        if (meta.storageId && isText) {
          const blob = await ctx.storage.get(meta.storageId);
          if (blob) {
            attachmentContext.push(
              `--- ${meta.name} ---\n${truncate(await blob.text(), MAX_ATTACHMENT_CHARS)}`,
            );
          }
        } else {
          attachmentContext.push(
            `--- ${meta.name} (${meta.mimeType}, прикреплён без чтения содержимого) ---`,
          );
        }
      }
    }

    // The model the user picked must actually be reachable. Without a key we
    // say exactly what is missing instead of quietly answering with another
    // provider's model (which used to surface as a confusing 404).
    if (!endpoint.apiKey) {
      return {
        html: truncate(
          fallbackHtml(prompt, missingKeyMessage(provider, endpoint)),
          MAX_HTML_CHARS,
        ),
        demo: true,
        notice: missingKeyMessage(provider, endpoint),
        trace: [{ agent: "builder", note: `нет ключа ${provider.label}`, ms: 0 }],
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          costRub: null,
          provider: provider.id,
          apiModel,
        },
      };
    }

    // Abuse guard: guests are capped hard, signed-in users get a rolling hour.
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      ctx.runQuery(internal.usage.countSince, {
        userId: user._id,
        since: now - HOUR_MS,
      }),
      ctx.runQuery(internal.usage.countSince, {
        userId: user._id,
        since: now - DAY_MS,
      }),
    ]);
    const verdict = decideRateLimit({
      isAnonymous: Boolean(user.isAnonymous),
      lastHour,
      lastDay,
    });
    if (!verdict.allowed) {
      throw new Error(verdict.reason ?? "Слишком много генераций. Попробуйте позже.");
    }

    // Current code: prefer real files and only send what this request needs —
    // replaying a whole project into every prompt is what made edits expensive.
    const storedFiles =
      !previousFiles?.length && projectId
        ? await ctx.runQuery(api.projectFiles.list, { projectId })
        : [];
    const currentFiles: GeneratedFile[] = previousFiles?.length
      ? previousFiles
      : storedFiles.length
        ? storedFiles
        : previousHtml
          ? [{ path: "index.html", content: previousHtml, language: "html" }]
          : [];
    const selectedFiles = selectRelevantFiles(currentFiles, prompt, MAX_CONTEXT_CHARS);
    const currentContext = selectedFiles.length
      ? formatProjectContext(selectedFiles)
      : "";

    // Stage 1 — context agent
    let startedAt = Date.now();
    await begin("context", "разбираю запрос");
    const brief = await call(
      CONTEXT_PROMPT,
      [
        attachmentContext.length
          ? `Attached files:\n${attachmentContext.join("\n\n")}`
          : null,
        contract,
        `Request:\n${prompt}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      500,
    );
    await end("context", "запрос разобран", startedAt);

    // Stage 1.5 — researcher (only when the `web_search` tool is on). Fetches
    // real sources so the build is grounded instead of invented; `read_url`
    // additionally reads the top result pages. Failures never break a build.
    let research = "";
    if (hasTool(activeTools, "web_search")) {
      startedAt = Date.now();
      await begin("researcher", "ищу источники");
      try {
        const digest = await ctx.runAction(internal.research.search, {
          query: buildResearchQuery(prompt),
          readPages: hasTool(activeTools, "read_url"),
        });
        if (digest.sources.length > 0) {
          research = formatResearch(digest);
          await end(
            "researcher",
            `${digest.provider}: ${digest.sources.length} источников`,
            startedAt,
          );
        } else {
          await end("researcher", "источники не найдены", startedAt);
        }
      } catch {
        await end("researcher", "research unavailable", startedAt);
      }
    }

    // Stage 2 — planner agent (skipped when the `thinker` tool is off)
    let plan = "";
    if (usePlanner) {
      startedAt = Date.now();
      await begin("planner", "составляю план");
      plan = await call(
        PLAN_PROMPT,
        [
          `Brief:\n${brief}`,
          research ? `Web research:\n${research}` : null,
          currentFiles.length
            ? `Current app code exists (${selectedFiles.length} из ${currentFiles.length} файлов в контексте) — plan only the changes.`
            : "Brand new app — plan the full build.",
          `Request:\n${prompt}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        500,
      );
      await end("planner", "план готов", startedAt);
    } else {
      trace.push({ agent: "planner", note: "пропущен (thinker выключен)", ms: 0 });
    }

    /**
     * Produce project files from a prompt.
     *
     * With an existing project the model returns patches and we apply them, so
     * an edit costs a fraction of a rebuild and a file it does not name can not
     * be damaged. If the patch does not land we fall back to a full rebuild
     * once — correctness first, cost second.
     */
    // Preferences learned from this user's own manual edits. Injected into
    // every stage that writes code.
    const learned = await ctx.runQuery(internal.patterns.forPrompt, {
      userId: user._id,
    });
    const patternsBlock = learned.length > 0 ? `\n\n${formatUserPatterns(learned)}` : "";

    const produceFiles = async (
      input: string,
      editable: GeneratedFile[],
    ): Promise<{ files: GeneratedFile[]; note: string }> => {
      const system = `${contract}${skillsBlock}${toolsBlock}${patternsBlock}`;
      if (editable.length > 0) {
        const editRaw = await call(`${EDIT_PROMPT}\n\n${system}`, input, 16000, {
          json: true,
        });
        const plan = parseEditResponse(editRaw);
        if (hasEditWork(plan)) {
          const result = applyEdits(editable, plan);
          if (result.applied > 0) {
            changes.push(...result.changes);
            return {
              files: result.files,
              note:
                result.failed.length > 0
                  ? `правки: ${result.applied} применено, ${result.failed.length} не легло`
                  : `правки: ${result.applied} применено`,
            };
          }
        }
      }
      const raw = await call(`${BUILD_PROMPT}\n\n${system}`, input, 16000);
      return {
        files: extractProjectFiles(raw),
        note: editable.length > 0 ? "полная пересборка" : "проект собран",
      };
    };

    // Stage 3 — builder agent
    startedAt = Date.now();
    await begin("builder", currentFiles.length ? "правлю код" : "пишу код");
    const buildInput = [
      attachmentContext.length
        ? `Attached files:\n${attachmentContext.join("\n\n")}`
        : null,
      `Brief:\n${brief}`,
      research
        ? `Web research (real sources — use these facts, prices and names instead of inventing them):\n${research}`
        : null,
      plan ? `Plan:\n${plan}` : null,
      currentContext
        ? `Current project files:\n${currentContext}`
        : "This is a brand new app — no previous version exists yet.",
      `Request:\n${prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const built = await produceFiles(buildInput, currentFiles);
    let files = built.files
      .map((file) => ({ ...file, path: file.path.trim().replace(/^\/+/, "") }))
      .filter((file) => file.path && !file.path.includes(".."));
    let html = files.find((file) => file.path === "index.html")?.content ?? "";
    if (!html) {
      throw new Error("Модель вернула пустой ответ. Попробуйте ещё раз.");
    }
    await end("builder", `${built.note} (${html.length} символов)`, startedAt);

    // Stage 4 — reviewer agent: review, repair, re-review (bounded).
    if (!useReviewer) {
      trace.push({ agent: "reviewer", note: "пропущен (reviewer выключен)", ms: 0 });
    } else {
      startedAt = Date.now();
      await begin("reviewer", "проверяю результат");
      let review = parseReview(
        await callReview(
          [plan ? `Plan:\n${plan}` : null, `App HTML:\n${truncate(html, 120_000)}`]
            .filter(Boolean)
            .join("\n\n"),
        ),
      );

      for (let round = 0; round < MAX_REVIEW_ROUNDS && review.verdict === "fix"; round += 1) {
        await begin("reviewer", `правлю замечания (${round + 1}/${MAX_REVIEW_ROUNDS})`);
        const fixInput = [
          `Current project files:\n${formatProjectContext(
            selectRelevantFiles(files, review.issues.join(" "), MAX_CONTEXT_CHARS),
          )}`,
          `Reviewer issues (fix every one):\n${review.issues.map((issue) => `- ${issue}`).join("\n")}`,
          `Original request:\n${prompt}`,
        ].join("\n\n");
        const repaired = await produceFiles(fixInput, files);
        const repairedHtml =
          repaired.files.find((file) => file.path === "index.html")?.content ?? "";
        if (repairedHtml && repairedHtml !== html) {
          html = repairedHtml;
          files = repaired.files;
        } else {
          break;
        }
        review = parseReview(
          await callReview(
            [
              plan ? `Plan:\n${plan}` : null,
              `App HTML:\n${truncate(html, 120_000)}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
      }

      await end(
        "reviewer",
        review.verdict === "ok"
          ? "проверка пройдена"
          : `остались замечания: ${review.issues.length}`,
        startedAt,
      );
    }

    // Accounting: one row per build so cost is visible inside RBuilder.
    const parsedRate = Number(process.env.USD_RUB_RATE ?? DEFAULT_USD_RUB_RATE);
    const usdRubRate = Number.isFinite(parsedRate) ? parsedRate : DEFAULT_USD_RUB_RATE;
    const costRub = estimateCostRub(
      apiModel,
      total.promptTokens,
      total.completionTokens,
      usdRubRate,
    );
    await ctx.runMutation(internal.usage.record, {
      userId: user._id,
      projectId,
      provider: provider.id,
      apiModel,
      promptTokens: total.promptTokens,
      completionTokens: total.completionTokens,
      costRub,
      anonymous: Boolean(user.isAnonymous),
      createdAt: Date.now(),
    });

    return {
      html: truncate(html, MAX_HTML_CHARS),
      files: files.map((file) => ({
        ...file,
        content:
          file.path === "index.html"
            ? truncate(file.content, MAX_HTML_CHARS)
            : file.content,
      })),
      demo: false,
      trace,
      changes,
      usage: {
        promptTokens: total.promptTokens,
        completionTokens: total.completionTokens,
        costRub,
        provider: provider.id,
        apiModel,
      },
    };
  },
});

/** Session-based entry point used by the app UI. */
export const run = action({
  args: generationArgs,
  handler: async (ctx, args): Promise<GenerationResult> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");
    return await ctx.runAction(internal.generation.runForUser, {
      userId: user._id,
      ...args,
    });
  },
});
