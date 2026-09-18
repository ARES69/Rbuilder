/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminUsers from "../adminUsers.js";
import type * as apiKeys from "../apiKeys.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as auth_adminCredentials from "../auth/adminCredentials.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as builds from "../builds.js";
import type * as deployments from "../deployments.js";
import type * as fileDocs from "../fileDocs.js";
import type * as generation from "../generation.js";
import type * as http from "../http.js";
import type * as importSource from "../importSource.js";
import type * as integrations from "../integrations.js";
import type * as messages from "../messages.js";
import type * as modelRelay from "../modelRelay.js";
import type * as patterns from "../patterns.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projectVersions from "../projectVersions.js";
import type * as projects from "../projects.js";
import type * as research from "../research.js";
import type * as serviceConnections from "../serviceConnections.js";
import type * as sessions from "../sessions.js";
import type * as settings from "../settings.js";
import type * as skills from "../skills.js";
import type * as snapshots from "../snapshots.js";
import type * as tools from "../tools.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminUsers: typeof adminUsers;
  apiKeys: typeof apiKeys;
  attachments: typeof attachments;
  auth: typeof auth;
  "auth/adminCredentials": typeof auth_adminCredentials;
  "auth/emailOtp": typeof auth_emailOtp;
  builds: typeof builds;
  deployments: typeof deployments;
  fileDocs: typeof fileDocs;
  generation: typeof generation;
  http: typeof http;
  importSource: typeof importSource;
  integrations: typeof integrations;
  messages: typeof messages;
  modelRelay: typeof modelRelay;
  patterns: typeof patterns;
  projectFiles: typeof projectFiles;
  projectVersions: typeof projectVersions;
  projects: typeof projects;
  research: typeof research;
  serviceConnections: typeof serviceConnections;
  sessions: typeof sessions;
  settings: typeof settings;
  skills: typeof skills;
  snapshots: typeof snapshots;
  tools: typeof tools;
  usage: typeof usage;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
