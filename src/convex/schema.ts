import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const messageRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
);
export type MessageRole = Infer<typeof messageRoleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    workspaces: defineTable({
      userId: v.id("users"),
      name: v.string(),
      localPath: v.optional(v.string()),
      architectureId: v.optional(v.string()),
      rules: v.optional(v.string()),
    }).index("by_user", ["userId"]),

    agentRuns: defineTable({
      userId: v.id("users"),
      workspaceId: v.id("workspaces"),
      projectId: v.optional(v.id("projects")),
      prompt: v.string(),
      status: v.union(
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      mode: v.union(
        v.literal("ask"),
        v.literal("plan"),
        v.literal("edit"),
        v.literal("debug"),
        v.literal("review"),
        v.literal("run"),
      ),
      trace: v.optional(
        v.array(
          v.object({
            agent: v.string(),
            note: v.optional(v.string()),
            ms: v.number(),
          }),
        ),
      ),
      /** Stage currently in flight, so the UI can stream progress. */
      step: v.optional(v.string()),
      error: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_workspace", ["workspaceId"]),

    projects: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.string(),
      html: v.optional(v.string()),
      version: v.number(),
      lastPrompt: v.optional(v.string()),
      model: v.optional(v.string()), // selected model id from the catalog
    }).index("by_user", ["userId"]),

    messages: defineTable({
      projectId: v.id("projects"),
      role: messageRoleValidator,
      content: v.string(),
      /** Per-file reasons for the changes in this build ("что и почему"). */
      changes: v.optional(
        v.array(
          v.object({
            path: v.string(),
            why: v.string(),
          }),
        ),
      ),
      trace: v.optional(
        v.array(
          v.object({
            agent: v.string(),
            note: v.optional(v.string()),
            ms: v.number(),
          }),
        ),
      ),
    }).index("by_project", ["projectId"]),

    // Source files for a project. `html` remains on projects for backwards
    // compatibility and fast preview loading; this table is the canonical
    // starting point for the multi-file runtime.
    projectFiles: defineTable({
      projectId: v.id("projects"),
      path: v.string(),
      content: v.string(),
      language: v.optional(v.string()),
      version: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_path", ["projectId", "path"]),

    // Immutable project checkpoints used for diff and rollback.
    projectVersions: defineTable({
      projectId: v.id("projects"),
      version: v.number(),
      files: v.array(
        v.object({
          path: v.string(),
          content: v.string(),
          language: v.optional(v.string()),
        }),
      ),
      reason: v.optional(v.string()),
    }).index("by_project", ["projectId"]),

    attachments: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      mimeType: v.string(),
      size: v.number(),
      storageId: v.optional(v.id("_storage")),
    }).index("by_project", ["projectId"]),

    // One row per model call: what it cost, who spent it and on what project.
    // Without this the only place a bill shows up is the provider dashboard.
    apiUsage: defineTable({
      userId: v.id("users"),
      projectId: v.optional(v.id("projects")),
      provider: v.string(),
      apiModel: v.string(),
      promptTokens: v.number(),
      completionTokens: v.number(),
      /** null when the provider price is unknown — tokens are still recorded. */
      costRub: v.union(v.number(), v.null()),
      /** Whether the call belonged to an auto-created guest account. */
      anonymous: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_created", ["userId", "createdAt"]),

    // Preferences the agent learned by watching the user's own manual edits in
    // the Code panel. This is the part of "memory" that belongs to the user and
    // cannot be copied by a competitor, because it is derived from their work.
    userPatterns: defineTable({
      userId: v.id("users"),
      /** Stable detector id, e.g. "form.autocomplete". */
      kind: v.string(),
      /** Instruction-shaped sentence injected into the pipeline. */
      statement: v.string(),
      /** Short snippets that produced the pattern (newest first). */
      evidence: v.array(v.string()),
      /** How often the same preference was observed. */
      strength: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_kind", ["userId", "kind"]),

    // Published apps. A deployment is the shareable artefact of a project:
    // a stable slug served over HTTP, plus its visit count.
    deployments: defineTable({
      projectId: v.id("projects"),
      userId: v.id("users"),
      slug: v.string(),
      title: v.string(),
      /** Project version that is currently live. */
      version: v.number(),
      visits: v.number(),
      publishedAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_slug", ["slug"])
      .index("by_project", ["projectId"]),

    // daily build sessions for session-based models (6/day, Freebuff-style)
    sessions: defineTable({
      userId: v.id("users"),
      day: v.string(), // YYYY-MM-DD (computed client-side)
      used: v.number(),
    }).index("by_user_day", ["userId", "day"]),

    // Russian service connectors (Битрикс24, 1С, amoCRM, ЮKassa, СДЭК, …).
    // Credentials are stored server-side only; the client never receives them.
    serviceConnections: defineTable({
      userId: v.id("users"),
      serviceId: v.string(), // catalog id from lib/ru-services.ts
      credentials: v.record(v.string(), v.string()), // field id → secret value
      status: v.string(), // "connected" | "error"
      statusMessage: v.optional(v.string()),
      // Stable secret for incoming webhook URLs (/webhooks/{key})
      webhookKey: v.optional(v.string()),
      // Human-friendly account info, e.g. portal url (non-secret)
      meta: v.optional(v.string()),
      lastCheckedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_user_service", ["userId", "serviceId"]),

    // Events delivered by external services to the webhook endpoint
    serviceEvents: defineTable({
      userId: v.id("users"),
      serviceId: v.string(),
      connectionId: v.id("serviceConnections"),
      event: v.string(), // e.g. "crm.lead.add"
      payload: v.any(),
    }).index("by_connection", ["connectionId"]),

    // Agent skills: per-user toggles for built-in skills and stored custom
    // skills (vendor-neutral prompt modules injected into the pipeline)
    userSkills: defineTable({
      userId: v.id("users"),
      skillId: v.string(),
      enabled: v.boolean(),
      // Discriminator: rows created by the Tools tab carry `kind: "tool"` and
      // store the tool id in `skillId`. Missing = a skill row.
      kind: v.optional(v.union(v.literal("skill"), v.literal("tool"))),
      custom: v.optional(
        v.object({
          name: v.string(),
          desc: v.string(),
          prompt: v.string(),
          category: v.union(
            v.literal("design"),
            v.literal("code"),
            v.literal("data"),
            v.literal("integration"),
            v.literal("quality"),
          ),
          source: v.optional(v.string()),
          compatibleModels: v.optional(v.array(v.string())),
        }),
      ),
    })
      .index("by_user", ["userId"])
      .index("by_user_skill", ["userId", "skillId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
