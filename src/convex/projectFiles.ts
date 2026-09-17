import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";
import { learnFromDiff } from "./patterns";

async function ownedProject(
  ctx: Parameters<typeof getCurrentUser>[0],
  projectId: Id<"projects">,
) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const project = await ctx.db.get(projectId);
  if (!project || project.userId !== user._id) return null;
  return project;
}

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ownedProject(ctx, projectId);
    if (!project) return [];
    return await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("asc")
      .take(200);
  },
});

export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    language: v.optional(v.string()),
    version: v.number(),
    /**
     * Set to false by server-side pipelines that write files themselves — a
     * generated change is not a user preference.
     */
    learn: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, path, content, language, version, learn }) => {
    const project = await ownedProject(ctx, projectId);
    if (!project) throw new Error("Проект не найден");
    const normalizedPath = path.trim().replace(/^\/+/, "");
    if (!normalizedPath || normalizedPath.includes("..")) {
      throw new Error("Некорректный путь файла");
    }
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", projectId).eq("path", normalizedPath),
      )
      .unique();
    const value = { content, language, version };
    if (existing) {
      // A manual edit teaches the agent how this user wants their code written.
      if (learn !== false && existing.content !== content) {
        await learnFromDiff(ctx, {
          userId: project.userId,
          path: normalizedPath,
          before: existing.content,
          after: content,
        });
      }
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("projectFiles", {
      projectId,
      path: normalizedPath,
      ...value,
    });
  },
});
