import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { isValidSlug, slugify } from "../lib/deploy";

/**
 * Deployments — the shareable artefact of a project.
 *
 * Publishing stores the project's current HTML behind a slug that is served by
 * `GET /p/{slug}` (see http.ts). Re-publishing the same project updates the
 * same address, so a link shared earlier keeps working and simply shows the
 * newer version.
 */

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

/**
 * Publish for an explicit owner. Shared by the session mutation below and by
 * the public API, so both get the same slug rules.
 */
async function publishForOwner(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: { projectId: Id<"projects">; slug?: string; title?: string },
) {
  const project = await ctx.db.get(args.projectId);
  if (!project || project.userId !== userId) throw new Error("Проект не найден");
  if (!project.html) {
    throw new Error("Сначала соберите приложение — публиковать нечего.");
  }

  const requested = args.slug?.trim().toLowerCase();
  if (requested && !isValidSlug(requested)) {
    throw new Error(
      "Адрес может содержать только латинские буквы, цифры и дефис (3–40 символов).",
    );
  }

  const finalSlug = await availableSlug(
    ctx,
    requested && isValidSlug(requested) ? requested : slugify(project.name),
    args.projectId,
  );

  const existing = await ctx.db
    .query("deployments")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .unique();

  const now = Date.now();
  const nextTitle = (args.title?.trim() || project.name).slice(0, 80);
  const version = project.version ?? 0;

  if (existing) {
    // Keep `visits` and `publishedAt`: the link did not change.
    await ctx.db.patch(existing._id, {
      slug: finalSlug,
      title: nextTitle,
      version,
      updatedAt: now,
    });
    return { slug: finalSlug, version, deploymentId: existing._id };
  }

  const deploymentId = await ctx.db.insert("deployments", {
    projectId: args.projectId,
    userId,
    slug: finalSlug,
    title: nextTitle,
    version,
    visits: 0,
    publishedAt: now,
    updatedAt: now,
  });
  return { slug: finalSlug, version, deploymentId };
}

/** Make `candidate` unique by suffixing -2, -3, … */
async function availableSlug(
  ctx: Parameters<typeof getCurrentUser>[0],
  candidate: string,
  projectId: Id<"projects">,
): Promise<string> {
  let slug = candidate;
  for (let attempt = 2; attempt < 40; attempt += 1) {
    const existing = await ctx.db
      .query("deployments")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!existing || existing.projectId === projectId) return slug;
    slug = `${candidate.slice(0, 32)}-${attempt}`;
  }
  return `${candidate.slice(0, 24)}-${Date.now().toString(36)}`;
}

/**
 * Publish (or re-publish) a project and return its slug.
 *
 * The caller cannot claim a slug that already belongs to somebody else's
 * project — ownership is checked, and conflicts are resolved by suffixing.
 */
export const publish = mutation({
  args: {
    projectId: v.id("projects"),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    return await publishForOwner(ctx, user._id, args);
  },
});

/** Publishing for a caller that already knows the owner (public API). */
export const publishForUser = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...args }) => {
    return await publishForOwner(ctx, userId, args);
  },
});

export const unpublish = mutation({
  args: { deploymentId: v.id("deployments") },
  handler: async (ctx, { deploymentId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const deployment = await ctx.db.get(deploymentId);
    if (!deployment || deployment.userId !== user._id) {
      throw new Error("Публикация не найдена");
    }
    await ctx.db.delete(deploymentId);
  },
});

/** The current user's published apps, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("deployments")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({
        _id: row._id,
        projectId: row.projectId,
        slug: row.slug,
        title: row.title,
        version: row.version,
        visits: row.visits,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
      }));
  },
});

/**
 * Public lookup used by the HTTP route. Intentionally unauthenticated: a
 * published app is meant to be opened by anyone with the link.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!isValidSlug(slug)) return null;
    const deployment = await ctx.db
      .query("deployments")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!deployment) return null;
    const project = await ctx.db.get(deployment.projectId);
    if (!project?.html) return null;
    return {
      deploymentId: deployment._id,
      title: deployment.title,
      version: deployment.version,
      html: project.html,
    };
  },
});

export const recordVisit = internalMutation({
  args: { deploymentId: v.id("deployments") },
  handler: async (ctx, { deploymentId }) => {
    const deployment = await ctx.db.get(deploymentId);
    if (!deployment) return;
    await ctx.db.patch(deploymentId, { visits: deployment.visits + 1 });
  },
});
