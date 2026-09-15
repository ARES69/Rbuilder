import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

/** Returns a short-lived upload URL for storing a file in Convex storage. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { projectId, name, mimeType, size, storageId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");

    return await ctx.db.insert("attachments", {
      projectId,
      name,
      mimeType,
      size,
      storageId,
    });
  },
});

/** Minimal attachment info for the generation action (which cannot use ctx.db). */
export const getForGeneration = query({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, { attachmentId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) return null;
    const project = await ctx.db.get(attachment.projectId);
    if (!project || project.userId !== user._id) return null;
    return { name: attachment.name, storageId: attachment.storageId ?? null };
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) return [];
    return await ctx.db
      .query("attachments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const remove = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, { attachmentId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const attachment = await ctx.db.get(attachmentId);
    if (!attachment) throw new Error("Not found");
    const project = await ctx.db.get(attachment.projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");
    if (attachment.storageId) {
      await ctx.storage.delete(attachment.storageId);
    }
    await ctx.db.delete(attachmentId);
  },
});
