import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";
import { findService, type RuService, type ServiceField } from "../lib/ru-services";

/* --------------------------------- queries -------------------------------- */

/** List the current user's connections. Credentials never leave the server. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("serviceConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      serviceId: row.serviceId,
      status: row.status,
      statusMessage: row.statusMessage,
      webhookKey: row.webhookKey,
      meta: row.meta,
      lastCheckedAt: row.lastCheckedAt,
      _creationTime: row._creationTime,
    }));
  },
});

/** Recent webhook deliveries across all of the user's connections. */
export const listEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 30 }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const connections = await ctx.db
      .query("serviceConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (connections.length === 0) return [];
    const byId = new Map(connections.map((c) => [c._id as string, c]));
    const events = await ctx.db
      .query("serviceEvents")
      .filter((q) =>
        q.or(
          ...connections.map((connection) =>
            q.eq(q.field("connectionId"), connection._id),
          ),
        ),
      )
      .order("desc")
      .take(limit);
    return events.map((event) => ({
      _id: event._id,
      serviceId: event.serviceId,
      event: event.event,
      payload: event.payload,
      _creationTime: event._creationTime,
      connectionMeta: byId.get(event.connectionId)?.meta,
    }));
  },
});

/* -------------------------------- mutations ------------------------------- */

/** Remove a connection and its stored credentials entirely. */
export const disconnect = mutation({
  args: { connectionId: v.id("serviceConnections") },
  handler: async (ctx, { connectionId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");
    const connection = await ctx.db.get(connectionId);
    if (!connection || connection.userId !== user._id) {
      throw new Error("Подключение не найдено");
    }
    const events = await ctx.db
      .query("serviceEvents")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }
    await ctx.db.delete(connectionId);
  },
});

/** Regenerate the incoming-webhook secret for a connection. */
export const rotateWebhookKey = mutation({
  args: { connectionId: v.id("serviceConnections") },
  handler: async (ctx, { connectionId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Требуется вход в аккаунт");
    const connection = await ctx.db.get(connectionId);
    if (!connection || connection.userId !== user._id) {
      throw new Error("Подключение не найдено");
    }
    const webhookKey = newWebhookKey();
    await ctx.db.patch(connectionId, { webhookKey });
    return { webhookKey };
  },
});

/* ------------------------------ connect actions ---------------------------- */

/**
 * Save credentials for a service and verify them immediately by calling the
 * service's API from the server. Credentials are stored in the connection
 * row and are never returned to the client.
 */
export const connect = action({
  args: {
    serviceId: v.string(),
    credentials: v.record(v.string(), v.string()),
  },
  handler: async (ctx, { serviceId, credentials }): Promise<ConnectResult> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Требуется вход в аккаунт");

    const service = findService(serviceId);
    if (!service) throw new Error(`Неизвестный сервис: ${serviceId}`);

    // All required credential fields must be present
    for (const field of service.fields) {
      if (field.required) {
        const value = (credentials[field.id] ?? "").trim();
        if (!value) throw new Error(`Заполните поле «${field.label}»`);
      }
    }

    const meta = pickMeta(service, credentials);
    const connectionId: string = await ctx.runMutation(
      internal.serviceConnections.upsertConnection,
      { userId: user._id, serviceId, credentials, meta },
    );

    const result = await runTest(service.pattern, credentials);

    await ctx.runMutation(internal.serviceConnections.finalizeConnection, {
      connectionId: connectionId as Id<"serviceConnections">,
      ok: result.ok,
      message: result.message,
      issueKey: true,
    });

    return { ok: result.ok, message: result.message };
  },
});

/** Re-verify a saved connection using its stored credentials. */
export const retest = action({
  args: { connectionId: v.id("serviceConnections") },
  handler: async (ctx, { connectionId }): Promise<TestResult> => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Требуется вход в аккаунт");

    const connection = await ctx.runQuery(internal.serviceConnections.getConnection, {
      connectionId,
    });
    if (!connection || connection.userId !== user._id) {
      throw new Error("Подключение не найдено");
    }
    const service = findService(connection.serviceId);
    if (!service) throw new Error("Неизвестный сервис");

    const result = await runTest(service.pattern, connection.credentials);
    await ctx.runMutation(internal.serviceConnections.finalizeConnection, {
      connectionId,
      ok: result.ok,
      message: result.message,
      issueKey: false,
    });
    return result;
  },
});

/* --------------------------- connection-test logic ------------------------- */

interface TestResult {
  ok: boolean;
  message: string;
}

type ConnectResult = TestResult;

const ok = (message: string): TestResult => ({ ok: true, message });
const fail = (message: string): TestResult => ({ ok: false, message });

function newWebhookKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
    if (i === 7 || i === 15 || i === 23) key += "-";
  }
  return key;
}

async function runTest(
  pattern: RuService["pattern"],
  credentials: Record<string, string>,
): Promise<TestResult> {
  try {
    return await testConnection(pattern, credentials);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Не удалось связаться с сервисом");
  }
}

async function testConnection(
  pattern: RuService["pattern"],
  credentials: Record<string, string>,
): Promise<TestResult> {
  const f = (id: string) => (credentials[id] ?? "").trim();

  switch (pattern) {
    case "bitrix-rest": {
      const portal = f("portalUrl").replace(/\/+$/, "");
      const key = f("webhookKey").replace(/^\/+|\/+$/g, "");
      if (!/^https?:\/\//.test(portal)) {
        return fail("Адрес портала должен начинаться с http:// или https://");
      }
      const response = await withTimeout(fetch(`${portal}/rest/${key}/profile.json`));
      const data = await jsonOf(response);
      if (data?.result?.ID) {
        const who = data.result.NAME || data.result.EMAIL || "пользователь";
        return ok(`Битрикс24 подключён: ${who}`);
      }
      if (data?.error) {
        return fail(`Битрикс24: ${data.error}${data.error_description ? ` — ${data.error_description}` : ""}`);
      }
      return fail("Битрикс24 не вернул профиль — проверьте адрес портала и ключ входящего webhook");
    }

    case "bitrix-oauth": {
      const response = await withTimeout(
        fetch("https://oauth.bitrix.info/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: f("clientId"),
            client_secret: f("clientSecret"),
            grant_type: "client_credentials",
          }),
        }),
      );
      const data = await jsonOf(response);
      if (data?.access_token) return ok("Битрикс24 OAuth: приложение подтверждено, токен получен");
      return fail(`Битрикс24 OAuth: ${data?.error ?? "отказано в доступе"}${data?.error_description ? ` — ${data.error_description}` : ""}`);
    }

    case "o3-com": {
      const base = f("baseUrl").replace(/\/+$/, "");
      const auth = btoa(`${f("username")}:${f("password")}`);
      const response = await withTimeout(fetch(base, { headers: { Authorization: `Basic ${auth}` } }));
      if (response.status === 401 || response.status === 403) {
        return fail(`1С: публикация отвечает, но доступ запрещён (HTTP ${response.status}) — проверьте логин и пароль`);
      }
      if (!response.ok) {
        return fail(`1С: публикация недоступна (HTTP ${response.status})`);
      }
      return ok("1С: публикация отвечает, авторизация пройдена");
    }

    case "amocrm-oauth": {
      const raw = f("subdomain");
      const base = /^https?:\/\//.test(raw)
        ? raw.replace(/\/+$/, "")
        : `https://${raw.replace(/\/+$/, "")}.amocrm.ru`;
      const response = await withTimeout(
        fetch(`${base}/api/v4/account`, {
          headers: { Authorization: `Bearer ${f("accessToken")}` },
        }),
      );
      const data = await jsonOf(response);
      if (response.ok && data?.id) {
        return ok(`amoCRM подключена: аккаунт «${data.name ?? data.subdomain}»`);
      }
      if (response.status === 401) {
        return fail("amoCRM: токен недействителен (401) — выпустите новый долгосрочный токен");
      }
      return fail(`amoCRM: сервер ответил ${response.status}`);
    }

    case "yookassa-shop": {
      const auth = btoa(`${f("shopId")}:${f("secretKey")}`);
      const response = await withTimeout(
        fetch("https://api.yookassa.ru/v3/payments?limit=1", {
          headers: { Authorization: `Basic ${auth}` },
        }),
      );
      if (response.ok) return ok("ЮKassa подключена: доступ к платежам подтверждён");
      if (response.status === 401 || response.status === 403) {
        return fail(`ЮKassa: проверьте shopId и секретный ключ (HTTP ${response.status})`);
      }
      return fail(`ЮKassa: сервер ответил ${response.status}`);
    }

    case "tinkoff-terminal": {
      const response = await withTimeout(
        fetch("https://securepay.tinkoff.ru/v2/GetState", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            TerminalKey: f("terminalKey"),
            Password: f("password"),
            PaymentId: "0",
          }),
        }),
      );
      const data = await jsonOf(response);
      if (!response.ok) return fail(`Т-Банк: сервер ответил ${response.status}`);
      const message = String(data?.Message ?? data?.Details ?? "");
      if (/парол|password/i.test(message)) {
        return fail(`Т-Банк: неверный пароль терминала — ${message}`);
      }
      return ok("Т-Банк: терминал отвечает, подключение установлено");
    }

    case "cdek-oauth": {
      const base = f("apiUrl").replace(/\/+$/, "") || "https://api.cdek.ru/v2";
      const params = new URLSearchParams({
        client_id: f("account"),
        client_secret: f("securePassword"),
        type: "client_credentials",
      });
      const response = await withTimeout(fetch(`${base}/oauth/token?${params}`, { method: "POST" }));
      const data = await jsonOf(response);
      if (data?.access_token) return ok("СДЭК подключён: авторизация пройдена");
      return fail(`СДЭК: ${data?.error_description ?? data?.error ?? `сервер ответил ${response.status}`}`);
    }

    case "boxberry-token": {
      const url = f("apiUrl").replace(/\/+$/, "") || "https://api.boxberry.ru/json.php";
      const response = await withTimeout(
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: f("token"), method: "ListCities" }),
        }),
      );
      const data = await jsonOf(response);
      if (Array.isArray(data)) return ok(`Boxberry подключён: получено ${data.length} городов`);
      return fail(`Boxberry: ${data?.err ?? `неожиданный ответ (HTTP ${response.status})`}`);
    }

    case "dadata-api": {
      const response = await withTimeout(
        fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Token ${f("apiKey")}`,
            "X-Secret": f("secretKey"),
          },
          body: JSON.stringify({ query: "7707083893" }),
        }),
      );
      const data = await jsonOf(response);
      if (response.ok && Array.isArray(data?.suggestions)) {
        return ok("DaData подключена: ключи подтверждены тестовым поиском компании");
      }
      if (response.status === 401 || response.status === 403) {
        return fail(`DaData: ключи отклонены (HTTP ${response.status})`);
      }
      return fail(`DaData: сервер ответил ${response.status}`);
    }

    case "tg-bot": {
      const token = f("botToken");
      const meResponse = await withTimeout(fetch(`https://api.telegram.org/bot${token}/getMe`));
      const me = await jsonOf(meResponse);
      if (!me?.ok) {
        return fail(`Telegram: бот-токен отклонён — ${me?.description ?? `HTTP ${meResponse.status}`}`);
      }
      const chatId = f("chatId");
      if (chatId) {
        const send = await withTimeout(
          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: "RBuilder: проверка связи ✓" }),
          }),
        );
        const sent = await jsonOf(send);
        if (!sent?.ok) {
          return fail(`Telegram: бот в порядке, но чат ${chatId} недоступен — ${sent?.description ?? ""}`);
        }
        return ok(`Telegram: бот @${me.result.username} отправил проверочное сообщение`);
      }
      return ok(`Telegram: бот @${me.result.username} подтверждён`);
    }

    case "vk-service": {
      const response = await withTimeout(
        fetch(
          `https://api.vk.com/method/groups.getById?v=5.199&access_token=${encodeURIComponent(f("serviceToken"))}`,
        ),
      );
      const data = await jsonOf(response);
      if (data?.response) return ok("VK: сервисный токен подтверждён");
      return fail(`VK: ${data?.error?.error_msg ?? `сервер ответил ${response.status}`}`);
    }

    case "smsaero-bearer": {
      const auth = btoa(`${f("email")}:${f("apiKey")}`);
      const response = await withTimeout(
        fetch("https://api.smsaero.ru/v2/balance", {
          headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        }),
      );
      const data = await jsonOf(response);
      if (data?.success) return ok(`SMS Aero подключён: баланс ${data?.data?.balance ?? "—"} ₽`);
      return fail(`SMS Aero: ${data?.message ?? `сервер ответил ${response.status}`}`);
    }

    case "diadoc-auth": {
      const base = f("baseUrl").replace(/\/+$/, "") || "https://diadoc-api.kontur.ru";
      const auth = btoa(`${f("login")}:${f("password")}`);
      const response = await withTimeout(
        fetch(`${base}/V3/Authenticate?type=password`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}` },
        }),
      );
      if (response.ok) return ok("Диадок: аутентификация пройдена, доступ к API получен");
      if (response.status === 401 || response.status === 403) {
        return fail(`Диадок: логин или пароль отклонены (HTTP ${response.status})`);
      }
      return fail(`Диадок: сервер ответил ${response.status}`);
    }

    default:
      return fail(`Шаблон подключения «${pattern}» пока не поддерживается`);
  }
}

/* --------------------------------- helpers -------------------------------- */

function pickMeta(service: RuService, credentials: Record<string, string>): string | undefined {
  const firstUrl = service.fields.find((field: ServiceField) => field.type === "url");
  return firstUrl ? credentials[firstUrl.id] : undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Превышено время ожидания сервиса (8 с)")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- service payloads are heterogeneous */
async function jsonOf(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
