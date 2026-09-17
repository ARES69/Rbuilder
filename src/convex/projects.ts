import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) return null;
    return project;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
    target: v.optional(v.union(v.literal("web"), v.literal("expo"))),
  },
  handler: async (ctx, { name, prompt, model, target }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    return await ctx.db.insert("projects", {
      userId: user._id,
      name,
      description: "",
      version: 0,
      lastPrompt: prompt,
      model,
      ...(target ? { target } : {}),
    });
  },
});

/** Creation on behalf of a known owner — used by the public API. */
export const createForUser = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { userId, name, prompt, model }) => {
    return await ctx.db.insert("projects", {
      userId,
      name: name.slice(0, 120) || "API app",
      description: "Создано через публичный API",
      version: 0,
      lastPrompt: prompt,
      model,
    });
  },
});

export const setModel = mutation({
  args: { projectId: v.id("projects"), model: v.string() },
  handler: async (ctx, { projectId, model }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");
    await ctx.db.patch(projectId, { model });
  },
});

/** Switch the output target of an existing project (web ↔ expo). */
export const setTarget = mutation({
  args: {
    projectId: v.id("projects"),
    target: v.union(v.literal("web"), v.literal("expo")),
  },
  handler: async (ctx, { projectId, target }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");
    await ctx.db.patch(projectId, { target });
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");
    await ctx.db.patch(projectId, { name });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");

    // delete related messages and attachments
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    const projectVersions = await ctx.db
      .query("projectVersions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const version of projectVersions) {
      await ctx.db.delete(version._id);
    }

    const projectFiles = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const file of projectFiles) {
      await ctx.db.delete(file._id);
    }

    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const attachment of attachments) {
      if (attachment.storageId) {
        await ctx.storage.delete(attachment.storageId);
      }
      await ctx.db.delete(attachment._id);
    }

    await ctx.db.delete(projectId);
  },
});
