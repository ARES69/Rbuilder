import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";
import {
  buildRecipe,
  recipeSummary,
  validateSnapshotMeta,
  type SnapshotRecipe,
} from "../lib/recipes";

/**
 * Global snapshots ("запомни этот момент").
 *
 * A snapshot freezes the user's whole environment — workspace rules and
 * architecture, skills, tools. Publishing turns a snapshot into a recipe any
 * user can deploy: an exact copy of the configuration lands in their account.
 * Integration credentials and API keys are never captured, so a recipe cannot
 * leak another user's tokens.
 */

async function requireUser(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Требуется вход в аккаунт");
  return user;
}

async function ownedSnapshot(
  ctx: Parameters<typeof getCurrentUser>[0],
  snapshotId: Id<"snapshots">,
) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const snapshot = await ctx.db.get(snapshotId);
  if (!snapshot || snapshot.userId !== user._id) return null;
  return snapshot;
}

/** Gather the current environment into a normalised recipe payload. */
async function collectRecipe(
  ctx: Parameters<typeof getCurrentUser>[0],
): Promise<SnapshotRecipe> {
  const user = await requireUser(ctx);

  const workspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .order("asc")
    .take(50);
  const workspace = workspaces[0];

  const skillRows = (
    await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  ).filter((row) => row.kind !== "tool");

  const toolRows = (
    await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  ).filter((row) => row.kind === "tool");

  return buildRecipe(
    {
      createdAt: Date.now(),
      workspace: {
        architectureId: workspace?.architectureId,
        rules: workspace?.rules,
      },
      skills: skillRows.map((row) => ({
        skillId: row.skillId,
        enabled: row.enabled,
        ...(row.custom ? { custom: row.custom } : {}),
      })),
      tools: toolRows.map((row) => ({
        toolId: row.skillId,
        enabled: row.enabled,
      })),
    },
    "Снапшот",
  );
}

/* --------------------------------- queries -------------------------------- */

/** The current user's snapshots, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("snapshots")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
  },
});

/** Public recipes (published snapshots) for the community gallery. */
export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("snapshots").collect();
    const published = rows.filter((row) => row.published);
    return published
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0) || b._creationTime - a._creationTime)
      .slice(0, 50)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        description: row.description,
        skills: row.skills.length,
        tools: row.tools.length,
        hasArchitecture: Boolean(row.workspace.architectureId),
        hasRules: Boolean(row.workspace.rules),
        likes: row.likes ?? 0,
        mine: false as const,
      }));
  },
});

/* -------------------------------- mutations ------------------------------- */

/** Freeze the current environment into a named snapshot. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { name, description }) => {
    const invalid = validateSnapshotMeta(name, description ?? "");
    if (invalid) throw new Error(invalid);

    const recipe = await collectRecipe(ctx);
    const snapshotId = await ctx.db.insert("snapshots", {
      userId: (await requireUser(ctx))._id,
      name: name.trim(),
      description: description?.trim() || undefined,
      workspace: recipe.workspace,
      skills: recipe.skills,
      tools: recipe.tools,
      likes: 0,
    });
    return { snapshotId, summary: recipeSummary(recipe) };
  },
});

/** Delete a snapshot (published or not). */
export const remove = mutation({
  args: { snapshotId: v.id("snapshots") },
  handler: async (ctx, { snapshotId }) => {
    const snapshot = await ownedSnapshot(ctx, snapshotId);
    if (!snapshot) throw new Error("Снапшот не найден");
    await ctx.db.delete(snapshotId);
  },
});

/** Publish / unpublish a snapshot as a community recipe. */
export const setPublished = mutation({
  args: { snapshotId: v.id("snapshots"), published: v.boolean() },
  handler: async (ctx, { snapshotId, published }) => {
    const snapshot = await ownedSnapshot(ctx, snapshotId);
    if (!snapshot) throw new Error("Снапшот не найден");
    if (
      published &&
      snapshot.skills.length === 0 &&
      snapshot.tools.length === 0 &&
      !snapshot.workspace.rules &&
      !snapshot.workspace.architectureId
    ) {
      throw new Error("Пустой снапшот публиковать нечего");
    }
    await ctx.db.patch(snapshotId, { published });
  },
});

