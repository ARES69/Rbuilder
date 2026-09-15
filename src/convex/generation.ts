import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MAX_ATTACHMENT_CHARS = 12_000;
const MAX_HTML_CHARS = 400_000;

const SYSTEM_PROMPT = `You are Freebuff, an expert web app builder. The user describes an app; you return a complete, working single-file web app.

STRICT OUTPUT RULES:
1. Output ONLY raw HTML. No markdown fences, no explanation, no commentary.
2. The document must be fully self-contained: inline <style> and <script> only. No external requests except Google Fonts.
3. Start with <!DOCTYPE html> and include <html>, <head> with <meta charset>, <meta viewport>, and <title>, then <body>.
4. Make it beautiful: intentional typography, spacing, a restrained color palette, hover states, and responsive layout. Vanilla JS is fine.
5. Fully implement the described functionality — working state, event handlers, and realistic seed data. Never leave stubs.

If a previous version of the app is provided, treat it as the current code and apply the requested change, keeping everything else intact.`;

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

/** Deterministic fallback app shown when no OPENAI_API_KEY is configured. */
function fallbackHtml(prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Preview</title>
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
    <h1>Your app preview</h1>
    <p>This sandbox renders exactly what the agent writes — a single self-contained HTML file, rebuilt live on every prompt. Generation is running in demo mode; add an <code>OPENAI_API_KEY</code> in the Keys tab to build real apps.</p>
    <div class="prompt">${escapeHtml(prompt)}</div>
  </div>
</body>
</html>`;
}

export const run = action({
  args: {
    prompt: v.string(),
    previousHtml: v.optional(v.string()),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
  },
  handler: async (ctx, { prompt, previousHtml, attachmentIds }) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

    const apiKey = process.env.OPENAI_API_KEY;

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
      };
    }

    const userContent = [
      attachmentContext.length
        ? `Attached files:\n${attachmentContext.join("\n\n")}`
        : null,
      previousHtml
        ? `Current app code:\n${truncate(previousHtml, MAX_HTML_CHARS)}`
        : "This is a brand new app — no previous version exists yet.",
      `Request:\n${prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
        max_tokens: 16000,
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
    const raw = data.choices?.[0]?.message?.content ?? "";
    const html = extractHtml(raw);
    if (!html) {
      throw new Error("The model returned an empty response. Please try again.");
    }

    return { html: truncate(html, MAX_HTML_CHARS), demo: false };
  },
});
