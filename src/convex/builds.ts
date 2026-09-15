import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getCurrentUser } from "./users";

/** Persist a freshly generated HTML build and log the assistant reply with its agent trace. */
export const commit = mutation({
  args: {
    projectId: v.id("projects"),
    html: v.string(),
    demo: v.boolean(),
    trace: v.optional(
      v.array(
        v.object({
          agent: v.string(),
          note: v.optional(v.string()),
          ms: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, { projectId, html, demo, trace }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");

    const version = (project.version ?? 0) + 1;
    await ctx.db.patch(projectId, { html, version });

    await ctx.db.insert("messages", {
      projectId,
      role: "assistant",
      content: demo
        ? `Demo build ready (v${version}) — add an OPENAI_API_KEY to run the full agent pipeline.`
        : `Build complete — v${version} is live in the preview.`,
      trace,
    });

    return { version };
  },
});
