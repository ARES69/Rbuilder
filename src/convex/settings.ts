import { query } from "./_generated/server";
import { getCurrentUser } from "./users";

/**
 * Non-secret status of the platform keys this deployment can use.
 * Only booleans cross the wire — never key values.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return {
      authenticated: !!user,
      aiKey: !!process.env.OPENAI_API_KEY,
      integrationKey: !!process.env.VLY_INTEGRATION_KEY,
      emailKey: !!process.env.RESEND_API_KEY,
      paymentsKey: !!process.env.STRIPE_SECRET_KEY,
    };
  },
});
