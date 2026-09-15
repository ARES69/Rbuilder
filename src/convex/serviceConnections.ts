import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Server-side helpers for service connections. Kept in a separate module so
 * that actions in integrations.ts can call them via `internal` without a
 * self-referential module cycle.
 */

/** Look up a connection by its incoming-webhook secret (HTTP router). */
export const getByWebhookKey = query({
  args: { webhookKey: v.string() },
  handler: async (ctx, { webhookKey }) => {
    return await ctx.db
      .query("serviceConnections")
      .filter((q) => q.eq(q.field("webhookKey"), webhookKey))
      .unique();
  },
});

/** Load a connection for server-side orchestration. */
export const getConnection = internalQuery({
  args: { connectionId: v.id("serviceConnections") },
  handler: async (ctx, { connectionId }) => ctx.db.get(connectionId),
});

/** Create or refresh a connection row with new credentials (status pending). */
export const upsertConnection = internalMutation({
  args: {
    userId: v.id("users"),
    serviceId: v.string(),
    credentials: v.record(v.string(), v.string()),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, { userId, serviceId, credentials, meta }) => {
    const existing = await ctx.db
      .query("serviceConnections")
      .withIndex("by_user_service", (q) =>
        q.eq("userId", userId).eq("serviceId", serviceId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        credentials,
        status: "pending",
        statusMessage: undefined,
        meta,
        lastCheckedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("serviceConnections", {
      userId,
      serviceId,
      credentials,
      status: "pending",
      meta,
      lastCheckedAt: Date.now(),
    });
  },
});

/** Write the verification outcome onto a connection. */
export const finalizeConnection = internalMutation({
  args: {
    connectionId: v.id("serviceConnections"),
    ok: v.boolean(),
    message: v.string(),
    issueKey: v.boolean(),
  },
  handler: async (ctx, { connectionId, ok, message, issueKey }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) return;
    const patch: Record<string, unknown> = {
      status: ok ? "connected" : "error",
      statusMessage: message,
      lastCheckedAt: Date.now(),
    };
    if (ok && issueKey && !connection.webhookKey) {
      patch.webhookKey = generateWebhookKey();
    }
    await ctx.db.patch(connectionId, patch);
  },
});

/** Store a webhook delivery (called from the HTTP router). */
export const recordEvent = internalMutation({
  args: {
    userId: v.id("users"),
    connectionId: v.id("serviceConnections"),
    serviceId: v.string(),
    event: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { userId, connectionId, serviceId, event, payload }) => {
    await ctx.db.insert("serviceEvents", { userId, connectionId, serviceId, event, payload });
  },
});

function generateWebhookKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
    if (i === 7 || i === 15 || i === 23) key += "-";
  }
  return key;
}