/** Like a published recipe (one user may like once — tracked client-side). */
export const like = mutation({
  args: { snapshotId: v.id("snapshots") },
  handler: async (ctx, { snapshotId }) => {
    const user = await requireUser(ctx);
    const snapshot = await ctx.db.get(snapshotId);
    if (!snapshot || !snapshot.published) throw new Error("Рецепт не найден");
    if (snapshot.userId === user._id) {
      throw new Error("Свой рецепт лайкнуть нельзя");
    }
    await ctx.db.patch(snapshotId, { likes: (snapshot.likes ?? 0) + 1 });
  },
});

/** Deploy a recipe: overwrite workspace config and skill/tool toggles. */
export const deploy = mutation({
  args: {
    snapshotId: v.optional(v.id("snapshots")),
    /** Deploy from an imported recipe file instead of a stored snapshot. */
    imported: v.optional(
      v.object({
        name: v.string(),
        workspace: v.object({
          architectureId: v.optional(v.string()),
          rules: v.optional(v.string()),
        }),
        skills: v.array(
          v.object({
            skillId: v.string(),
            enabled: v.boolean(),
            custom: v.optional(
              v.object({
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
                compatibleModels: v.optional(v.array(v.string())),
              }),
            ),
          }),
        ),
        tools: v.array(
          v.object({
            toolId: v.string(),
            enabled: v.boolean(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { snapshotId, imported }) => {
    const user = await requireUser(ctx);

    let name: string;
    let workspace: { architectureId?: string; rules?: string };
    let skills: Array<{
      skillId: string;
      enabled: boolean;
      custom?: {
        name: string;
        desc: string;
        prompt: string;
        category: "design" | "code" | "data" | "integration" | "quality";
        source?: string;
        compatibleModels?: string[];
      };
    }>;
    let tools: Array<{ toolId: string; enabled: boolean }>;

    if (imported) {
      const recipe = buildRecipe(
        { createdAt: Date.now(), ...imported },
        "Импортированный рецепт",
      );
      name = recipe.name;
      workspace = recipe.workspace;
      skills = recipe.skills;
      tools = recipe.tools;
    } else if (snapshotId) {
      const snapshot = await ctx.db.get(snapshotId);
      if (!snapshot) throw new Error("Снапшот не найден");
      if (!snapshot.published && snapshot.userId !== user._id) {
        throw new Error("Рецепт не опубликован");
      }
      name = snapshot.name;
      workspace = snapshot.workspace;
      skills = snapshot.skills;
      tools = snapshot.tools;
    } else {
      throw new Error("Не указан источник рецепта");
    }

    // 1. Workspace: apply the first (default) workspace's config.
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .take(50);
    const target = workspaces[0];
    if (target) {
      await ctx.db.patch(target._id, {
        ...(workspace.architectureId ? { architectureId: workspace.architectureId } : {}),
        ...(workspace.rules ? { rules: workspace.rules } : {}),
      });
    }

    // 2. Skills: clear skill rows, then restore the recipe's state. Custom
    // skills are re-created with fresh ids (ids are per-account anyway).
    const allRows = await ctx.db
      .query("userSkills")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const row of allRows) {
      if (row.kind !== "tool") await ctx.db.delete(row._id);
    }
    for (const skill of skills) {
      await ctx.db.insert("userSkills", {
        userId: user._id,
        skillId: skill.skillId,
        enabled: skill.enabled,
        ...(skill.custom ? { custom: skill.custom } : {}),
      });
    }

    // 3. Tools: same replace-then-restore under `kind: "tool"`.
    for (const row of allRows) {
      if (row.kind === "tool") await ctx.db.delete(row._id);
    }
    for (const tool of tools) {
      await ctx.db.insert("userSkills", {
        userId: user._id,
        skillId: tool.toolId,
        enabled: tool.enabled,
        kind: "tool",
      });
    }

    return {
      deployed: name,
      summary: recipeSummary(
        buildRecipe(
          { createdAt: Date.now(), workspace, skills, tools },
          name,
        ),
      ),
    };
  },
});
