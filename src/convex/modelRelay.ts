import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getCurrentUser } from "./users";
import { apiModelFor } from "./generation";
import { parseRelayPayload } from "../lib/local-model";

/**
 * Browser relay for locally hosted models (LM Studio / Ollama).
 *
 * A Convex action cannot reach the user's localhost, but their browser can:
 * the pipeline parks a request in `modelRelay`, the LocalModelBridge component
 * in the dashboard picks it up reactively, sends it to the local
 * OpenAI-compatible endpoint and fulfils the row with the result (or an
 * error). The action side polls `get` until the row resolves.
 *
 * Rows are per-user and short-lived; anything finished is garbage on touch.
 */

const RELAY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_500;

interface RelayAnswer {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
}

/** Park a request and wait (inside the action) until the browser answers. */
export const call = action({
  args: {
    apiModel: v.string(),
    system: v.string(),
    user: v.string(),
    maxTokens: v.number(),
  },
  handler: async (ctx, args): Promise<RelayAnswer> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");
    const apiModel = apiModelFor("local", args.apiModel);

    const relayId = await ctx.runMutation(internal.modelRelay.enqueue, {
      userId: user._id,
      apiModel,
      system: args.system,
      user: args.user,
      maxTokens: args.maxTokens,
    });

    const deadline = Date.now() + RELAY_TIMEOUT_MS;
    let lastError: string | null = null;
    while (Date.now() < deadline) {
      const row = await ctx.runQuery(internal.modelRelay.get, { relayId });
      if (!row) throw new Error("Локальный мост: запрос потерян.");
      if (row.status === "done" && typeof row.result === "string") {
        await ctx.runMutation(internal.modelRelay.cleanup, { userId: user._id });
        return {
          text: row.result,
          usage: row.usage ?? { promptTokens: 0, completionTokens: 0 },
        };
      }
      if (row.status === "error") {
        lastError = row.error ?? "Локальная модель вернула ошибку.";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const timeoutMessage =
      "Локальный мост не ответил за 2 минуты. Запустите LM Studio/Ollama и держите вкладку RBuilder открытой.";
    await ctx.runMutation(internal.modelRelay.fail, {
      relayId,
      error: lastError ? `Локальная модель недоступна: ${lastError}` : timeoutMessage,
    });
    throw new Error(
      lastError ? `Локальная модель недоступна: ${lastError}` : timeoutMessage,
    );
  },
});

/** The bridge (browser) claims the oldest pending request for this user. */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const rows = await ctx.db
      .query("modelRelay")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .take(10);
    const now = Date.now();
    return (
      rows.find(
        (row) => row.status === "pending" && now - row.createdAt < RELAY_TIMEOUT_MS,
      ) ?? null
    );
  },
});

/** The bridge pushes the finished answer back. */
export const fulfill = mutation({
  args: { relayId: v.id("modelRelay"), payload: v.string() },
  handler: async (ctx, { relayId, payload }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const row = await ctx.db.get(relayId);
    if (!row || row.userId !== user._id) throw new Error("Not found");
    if (row.status !== "pending") return;

    const parsed = parseRelayPayload(payload);
    if (!parsed.ok) {
      await ctx.db.patch(relayId, { status: "error", error: parsed.error });
      return;
    }
    await ctx.db.patch(relayId, {
      status: "done",
      result: parsed.value.text,
      usage: parsed.value.usage,
    });
  },
});

/** Diagnostics for the settings panel: counts by status. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { pending: 0, done: 0, error: 0, lastError: null as string | null };
    }
    const rows = await ctx.db
      .query("modelRelay")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    let pending = 0;
    let done = 0;
    let error = 0;
    let lastError: string | null = null;
    for (const row of rows) {
      if (row.status === "pending") pending += 1;
      else if (row.status === "done") done += 1;
      else {
        error += 1;
        if (row.error) lastError = row.error;
      }
    }
    return { pending, done, error, lastError };
  },
});

/* ------------------------------ internal side ----------------------------- */

export const enqueue = internalMutation({
  args: {
    userId: v.id("users"),
    apiModel: v.string(),
    system: v.string(),
    user: v.string(),
    maxTokens: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("modelRelay", {
      userId: args.userId,
      apiModel: args.apiModel,
      system: args.system,
      user: args.user,
      maxTokens: args.maxTokens,
      status: "pending" as const,
      createdAt: Date.now(),
    });
  },
});

export const get = internalQuery({
  args: { relayId: v.id("modelRelay") },
  handler: async (ctx, { relayId }) => await ctx.db.get(relayId),
});

export const fail = internalMutation({
  args: { relayId: v.id("modelRelay"), error: v.string() },
  handler: async (ctx, { relayId, error }) => {
    await ctx.db.patch(relayId, { status: "error" as const, error });
  },
});

/** Drop finished rows so the bridge queue stays tiny. */
export const cleanup = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("modelRelay")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) {
      if (row.status !== "pending") await ctx.db.delete(row._id);
    }
  },
});
