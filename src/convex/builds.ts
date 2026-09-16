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

    const previousVersion = project.version ?? 0;
    const version = demo ? previousVersion : previousVersion + 1;

    // A provider fallback is useful feedback, but it must not replace an
    // existing real build or pretend that a new version was published.
    if (!demo || !project.html) {
      await ctx.db.patch(projectId, { html, ...(demo ? {} : { version }) });
    }

    await ctx.db.insert("messages", {
      projectId,
      role: "assistant",
      content: demo
        ? project.html
          ? "Демо-режим: рабочая версия приложения сохранена. Добавьте ключ модели для полноценной сборки."
          : "Демо-режим: добавьте ключ модели для полноценной сборки."
        : `Сборка завершена — версия v${version} доступна в превью.`,
      trace,
    });

    return { version };
  },
});
