import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) return [];
    return await ctx.db
      .query("messages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("asc")
      .collect();
  },
});

export const send = mutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
  },
  handler: async (ctx, { projectId, content, attachmentIds }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");

    const messageId = await ctx.db.insert("messages", {
      projectId,
      role: "user",
      content,
    });

    if (attachmentIds?.length) {
      for (const attachmentId of attachmentIds) {
        await ctx.db.patch(attachmentId, { projectId });
      }
    }

    return messageId;
  },
});
