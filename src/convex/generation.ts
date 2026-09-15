import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { getModel } from "../lib/models";
import {
  defaultEnabledToolIds,
  hasTool,
  toolDirectives,
} from "../lib/tools";

/**
 * Any OpenAI-compatible endpoint works here — critical for RF users:
 * DeepSeek (api.deepseek.com/v1), GLM (open.bigmodel.cn/api/paas/v4),
 * GigaChat-compat proxies, local gateways, etc. Billing in rubles,
 * no foreign card needed. Only the path `/chat/completions` is appended.
 */
const OPENAI_BASE_URL =
  (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_CHAT_URL = `${OPENAI_BASE_URL}/chat/completions`;
const MAX_ATTACHMENT_CHARS = 12_000;
const MAX_HTML_CHARS = 400_000;

interface TraceEntry {
  agent: string;
  note?: string;
  ms: number;
}

const CONTEXT_PROMPT = `You are the context agent in a web-app building pipeline. Given the user's request and optional attached files, produce a concise brief: what kind of app is needed, key screens/features, and any requirements from the attachments. Reply in 3-6 bullet points. No preamble.`;

const PLAN_PROMPT = `You are the planner agent in a web-app building pipeline. Given a brief and the current app code (if any), decide the implementation steps. Reply with 3-6 short imperative steps, one per line, no numbering. Focus on what changes and what stays intact.`;

const BUILD_PROMPT = `You are RBuilder, an expert web app builder. The user describes an app; you return a complete, working single-file web app.

STRICT OUTPUT RULES:
1. Output ONLY raw HTML. No markdown fences, no explanation, no commentary.
2. The document must be fully self-contained: inline <style> and <script> only. No external requests except Google Fonts.
3. Start with <!DOCTYPE html> and include <html>, <head> with <meta charset>, <meta viewport>, and <title>, then <body>.
4. Make it beautiful: intentional typography, spacing, a restrained color palette, hover states, and responsive layout. Vanilla JS is fine.
5. Fully implement the described functionality — working state, event handlers, and realistic seed data. Never leave stubs.

If a previous version of the app is provided, treat it as the current code and apply the plan, keeping everything else intact.`;

const REVIEW_PROMPT = `You are the reviewer agent in a web-app building pipeline. You receive an app's HTML and the plan it was built from. Check it for: broken structure, missing functionality versus the plan, stubs or placeholder text, script errors. Reply with either "OK" if acceptable, or a one-paragraph fix list starting with "FIX:".`;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n<!-- truncated -->`;
}

function extractHtml(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const doc = body.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  return (doc ? doc[0] : body).trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Deterministic fallback app shown when no model API key is configured. */
function fallbackHtml(prompt: string): string {
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
    <p>Здесь рендерится ровно то, что пишет конвейер агентов — один самодостаточный HTML-файл, пересобираемый после каждого запроса. Сейчас работает демо-режим: добавьте <code>OPENAI_API_KEY</code> (или любой совместимый провайдер через <code>OPENAI_BASE_URL</code>, например DeepSeek) во вкладке «API-ключи», и каждый билд станет настоящим приложением. RBuilder полностью бесплатен.</p>
    <div class="prompt">${escapeHtml(prompt)}</div>
  </div>
</body>
</html>`;
}

