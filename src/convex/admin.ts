import { query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { ROLES } from "./schema";

/**
 * Admin console data. Every query here returns `null` for anyone who is not
 * signed in with the admin role, so the UI can render an access-denied state
 * without leaking whether the deployment has data.
 */

/** How many message rows we are willing to read to compute counts. */
const MESSAGE_SCAN_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getCurrentUser(ctx);
    if (!viewer || viewer.role !== ROLES.ADMIN) return null;

    const users = await ctx.db.query("users").collect();
    const projects = await ctx.db.query("projects").collect();
    const attachments = await ctx.db.query("attachments").collect();
    const connections = await ctx.db.query("serviceConnections").collect();
    const events = await ctx.db.query("serviceEvents").collect();
    const preferenceRows = await ctx.db.query("userSkills").collect();

    // Messages are the only table that can grow without bound, so cap the scan.
    const messages = await ctx.db.query("messages").take(MESSAGE_SCAN_LIMIT);
    const messagesCapped = messages.length === MESSAGE_SCAN_LIMIT;

    // Model spend: what the deployment actually consumed, per model.
    const usageRows = await ctx.db.query("apiUsage").take(MESSAGE_SCAN_LIMIT);
    const usageCapped = usageRows.length === MESSAGE_SCAN_LIMIT;
    interface SpendBucket {
      calls: number;
      tokens: number;
      costRub: number;
    }
    const spendBuckets: Record<string, SpendBucket> = {};
    for (const row of usageRows) {
      const key = `${row.provider}/${row.apiModel}`;
      const bucket = spendBuckets[key] ?? { calls: 0, tokens: 0, costRub: 0 };
      bucket.calls += 1;
      bucket.tokens += row.promptTokens + row.completionTokens;
      bucket.costRub += row.costRub ?? 0;
      spendBuckets[key] = bucket;
    }
    const spendByModel = Object.entries(spendBuckets)
      .map(([model, stats]) => ({
        model,
        calls: stats.calls,
        tokens: stats.tokens,
        costRub: Math.round(stats.costRub * 100) / 100,
      }))
      .sort((a, b) => b.costRub - a.costRub || b.calls - a.calls)
      .slice(0, 8);
    const totalTokens = usageRows.reduce(
      (sum, row) => sum + row.promptTokens + row.completionTokens,
      0,
    );
    const totalCostRub =
      Math.round(
        usageRows.reduce((sum, row) => sum + (row.costRub ?? 0), 0) * 100,
      ) / 100;

    const today = new Date().toISOString().slice(0, 10);
    const sessionRows = await ctx.db.query("sessions").collect();

    const ownerById = new Map(users.map((user) => [user._id, user]));

    const recentUsers = [...users]
      .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))
      .slice(0, 8)
      .map((user) => ({
        id: user._id,
        name: user.name ?? null,
        email: user.email ?? null,
        role: user.role ?? ROLES.USER,
        anonymous: !!user.isAnonymous,
      }));

    const recentProjects = [...projects]
      .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))
      .slice(0, 10)
      .map((project) => ({
        id: project._id,
        name: project.name,
        version: project.version,
        model: project.model ?? null,
        owner: ownerById.get(project.userId)?.email ?? "—",
        createdAt: project._creationTime ?? 0,
      }));

    const connectionsByService = Object.entries(
      connections.reduce<Record<string, { total: number; errors: number }>>(
        (acc, connection) => {
          const entry = acc[connection.serviceId] ?? { total: 0, errors: 0 };
          entry.total += 1;
          if (connection.status !== "connected") entry.errors += 1;
          acc[connection.serviceId] = entry;
          return acc;
        },
        {},
      ),
    )
      .map(([serviceId, stats]) => ({ serviceId, ...stats }))
      .sort((a, b) => b.total - a.total);

    // Messages per day for the last 7 days, from the (capped) message scan.
    const activity: { day: string; messages: number }[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(Date.now() - offset * DAY_MS)
        .toISOString()
        .slice(0, 10);
      activity.push({ day, messages: 0 });
    }
    const activityIndex = new Map(activity.map((entry, index) => [entry.day, index]));
    for (const message of messages) {
      const day = new Date(message._creationTime ?? 0).toISOString().slice(0, 10);
      const index = activityIndex.get(day);
      if (index !== undefined) activity[index].messages += 1;
    }

    const toolRows = preferenceRows.filter((row) => row.kind === "tool");

    return {
      viewer: { name: viewer.name ?? null, email: viewer.email ?? null },
      totals: {
        users: users.length,
        anonymous: users.filter((user) => user.isAnonymous).length,
        admins: users.filter((user) => user.role === ROLES.ADMIN).length,
        projects: projects.length,
        published: projects.filter((project) => (project.version ?? 0) > 0).length,
        messages: messages.length,
        attachments: attachments.length,
        connections: connections.length,
        events: events.length,
        skillsEnabled: preferenceRows.filter(
          (row) => row.kind !== "tool" && row.enabled,
        ).length,
        toolsEnabled: toolRows.filter((row) => row.enabled).length,
        sessionsToday: sessionRows
          .filter((row) => row.day === today)
          .reduce((sum, row) => sum + row.used, 0),
        generations: usageRows.length,
        tokens: totalTokens,
        costRub: totalCostRub,
      },
      messagesCapped,
      usageCapped,
      spendByModel,
      recentUsers,
      recentProjects,
      connectionsByService,
      activity,
    };
  },
});
