import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { DAILY_SESSION_LIMIT } from "../lib/models";

export const status = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { used: 0, limit: DAILY_SESSION_LIMIT };
    const record = await ctx.db
      .query("sessions")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    return { used: record?.used ?? 0, limit: DAILY_SESSION_LIMIT };
  },
});

export const consume = mutation({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const record = await ctx.db
      .query("sessions")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
      .unique();
    const used = (record?.used ?? 0) + 1;
    if (used > DAILY_SESSION_LIMIT) {
      throw new Error(
        `Daily session limit reached (${DAILY_SESSION_LIMIT}). Pick an unmetered model or come back tomorrow.`,
      );
    }
    if (record) {
      await ctx.db.patch(record._id, { used });
    } else {
      await ctx.db.insert("sessions", { userId: user._id, day, used });
    }
    return { used, limit: DAILY_SESSION_LIMIT };
  },
});
