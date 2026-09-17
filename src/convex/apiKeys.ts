import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getCurrentUser } from "./users";
import { generateApiKey, hashApiKey, maskApiKey } from "../lib/public-api";

/**
 * Public API keys.
 *
 * Creation returns the plaintext once; afterwards only the hash exists. The
 * hashing runs in an action because the Web Crypto API is guaranteed there.
 */

export const create = action({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Not authenticated");

    const key = generateApiKey();
    const hash = await hashApiKey(key);
    const label = (name?.trim() || "API key").slice(0, 60);

    await ctx.runMutation(internal.apiKeys.insertKey, {
      userId: user._id,
      name: label,
      prefix: maskApiKey(key),
      hash,
    });

    return { key, name: label };
  },
});

export const insertKey = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const active = existing.filter((row) => !row.revokedAt);
    if (active.length >= 10) {
      throw new Error("Достигнут лимит: 10 активных ключей. Отзовите ненужный.");
    }
    return await ctx.db.insert("apiKeys", {
      userId: args.userId,
      name: args.name,
      prefix: args.prefix,
      hash: args.hash,
      requestCount: 0,
      createdAt: Date.now(),
    });
  },
});

/** The user's own keys — never their hashes. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        prefix: row.prefix,
        requestCount: row.requestCount,
        lastUsedAt: row.lastUsedAt ?? null,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt ?? null,
      }));
  },
});

export const revoke = mutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const row = await ctx.db.get(keyId);
    if (!row || row.userId !== user._id) throw new Error("Ключ не найден");
    await ctx.db.patch(keyId, { revokedAt: Date.now() });
  },
});

/**
 * Resolve a bearer token to its owner. Called from the HTTP layer, which has
 * no session of its own — the key *is* the identity.
 */
export const verifyByHash = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!row || row.revokedAt) return null;
    const user = await ctx.db.get(row.userId);
    if (!user) return null;
    return {
      keyId: row._id,
      userId: row.userId,
      keyName: row.name,
      isAnonymous: Boolean(user.isAnonymous),
    };
  },
});

/** Usage bookkeeping for a verified key. */
export const touch = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    const row = await ctx.db.get(keyId);
    if (!row) return;
    await ctx.db.patch(keyId, {
      requestCount: row.requestCount + 1,
      lastUsedAt: Date.now(),
    });
  },
});

/** Used by the API dialog to show the account the key belongs to. */
export const account = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return { email: user.email ?? null, name: user.name ?? null };
  },
});