async function callModel(
  apiKey: string,
  apiModel: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Model request failed (${response.status}). ${detail.slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export const run = action({
  args: {
    prompt: v.string(),
    modelId: v.optional(v.string()),
    previousHtml: v.optional(v.string()),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
    /** Enabled skill prompt modules (from the Skills tab). */
    skillPrompts: v.optional(v.array(v.string())),
    /** Enabled tool ids (from the Tools tab). */
    toolIds: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    { prompt, modelId, previousHtml, attachmentIds, skillPrompts, toolIds },
  ) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

    const model = getModel(modelId);
    const apiKey = process.env.OPENAI_API_KEY;
    const trace: TraceEntry[] = [];

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
        if (meta.storageId) {
          const blob = await ctx.storage.get(meta.storageId);
          if (blob) {
            attachmentContext.push(
              `--- ${meta.name} ---\n${truncate(await blob.text(), MAX_ATTACHMENT_CHARS)}`,
            );
          }
        } else {
          attachmentContext.push(`--- ${meta.name} (attached) ---`);
        }
      }
    }

    if (!apiKey) {
      return {
        html: truncate(fallbackHtml(prompt), MAX_HTML_CHARS),
        demo: true,
        trace: [{ agent: "builder", note: "demo mode", ms: 0 }],
      };
    }

    // Stage 1 — context agent
    let t0 = Date.now();
    const brief = await callModel(
      apiKey,
      model.apiModel,
      CONTEXT_PROMPT,
      [
        attachmentContext.length
          ? `Attached files:\n${attachmentContext.join("\n\n")}`
          : null,
        `Request:\n${prompt}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      500,
    );
    trace.push({ agent: "context", note: "mapped the request", ms: Date.now() - t0 });

    // Stage 2 — planner agent (skipped when the `thinker` tool is off)
    let plan = "";
    if (usePlanner) {
      t0 = Date.now();
      plan = await callModel(
        apiKey,
        model.apiModel,
        PLAN_PROMPT,
        [
          `Brief:\n${brief}`,
          previousHtml
            ? `Current app code exists (${previousHtml.length} chars) — plan only the changes.`
            : "Brand new app — plan the full build.",
          `Request:\n${prompt}`,
        ].join("\n\n"),
        500,
      );
      trace.push({
        agent: "planner",
        note: "drafted the build plan",
        ms: Date.now() - t0,
      });
    } else {
      trace.push({ agent: "planner", note: "skipped (thinker off)", ms: 0 });
    }

    // Stage 3 — builder agent
    t0 = Date.now();
    const buildInput = [
      attachmentContext.length
        ? `Attached files:\n${attachmentContext.join("\n\n")}`
        : null,
      `Brief:\n${brief}`,
      plan ? `Plan:\n${plan}` : null,
      previousHtml
        ? `Current app code:\n${truncate(previousHtml, MAX_HTML_CHARS)}`
        : "This is a brand new app — no previous version exists yet.",
      `Request:\n${prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const raw = await callModel(
      apiKey,
      model.apiModel,
      `${BUILD_PROMPT}${skillsBlock}${toolsBlock}`,
      buildInput,
      16000,
    );
    let html = extractHtml(raw);
    if (!html) {
      throw new Error("The model returned an empty response. Please try again.");
    }
    trace.push({
      agent: "builder",
      note: `wrote v${(previousHtml?.length ?? 0) > 0 ? "update" : "1"} (${html.length} chars)`,
      ms: Date.now() - t0,
    });

    // Stage 4 — reviewer agent (one repair pass when it flags problems)
    t0 = Date.now();
    if (!useReviewer) {
      trace.push({ agent: "reviewer", note: "skipped (reviewer off)", ms: 0 });
      return { html: truncate(html, MAX_HTML_CHARS), demo: false, trace };
    }
    const review = await callModel(
      apiKey,
      model.apiModel,
      REVIEW_PROMPT,
      [plan ? `Plan:\n${plan}` : null, `App HTML:\n${truncate(html, 120_000)}`]
        .filter(Boolean)
        .join("\n\n"),
      600,
    );
    if (review.trim().toUpperCase().startsWith("FIX:")) {
      const fixInput = [
        `Current app code:\n${truncate(html, MAX_HTML_CHARS)}`,
        `Reviewer notes:\n${review.trim()}`,
        `Original request:\n${prompt}`,
        `Apply the fixes and return the complete corrected HTML file. Raw HTML only.`,
      ].join("\n\n");
      const repaired = await callModel(
        apiKey,
        model.apiModel,
        `${BUILD_PROMPT}${skillsBlock}${toolsBlock}`,
        fixInput,
        16000,
      );
      const repairedHtml = extractHtml(repaired);
      if (repairedHtml) html = repairedHtml;
      trace.push({ agent: "reviewer", note: "requested fixes, rebuilt", ms: Date.now() - t0 });
    } else {
      trace.push({ agent: "reviewer", note: "approved the build", ms: Date.now() - t0 });
    }

    return { html: truncate(html, MAX_HTML_CHARS), demo: false, trace };
  },
});
