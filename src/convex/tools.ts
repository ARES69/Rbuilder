import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { resolveEnabledTools, TOOLS } from "../lib/tools";

/**
 * Tools tab state. Rows live in `userSkills` (shared table, discriminated by
 * `kind === "tool"`), so no extra table is needed and the toggle semantics
 * match skills exactly. The stored id is the tool id from lib/tools.ts.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { rows: [] as { toolId: string; enabled: boolean }[], enabled: resolveEnabledTools([]) };

    const all = await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const rows = all
      .filter((row) => row.kind === "tool")
      .map((row) => ({ toolId: row.skillId, enabled: row.enabled }));

    // Unknown ids (from an older catalog) are ignored by the resolver.
    return { rows, enabled: resolveEnabledTools(rows) };
  },
});

/** Flip a single tool on/off, creating the row on first use. */
export const toggle = mutation({
  args: { toolId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { toolId, enabled }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");
    if (!TOOLS.some((tool) => tool.id === toolId)) {
      throw new Error(`Неизвестный инструмент: ${toolId}`);
    }

    const existing = await ctx.db
      .query("userSkills")
      .withIndex("by_user_skill", (q) =>
        q.eq("userId", user._id).eq("skillId", toolId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled, kind: "tool" });
    } else {
      await ctx.db.insert("userSkills", {
        userId: user._id,
        skillId: toolId,
        enabled,
        kind: "tool",
        custom: undefined,
      });
    }
  },
});

/** Restore every tool to its catalog default (drops the stored rows). */
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");
    const all = await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const row of all) {
      if (row.kind === "tool") await ctx.db.delete(row._id);
    }
    return { enabled: resolveEnabledTools([]) };
  },
});
