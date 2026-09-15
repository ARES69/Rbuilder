import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { ConvexCredentialsConfig } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

/**
 * Admin sign-in with a username and password (defaults: `admin` / `admin`).
 *
 * Override the defaults by setting `ADMIN_USERNAME` / `ADMIN_PASSWORD` in the
 * project's Keys tab — do that before sharing the deployment publicly, since
 * the shipped defaults are intentionally easy to guess.
 *
 * `authorize` runs in an action context (no direct database access), so the
 * user row is provisioned by `internal.adminUsers.ensureAdmin`. Convex Auth
 * then issues a normal session and the rest of the app works unchanged.
 */

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

// The explicit annotations below break the type cycle
// adminCredentials → _generated/api → auth.ts → adminCredentials, which
// TypeScript would otherwise resolve as `any` (TS7022).
export const adminCredentials: ConvexCredentialsConfig =
  ConvexCredentials<DataModel>({
    id: "admin-credentials",
    authorize: async (
      credentials,
      ctx,
    ): Promise<{ userId: Id<"users"> } | null> => {
      const username = String(credentials.username ?? "")
        .trim()
        .toLowerCase();
      const password = String(credentials.password ?? "");

      const expectedUsername = (
        process.env.ADMIN_USERNAME ?? DEFAULT_USERNAME
      ).toLowerCase();
      const expectedPassword = process.env.ADMIN_PASSWORD ?? DEFAULT_PASSWORD;

      if (!username || !password) {
        throw new Error("Введите логин и пароль");
      }
      if (username !== expectedUsername || password !== expectedPassword) {
        throw new Error("Неверный логин или пароль");
      }

      const userId: Id<"users"> = await ctx.runMutation(
        internal.adminUsers.ensureAdmin,
        { name: expectedUsername },
      );
      return { userId };
    },
  });
