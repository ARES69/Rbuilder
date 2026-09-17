import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

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

export default http;
