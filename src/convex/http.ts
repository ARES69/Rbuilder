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
