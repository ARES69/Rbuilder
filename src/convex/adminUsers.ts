import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ROLES } from "./schema";

/**
 * Database side of the admin sign-in.
 *
 * The credentials provider's `authorize` runs in an action context, which has
 * no direct database access, so user provisioning lives here as an internal
 * mutation that the provider calls through `ctx.runMutation`.
 */

/** Fixed account the admin credentials provider signs in. */
export const ADMIN_EMAIL = "admin@rbuilder.local";

/**
 * Find (or create) the admin account and make sure it carries the admin role.
 * Returns the user id for the session Convex Auth is about to create.
 */
export const ensureAdmin = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", ADMIN_EMAIL))
      .unique();

    if (!existing) {
      return await ctx.db.insert("users", {
        email: ADMIN_EMAIL,
        name,
        role: ROLES.ADMIN,
        emailVerificationTime: Date.now(),
        isAnonymous: false,
      });
    }

    if (existing.role !== ROLES.ADMIN) {
      await ctx.db.patch(existing._id, { role: ROLES.ADMIN });
    }
    return existing._id;
  },
});
