import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";

async function ownedWorkspace(
  ctx: Parameters<typeof getCurrentUser>[0],
  workspaceId: Id<"workspaces">,
) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.userId !== user._id) return null;
  return workspace;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("workspaces")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .take(50);
  },
});

export const ensureDefault = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("asc")
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("workspaces", {
      userId: user._id,
      name: name?.trim() || "Мой workspace",
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    architectureId: v.optional(v.string()),
    rules: v.optional(v.string()),
  },
  handler: async (ctx, { name, architectureId, rules }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Введите название workspace");
    return await ctx.db.insert("workspaces", {
      userId: user._id,
      name: trimmed,
      architectureId,
      rules,
    });
  },
});

export const runs = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ownedWorkspace(ctx, workspaceId);
    if (!workspace) return [];
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(20);
  },
});

export const startRun = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    prompt: v.string(),
    mode: v.optional(
      v.union(
        v.literal("ask"),
        v.literal("plan"),
        v.literal("edit"),
        v.literal("debug"),
        v.literal("review"),
        v.literal("run"),
      ),
    ),
  },
  handler: async (ctx, { workspaceId, projectId, prompt, mode }) => {
    const workspace = await ownedWorkspace(ctx, workspaceId);
    if (!workspace) throw new Error("Workspace не найден");
    if (projectId) {
      const project = await ctx.db.get(projectId);
      if (!project || project.userId !== workspace.userId) throw new Error("Проект не найден");
    }
    return await ctx.db.insert("agentRuns", {
      userId: workspace.userId,
      workspaceId,
      projectId,
      prompt,
      mode: mode ?? "edit",
      status: "running",
    });
  },
});

/**
 * Streaming progress for a running pipeline.
 *
 * The generation action calls this before and after every stage, so the UI can
 * show a live trace instead of a single spinner for the whole build. `step`
 * holds the stage in flight; completed stages are appended to `trace`.
 */
export const progress = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    step: v.optional(v.string()),
    entry: v.optional(
      v.object({
        agent: v.string(),
        note: v.optional(v.string()),
        ms: v.number(),
      }),
    ),
  },
  handler: async (ctx, { runId, step, entry }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const trace = entry ? [...(run.trace ?? []), entry].slice(-40) : run.trace;
    await ctx.db.patch(runId, { trace, step: step ?? undefined });
  },
});

export const finishRun = mutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    trace: v.optional(
      v.array(
        v.object({
          agent: v.string(),
          note: v.optional(v.string()),
          ms: v.number(),
        }),
      ),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { runId, status, trace, error }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== user._id) throw new Error("Запуск не найден");
    await ctx.db.patch(runId, { status, trace, error, step: error ?? undefined });
  },
});
