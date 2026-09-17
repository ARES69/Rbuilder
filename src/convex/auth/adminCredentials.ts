import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { ConvexCredentialsConfig } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

/**
 * Admin sign-in with a username and password.
 *
 * Fail-closed by design: there are **no default credentials**. Sign-in only
 * works when `ADMIN_PASSWORD` is set in the deployment's environment, so a
 * freshly deployed instance cannot be entered with a shipped `admin`/`admin`.
 * Set `ADMIN_USERNAME` (defaults to `admin`) and `ADMIN_PASSWORD` before you
 * need the console.
 *
 * `authorize` runs in an action context (no direct database access), so the
 * user row is provisioned by `internal.adminUsers.ensureAdmin`. Convex Auth
 * then issues a normal session and the rest of the app works unchanged.
 */

const DEFAULT_USERNAME = "admin";
const MIN_PASSWORD_LENGTH = 12;

/** Constant-ish comparison so a wrong password does not short-circuit. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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

      const configured = process.env.ADMIN_PASSWORD ?? "";
      if (configured.length < MIN_PASSWORD_LENGTH) {
        throw new Error(
          "Админ-вход отключён: задайте ADMIN_PASSWORD (не короче 12 символов) в переменных окружения Convex.",
        );
      }

      if (!username || !password) {
        throw new Error("Введите логин и пароль");
      }

      const expectedUsername = (
        process.env.ADMIN_USERNAME ?? DEFAULT_USERNAME
      ).toLowerCase();

      if (
        username !== expectedUsername ||
        !safeEqual(password, configured)
      ) {
        throw new Error("Неверный логин или пароль");
      }

      const userId: Id<"users"> = await ctx.runMutation(
        internal.adminUsers.ensureAdmin,
        { name: expectedUsername },
      );
      return { userId };
    },
  });
