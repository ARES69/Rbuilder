import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getCurrentUser } from "./users";

/** Persist a freshly generated build and its source files. */
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
    files: v.optional(
      v.array(
        v.object({
          path: v.string(),
          content: v.string(),
          language: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, { projectId, html, demo, trace, files }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== user._id) throw new Error("Not found");

    const previousVersion = project.version ?? 0;
    const version = demo ? previousVersion : previousVersion + 1;

    if (!demo && previousVersion > 0) {
      const currentFiles = await ctx.db
        .query("projectFiles")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      const snapshotFiles = currentFiles.length
        ? currentFiles.map((file) => ({
            path: file.path,
            content: file.content,
            language: file.language,
          }))
        : project.html
          ? [{ path: "index.html", content: project.html, language: "html" }]
          : [];
      await ctx.db.insert("projectVersions", {
        projectId,
        version: previousVersion,
        files: snapshotFiles,
        reason: "Перед генерацией новой версии",
      });
    }

    // A provider fallback is useful feedback, but must not replace an existing
    // real build or pretend that a new version was published.
    if (!demo || !project.html) {
      await ctx.db.patch(projectId, { html, ...(demo ? {} : { version }) });
    }

    // Keep the legacy HTML field and the file tree in sync. A demo result never
    // overwrites an existing real file.
    if ((!demo || !project.html) && files?.length) {
      for (const file of files.slice(0, 200)) {
        const path = file.path.trim().replace(/^\/+/, "");
        if (!path || path.includes("..")) continue;
        const existing = await ctx.db
          .query("projectFiles")
          .withIndex("by_project_path", (q) =>
            q.eq("projectId", projectId).eq("path", path),
          )
          .unique();
        const value = {
          content: file.content,
          language: file.language,
          version,
        };
        if (existing) await ctx.db.patch(existing._id, value);
        else await ctx.db.insert("projectFiles", { projectId, path, ...value });
      }
    }

    await ctx.db.insert("messages", {
      projectId,
      role: "assistant",
      content: demo
        ? project.html
          ? "Сборка не выполнена: не настроен ключ выбранной модели, поэтому показана заглушка. Рабочая версия проекта сохранена — добавьте API-ключ и повторите."
          : "Сборка не выполнена: не настроен ключ выбранной модели. Добавьте API-ключ в настройках проекта и повторите запрос."
        : `Сборка завершена — версия v${version} доступна в превью.`,
      trace,
    });

    return { version };
  },
});
