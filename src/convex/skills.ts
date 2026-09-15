import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { BUILT_IN_SKILLS } from "../lib/skills";

/**
 * A user's skill row: either a toggle for a built-in skill (custom=null)
 * or a stored custom skill (custom set).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { rows: [], enabled: [] as string[] };

    const allRows = await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    // Tool rows share this table but are owned by the Tools tab.
    const rows = allRows.filter((row) => row.kind !== "tool");

    const enabled: string[] = [];
    const customs: Array<{
      id: string;
      name: string;
      source: string;
      category: "design" | "code" | "data" | "integration" | "quality";
      desc: string;
      prompt: string;
      compatibleModels: string[];
      builtIn: boolean;
    }> = [];

    for (const row of rows) {
      if (row.enabled) enabled.push(row.skillId);
      if (row.custom) {
        customs.push({
          id: row.skillId,
          name: row.custom.name,
          source: row.custom.source ?? "Custom",
          category: row.custom.category,
          desc: row.custom.desc,
          prompt: row.custom.prompt,
          compatibleModels: row.custom.compatibleModels ?? [],
          builtIn: false,
        });
      }
    }

    return { rows, enabled, customs };
  },
});

/** Toggle a built-in skill on/off (creates the row on first use). */
export const toggle = mutation({
  args: { skillId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { skillId, enabled }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");

    const existing = await ctx.db
      .query("userSkills")
      .withIndex("by_user_skill", (q) =>
        q.eq("userId", user._id).eq("skillId", skillId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled });
    } else {
      await ctx.db.insert("userSkills", {
        userId: user._id,
        skillId,
        enabled,
        kind: "skill",
        custom: undefined,
      });
    }
  },
});

/** Add a user-defined skill (enabled by default). */
export const addCustom = mutation({
  args: {
    name: v.string(),
    desc: v.string(),
    prompt: v.string(),
    category: v.union(
      v.literal("design"),
      v.literal("code"),
      v.literal("data"),
      v.literal("integration"),
      v.literal("quality"),
    ),
    source: v.optional(v.string()),
  },
  handler: async (ctx, { name, desc, prompt, category, source }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");

    const skillId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await ctx.db.insert("userSkills", {
      userId: user._id,
      skillId,
      enabled: true,
      custom: {
        name,
        desc,
        prompt,
        category,
        source: source ?? "Custom",
        compatibleModels: [],
      },
    });
    return { skillId };
  },
});

/** Remove a custom skill row entirely. */
export const removeCustom = mutation({
  args: { skillId: v.string() },
  handler: async (ctx, { skillId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");
    const existing = await ctx.db
      .query("userSkills")
      .withIndex("by_user_skill", (q) =>
        q.eq("userId", user._id).eq("skillId", skillId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Internal helper: enabled skill prompts for the generation pipeline. */
export const enabledPrompts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = (
      await ctx.db
        .query("userSkills")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    ).filter((row) => row.kind !== "tool");
    const enabledIds = new Set(rows.filter((r) => r.enabled).map((r) => r.skillId));
    const prompts: string[] = [];
    for (const skill of BUILT_IN_SKILLS) {
      if (enabledIds.has(skill.id)) prompts.push(skill.prompt);
    }
    for (const row of rows) {
      if (row.custom && row.enabled) prompts.push(row.custom.prompt);
    }
    return prompts;
  },
});
