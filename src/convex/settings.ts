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
      // Not a secret: the OpenAI-compatible endpoint the pipeline calls.
      // RF users can point it at DeepSeek / GLM (rubles, no foreign card).
      aiBaseUrl:
        (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      integrationKey: !!process.env.VLY_INTEGRATION_KEY,
      emailKey: !!process.env.RESEND_API_KEY,
      paymentsKey: !!process.env.STRIPE_SECRET_KEY,
    };
  },
});
