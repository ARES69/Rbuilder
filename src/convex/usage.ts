import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { DAY_MS, HOUR_MS, RATE_LIMITS } from "../lib/generation-core";

/**
 * Generation accounting.
 *
 * Every model call writes one row here, so the deployment can answer "what did
 * this project cost" and "is this account hammering the pipeline" without
 * waiting for an invoice from the provider.
 */

export const record = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    provider: v.string(),
    apiModel: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    costRub: v.union(v.number(), v.null()),
    anonymous: v.boolean(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiUsage", {
      userId: args.userId,
      projectId: args.projectId,
      provider: args.provider,
      apiModel: args.apiModel,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      costRub: args.costRub,
      anonymous: args.anonymous,
      createdAt: args.createdAt,
    });
  },
});

/** Number of recorded calls for a user since `since`. */
export const countSince = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => {
    const rows = await ctx.db
      .query("apiUsage")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", userId).gte("createdAt", since),
      )
      .collect();
    return rows.length;
  },
});

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: string;
  windowMs: number;
}

/** Pure decision helper so limits can be asserted in tests. */
export function decideRateLimit(input: {
  isAnonymous: boolean;
  lastHour: number;
  lastDay: number;
}): RateLimitVerdict {
  if (
    input.isAnonymous &&
    input.lastDay >= RATE_LIMITS.anonymousPerDay
  ) {
    return {
      allowed: false,
      windowMs: DAY_MS,
      reason:
        "Гостевой аккаунт исчерпал дневной лимит сборок. Войдите, чтобы продолжить.",
    };
  }
  if (input.lastHour >= RATE_LIMITS.perUserPerHour) {
    return {
      allowed: false,
      windowMs: HOUR_MS,
      reason: `Слишком много генераций подряд. Лимит — ${RATE_LIMITS.perUserPerHour} в час. Подождите немного.`,
    };
  }
  if (input.lastDay >= RATE_LIMITS.perUserPerDay) {
    return {
      allowed: false,
      windowMs: DAY_MS,
      reason: `Дневной лимит генераций исчерпан (${RATE_LIMITS.perUserPerDay}). Возвращайтесь завтра.`,
    };
  }
  return { allowed: true, windowMs: HOUR_MS };
}

/** What the current user has spent — shown in the app and admin console. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { todayCount: 0, todayTokens: 0, todayCostRub: 0, totalCount: 0, totalCostRub: 0 };
    }
    const rows = await ctx.db
      .query("apiUsage")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(500);
    const dayStart = new Date().toISOString().slice(0, 10);
    let todayCount = 0;
    let todayTokens = 0;
    let todayCostRub = 0;
    let totalCostRub = 0;
    for (const row of rows) {
      const day = new Date(row.createdAt).toISOString().slice(0, 10);
      const tokens = row.promptTokens + row.completionTokens;
      if (day === dayStart) {
        todayCount += 1;
        todayTokens += tokens;
        todayCostRub += row.costRub ?? 0;
      }
      totalCostRub += row.costRub ?? 0;
    }
    return {
      todayCount,
      todayTokens,
      todayCostRub: Math.round(todayCostRub * 100) / 100,
      totalCount: rows.length,
      totalCostRub: Math.round(totalCostRub * 100) / 100,
    };
  },
});
