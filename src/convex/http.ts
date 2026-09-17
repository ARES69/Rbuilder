import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import { decideRateLimit } from "./usage";
import { DAY_MS, HOUR_MS } from "../lib/generation-core";
import { MODELS, getModel } from "../lib/models";
import { publishUrl, siteBaseUrl } from "../lib/deploy";
import {
  corsHeaders,
  hashApiKey,
  jsonResponse,
  parseBearer,
  parseGenerateBody,
} from "../lib/public-api";

const http = httpRouter();

auth.addHttpRoutes(http);

function webhookKeyOf(url: URL): string {
  return url.pathname.split("/").pop() ?? "";
}

/**
 * Incoming webhooks from external services.
 * URL format: /webhooks/{webhookKey of a connection}
 *
 * Compatible with Битрикс24 outbound webhooks, VK Callback API,
 * Т-Банк notification URL and any service that can POST JSON or form data.
 */
http.route({
  path: "/webhooks/{key}",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = webhookKeyOf(url);
    const connection = await ctx.runQuery(api.serviceConnections.getByWebhookKey, {
      webhookKey: key,
    });
    if (!connection) {
      return new Response(JSON.stringify({ ok: false, error: "unknown webhook key" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    let payload: unknown = { raw: "unparseable body" };
    const contentType = request.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        payload = await request.json();
      } else if (contentType.includes("x-www-form-urlencoded")) {
        const entries: Record<string, string> = {};
        for (const [name, value] of new URLSearchParams(await request.text())) {
          entries[name] = value;
        }
        payload = entries;
      } else {
        payload = { text: await request.text() };
      }
    } catch {
      payload = { raw: "unparseable body" };
    }

    let event = "webhook";
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (typeof record.event === "string" && record.event) {
        event = record.event;
      } else if (typeof record.event_name === "string" && record.event_name) {
        event = record.event_name;
      } else if (typeof record.type === "string" && record.type) {
        event = record.type;
      }
    }

    await ctx.runMutation(internal.serviceConnections.recordEvent, {
      userId: connection.userId,
      connectionId: connection._id,
      serviceId: connection.serviceId,
      event,
      payload,
    });

    // VK Callback API confirmation handshake
    const isVkConfirmation =
      payload !== null &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).type === "confirmation";
    if (isVkConfirmation) {
      return new Response("ok", { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>404</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#171717;
min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:24px}
div{max-width:420px;text-align:center}h1{font-size:18px;margin:0 0 8px}
p{font-size:14px;line-height:1.6;color:#737373;margin:0}</style></head>
<body><div><h1>Такой страницы нет</h1>
<p>Приложение не опубликовано или ссылка удалена. Опубликуйте проект в RBuilder и повторите.</p>
</div></body></html>`;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // A re-publish must be visible immediately on the same address.
  "Cache-Control": "public, max-age=0, must-revalidate",
};

/**
 * Published apps.
 * URL format: /p/{slug}  →  https://<deployment>.convex.site/p/{slug}
 *
 * This is a real deployment, not a preview: anyone with the link can open it,
 * and the visit counter behind it is what the dashboard reports.
 */
http.route({
  path: "/p/{slug}",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const slug = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    const deployment = await ctx.runQuery(api.deployments.getBySlug, { slug });
    if (!deployment) {
      return new Response(NOT_FOUND_PAGE, { status: 404, headers: HTML_HEADERS });
    }
    // Counted before the response so the number reflects real opens.
    await ctx.runMutation(internal.deployments.recordVisit, {
      deploymentId: deployment.deploymentId,
    });
    return new Response(deployment.html, { status: 200, headers: HTML_HEADERS });
  }),
});

/** Minimal GET so users can verify that the webhook URL is reachable. */
http.route({
  path: "/webhooks/{key}",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = webhookKeyOf(url);
    const connection = await ctx.runQuery(api.serviceConnections.getByWebhookKey, {
      webhookKey: key,
    });
    if (!connection) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(
      JSON.stringify({ ok: true, serviceId: connection.serviceId }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

/* ------------------------------- public API ------------------------------- */

/**
 * Bearer-key authentication for the public API.
 *
 * An API key identifies an account, never a browser session: the request runs
 * the same pipeline as the UI, with the same limits and accounting, and can
 * only ever touch projects owned by the key's account.
 */
async function authenticate(ctx: Parameters<Parameters<typeof httpAction>[0]>[0], request: Request) {
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) return { error: "Нужен заголовок Authorization: Bearer rbr_…" };
  const hash = await hashApiKey(token);
  const key = await ctx.runQuery(internal.apiKeys.verifyByHash, { hash });
  if (!key) return { error: "Ключ не найден или отозван." };
  return { key };
}

http.route({
  path: "/v1/generate",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/v1/generate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, 401);
    const { key } = auth;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Тело запроса должно быть JSON." }, 400);
    }
    const parsed = parseGenerateBody(raw);
    if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
    const body = parsed.value;

    if (body.model && !MODELS.some((model) => model.id === body.model)) {
      return jsonResponse(
        {
          ok: false,
          error: `Неизвестная модель: ${body.model}`,
          models: MODELS.map((model) => model.id),
        },
        400,
      );
    }

    // Same guardrails as the UI: a leaked key must not be able to burn quota.
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      ctx.runQuery(internal.usage.countSince, { userId: key.userId, since: now - HOUR_MS }),
      ctx.runQuery(internal.usage.countSince, { userId: key.userId, since: now - DAY_MS }),
    ]);
    const verdict = decideRateLimit({
      isAnonymous: key.isAnonymous,
      lastHour,
      lastDay,
    });
    if (!verdict.allowed) {
      return jsonResponse({ ok: false, error: verdict.reason }, 429);
    }

    const model = getModel(body.model);
    const projectName =
      body.project?.trim().slice(0, 80) || body.prompt.trim().slice(0, 60);

    try {
      const projectId = await ctx.runMutation(internal.projects.createForUser, {
        userId: key.userId,
        name: projectName,
        prompt: body.prompt,
        model: model.id,
      });

      const result = await ctx.runAction(internal.generation.runForUser, {
        userId: key.userId,
        projectId,
        prompt: body.prompt,
        modelId: model.id,
      });

      await ctx.runMutation(internal.builds.commitForUser, {
        userId: key.userId,
        projectId,
        html: result.html,
        demo: result.demo,
        trace: result.trace,
        changes: result.changes,
        files: result.files?.length
          ? result.files
          : [{ path: "index.html", content: result.html, language: "html" }],
      });

      if (result.demo) {
        return jsonResponse(
          {
            ok: false,
            error:
              result.notice ??
              "Выбранная модель недоступна: не настроен ключ провайдера.",
            projectId,
            model: model.id,
          },
          402,
        );
      }

      let url: string | null = null;
      if (body.deploy) {
        const published = await ctx.runMutation(internal.deployments.publishForUser, {
          userId: key.userId,
          projectId,
          slug: body.project?.trim() || undefined,
          title: projectName,
        });
        url = publishUrl(published.slug, process.env.CONVEX_SITE_URL ?? undefined);
      }

      await ctx.runMutation(internal.apiKeys.touch, { keyId: key.keyId });

      return jsonResponse({
        ok: true,
        projectId,
        version: result.demo ? 0 : 1,
        model: model.id,
        apiModel: result.usage.apiModel,
        url,
        tokens: result.usage.promptTokens + result.usage.completionTokens,
        costRub: result.usage.costRub,
        changes: result.changes ?? [],
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Генерация не удалась.",
        },
        500,
      );
    }
  }),
});

http.route({
  path: "/v1/models",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/v1/models",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, 401);
    return jsonResponse({
      ok: true,
      models: MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        apiModel: model.apiModel,
        costsSession: model.costsSession,
      })),
    });
  }),
});

http.route({
  path: "/v1/me",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/v1/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if ("error" in auth) return jsonResponse({ ok: false, error: auth.error }, 401);
    const { key } = auth;
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      ctx.runQuery(internal.usage.countSince, { userId: key.userId, since: now - HOUR_MS }),
      ctx.runQuery(internal.usage.countSince, { userId: key.userId, since: now - DAY_MS }),
    ]);
    return jsonResponse({
      ok: true,
      keyName: key.keyName,
      site: siteBaseUrl(process.env.CONVEX_SITE_URL ?? undefined),
      generationsLastHour: lastHour,
      generationsLastDay: lastDay,
    });
  }),
});

export default http;
