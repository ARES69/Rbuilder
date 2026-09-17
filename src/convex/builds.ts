import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

const buildArgs = {
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
  /** "Что и почему изменилось" — the model's own explanation per file. */
  changes: v.optional(v.array(v.object({ path: v.string(), why: v.string() }))),
};

/**
 * Persist a freshly generated build and its source files.
 *
 * Shared by the app UI (session) and the public API (bearer key), so both
 * paths version, snapshot and message identically.
 */
async function commitBuild(
  ctx: MutationCtx,
  userId: Id<"users">,
  {
    projectId,
    html,
    demo,
    trace,
    files,
    changes,
  }: {
    projectId: Id<"projects">;
    html: string;
    demo: boolean;
    trace?: Array<{ agent: string; note?: string; ms: number }>;
    files?: Array<{ path: string; content: string; language?: string }>;
    changes?: Array<{ path: string; why: string }>;
  },
) {
  const project = await ctx.db.get(projectId);
  if (!project || project.userId !== userId) throw new Error("Проект не найден");

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
    changes: changes?.slice(0, 60),
  });

  return { version };
}

export const commit = mutation({
  args: buildArgs,
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    return await commitBuild(ctx, user._id, args);
  },
});

/** Same commit, for a caller that already knows the owner (public API). */
export const commitForUser = internalMutation({
  args: { userId: v.id("users"), ...buildArgs },
  handler: async (ctx, { userId, ...args }) => {
    return await commitBuild(ctx, userId, args);
  },
});
