import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";

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
      .query("projectVersions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
  },
});

export const restore = mutation({
  args: {
    projectId: v.id("projects"),
    versionId: v.id("projectVersions"),
  },
  handler: async (ctx, { projectId, versionId }) => {
    const project = await ownedProject(ctx, projectId);
    if (!project) throw new Error("Проект не найден");
    const snapshot = await ctx.db.get(versionId);
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new Error("Версия не найдена");
    }

    const currentFiles = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const file of currentFiles) await ctx.db.delete(file._id);

    for (const file of snapshot.files) {
      await ctx.db.insert("projectFiles", {
        projectId,
        path: file.path,
        content: file.content,
        language: file.language,
        version: snapshot.version,
      });
    }

    const indexFile = snapshot.files.find((file) => file.path === "index.html");
    await ctx.db.patch(projectId, {
      html: indexFile?.content,
      version: snapshot.version,
    });
    return { version: snapshot.version };
  },
});
