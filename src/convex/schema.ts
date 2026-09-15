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

    attachments: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      mimeType: v.string(),
      size: v.number(),
      storageId: v.optional(v.id("_storage")),
    }).index("by_project", ["projectId"]),

    // daily build sessions for session-based models (6/day, Freebuff-style)
    sessions: defineTable({
      userId: v.id("users"),
      day: v.string(), // YYYY-MM-DD (computed client-side)
      used: v.number(),
    }).index("by_user_day", ["userId", "day"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
