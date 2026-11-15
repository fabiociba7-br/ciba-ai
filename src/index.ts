export interface Env {
  DB: D1Database;
  AI: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  ADMIN_TOKEN: string;
  AI_MODEL?: string;
  ALLOWED_APP_IDS?: string;
  DAILY_GLOBAL_LIMIT?: string;
  DAILY_APP_LIMIT?: string;
  DAILY_DEVICE_LIMIT?: string;
  MAX_OUTPUT_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
}

import { getLimit, resolveModel, isValidAppId, ZERO_COST_MODELS, MAX_REQUESTS_PER_MINUTE } from "./policy";

type ChatMessage = { role: "user" | "assistant"; content: string };

const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

const b64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomToken = (size = 32): string => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const nowIso = () => new Date().toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10);

const allowedApps = (env: Env) =>
  new Set((env.ALLOWED_APP_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));

const isAppAllowed = async (env: Env, appId: string): Promise<boolean> => {
  const row = await env.DB.prepare(
    "SELECT enabled FROM app_registry WHERE app_id = ?"
  ).bind(appId).first<{ enabled: number }>();
  if (row) return row.enabled === 1;
  return allowedApps(env).has(appId);
};

const adminAuthorized = (request: Request, env: Env) =>
  Boolean(env.ADMIN_TOKEN) && request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;

const readRuntimeSettings = async (env: Env): Promise<Record<string, string>> => {
  const rows = await env.DB.prepare("SELECT setting_key, setting_value FROM runtime_settings").all<{
    setting_key: string; setting_value: string;
  }>();
  return Object.fromEntries((rows.results || []).map((row) => [row.setting_key, row.setting_value]));
};

const CONFIG_KEYS = new Set([
  "ai_enabled", "ai_model", "daily_global_limit", "daily_app_limit",
  "daily_device_limit", "max_output_tokens", "maintenance_mode",
]);

const publicConfig = (settings: Record<string, string>, env: Env) => ({
  service: "ciba-ai",
  ai_enabled: settings.ai_enabled !== "false" && Boolean(resolveModel(settings.ai_model, env.AI_MODEL)),
  model: resolveModel(settings.ai_model, env.AI_MODEL),
  maintenance_mode: settings.maintenance_mode === "true",
  limits: {
    global_daily: getLimit(settings.daily_global_limit || env.DAILY_GLOBAL_LIMIT, 500),
    app_daily: getLimit(settings.daily_app_limit || env.DAILY_APP_LIMIT, 200),
    device_daily: getLimit(settings.daily_device_limit || env.DAILY_DEVICE_LIMIT, 40),
    max_output_tokens: Math.min(getLimit(settings.max_output_tokens || env.MAX_OUTPUT_TOKENS, 700), 2000),
  },
});

const corsHeaders = (request: Request, env: Env): HeadersInit => {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? (allowed.includes("*") ? "*" : origin) : "null";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
};

const readJson = async (request: Request, maxBytes = 40_000): Promise<Record<string, unknown>> => {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("body_too_large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("body_too_large");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
};

const authenticateDevice = async (request: Request, env: Env) => {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length < 32 || token.length > 256) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    "SELECT device_id, app_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first<{ device_id: string; app_id: string }>();
};

const reserveQuota = async (env: Env, appId: string, deviceId: string) => {
  const day = utcDay();
  const timestamp = nowIso();
  const settings = await readRuntimeSettings(env);
  const globalLimit = getLimit(settings.daily_global_limit || env.DAILY_GLOBAL_LIMIT, 500);
  const appLimit = getLimit(settings.daily_app_limit || env.DAILY_APP_LIMIT, 200);
  const deviceLimit = getLimit(settings.daily_device_limit || env.DAILY_DEVICE_LIMIT, 40);

  // One multi-row UPSERT is atomic. The trigger aborts the whole statement
  // if any of the three buckets would exceed its limit.
  await env.DB.prepare(`
    INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at)
    VALUES
      (?, 'global', 1, ?, ?),
      (?, ?, 1, ?, ?),
      (?, ?, 1, ?, ?)
    ON CONFLICT(day, scope_key) DO UPDATE SET
      requests = daily_usage.requests + 1,
      request_limit = excluded.request_limit,
      updated_at = excluded.updated_at
  `).bind(
    day, globalLimit, timestamp,
    day, `app:${appId}`, appLimit, timestamp,
    day, `device:${deviceId}`, deviceLimit, timestamp
  ).run();
};

const reserveMinuteRateLimit = async (env: Env, deviceId: string) => {
  const minute = new Date().toISOString().slice(0, 16);
  await env.DB.prepare(`
    INSERT INTO minute_usage(minute, device_id, requests, request_limit, updated_at)
    VALUES(?, ?, 1, ?, ?)
    ON CONFLICT(minute, device_id) DO UPDATE SET
      requests = minute_usage.requests + 1,
      request_limit = excluded.request_limit,
      updated_at = excluded.updated_at
  `).bind(minute, deviceId, MAX_REQUESTS_PER_MINUTE, nowIso()).run();
};

const usageFor = async (env: Env, appId: string, deviceId: string) => {
  const day = utcDay();
  const rows = await env.DB.prepare(
    "SELECT scope_key, requests, request_limit FROM daily_usage WHERE day = ? AND scope_key IN ('global', ?, ?)"
  ).bind(day, `app:${appId}`, `device:${deviceId}`).all<{
    scope_key: string; requests: number; request_limit: number;
  }>();
  return { day, buckets: rows.results || [] };
};

const handleRegister = async (request: Request, env: Env) => {
  const body = await readJson(request, 8_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  const invite = typeof body.invitation_code === "string" ? body.invitation_code.trim() : "";
  if (!isValidAppId(appId) || !(await isAppAllowed(env, appId))) {
    return json({ error: "app_not_allowed" }, 403);
  }
  if (invite.length < 20 || invite.length > 256) return json({ error: "invalid_invitation" }, 400);

  const deviceId = crypto.randomUUID();
  const deviceToken = randomToken(36);
  const tokenHash = await sha256(deviceToken);
  const invitationHash = await sha256(invite);
  const timestamp = nowIso();

  // D1 batch is transactional: if the invitation is not consumed, the
  // INSERT ... SELECT creates no device. If insertion fails, the batch rolls back.
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE invitations
      SET used_at = ?, consumed_device_id = ?
      WHERE code_hash = ? AND app_id = ? AND used_at IS NULL AND expires_at > ?
    `).bind(timestamp, deviceId, invitationHash, appId, timestamp),
    env.DB.prepare(`
      INSERT INTO devices(device_id, app_id, token_hash, created_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM invitations
        WHERE code_hash = ? AND app_id = ? AND used_at = ?
          AND consumed_device_id = ?
      )
    `).bind(deviceId, appId, tokenHash, timestamp, timestamp,
      invitationHash, appId, timestamp, deviceId),
  ]);

  if ((results[0]?.meta?.changes || 0) !== 1 || (results[1]?.meta?.changes || 0) !== 1) {
    return json({ error: "invalid_or_used_invitation" }, 401);
  }
  return json({ device_id: deviceId, access_token: deviceToken, token_type: "Bearer" }, 201);
};

const handleCreateInvitation = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await readJson(request, 4_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!isValidAppId(appId) || !(await isAppAllowed(env, appId))) return json({ error: "app_not_allowed" }, 400);

  const hours = typeof body.valid_hours === "number" && Number.isInteger(body.valid_hours)
    ? Math.min(Math.max(body.valid_hours, 1), 168) : 24;
  const code = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO invitations(code_hash, app_id, created_at, expires_at) VALUES(?, ?, ?, ?)"
  ).bind(await sha256(code), appId, createdAt, expiresAt).run();

  return json({ invitation_code: code, app_id: appId, expires_at: expiresAt }, 201);
};

const handleRevokeDevice = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await readJson(request, 4_000);
  const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
  if (!deviceId || deviceId.length > 100) return json({ error: "invalid_device_id" }, 400);
  const result = await env.DB.prepare(
    "UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL"
  ).bind(nowIso(), deviceId).run();
  return result.meta.changes === 1
    ? json({ revoked: true, device_id: deviceId })
    : json({ error: "device_not_found_or_already_revoked" }, 404);
};

const handleChat = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);

  try {
    await reserveMinuteRateLimit(env, device.device_id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("request_rate_exceeded")) {
      return json({ error: "rate_limit_exceeded", retry_after_seconds: 60 }, 429);
    }
    throw error;
  }

  const settings = await readRuntimeSettings(env);
  if (settings.maintenance_mode === "true") return json({ error: "maintenance_mode" }, 503);
  if (settings.ai_enabled === "false") return json({ error: "ai_disabled" }, 503);
  const body = await readJson(request);
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return json({ error: "invalid_messages" }, 400);
  }
  const messages: ChatMessage[] = [];
  let totalChars = 0;
  for (const item of body.messages) {
    if (!item || typeof item !== "object") return json({ error: "invalid_message" }, 400);
    const message = item as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" || message.content.length > 12_000) {
      return json({ error: "invalid_message" }, 400);
    }
    totalChars += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (totalChars > 30_000) return json({ error: "prompt_too_large" }, 413);

  try {
    await reserveQuota(env, device.app_id, device.device_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("quota_exceeded")) return json({ error: "daily_quota_exceeded" }, 429);
    throw error;
  }

  const model = resolveModel(settings.ai_model, env.AI_MODEL);
  if (!model) return json({ error: "ai_model_not_available" }, 503);
  const maxTokens = Math.min(getLimit(settings.max_output_tokens || env.MAX_OUTPUT_TOKENS, 700), 2_000);
  const inputMessages = [
    { role: "system", content: "Você é o assistente de IA dos aplicativos Ciba. Responda em português quando o usuário escrever em português. Seja claro, útil e seguro." },
    ...messages,
  ];

  const result = await env.AI.run(model, { messages: inputMessages, max_completion_tokens: maxTokens });
  const output = result as { response?: unknown; [key: string]: unknown };
  await env.DB.prepare(
    "UPDATE devices SET last_seen_at = ? WHERE device_id = ?"
  ).bind(nowIso(), device.device_id).run();

  return json({
    model,
    response: typeof output?.response === "string" ? output.response : output,
  });
};

const handleAdminDevices = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const appId = url.searchParams.get("app_id");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const rows = appId
    ? await env.DB.prepare("SELECT device_id, app_id, created_at, last_seen_at, revoked_at FROM devices WHERE app_id = ? ORDER BY created_at DESC LIMIT ?").bind(appId, limit).all()
    : await env.DB.prepare("SELECT device_id, app_id, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ devices: rows.results || [] });
};

const handleAdminInvitations = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const appId = url.searchParams.get("app_id");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const rows = appId
    ? await env.DB.prepare("SELECT app_id, created_at, expires_at, used_at, consumed_device_id FROM invitations WHERE app_id = ? ORDER BY created_at DESC LIMIT ?").bind(appId, limit).all()
    : await env.DB.prepare("SELECT app_id, created_at, expires_at, used_at, consumed_device_id FROM invitations ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ invitations: rows.results || [] });
};

const handleAdminApps = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT app_id, display_name, enabled, created_at, updated_at FROM app_registry ORDER BY display_name"
    ).all();
    return json({ apps: rows.results || [] });
  }
  const body = await readJson(request, 4_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const enabled = body.enabled === undefined ? true : body.enabled;
  if (!isValidAppId(appId) || !displayName || displayName.length > 100 ||
      typeof enabled !== "boolean") return json({ error: "invalid_app" }, 400);
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO app_registry(app_id, display_name, enabled, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET display_name = excluded.display_name, enabled = excluded.enabled, updated_at = excluded.updated_at"
  ).bind(appId, displayName, enabled ? 1 : 0, timestamp, timestamp).run();
  return json({ saved: true, app_id: appId, display_name: displayName, enabled });
};

const handleAdminSettings = async (request: Request, env: Env) => {
  if (!adminAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (request.method === "GET") {
    return json({ settings: await readRuntimeSettings(env), configurable_keys: [...CONFIG_KEYS] });
  }
  const body = await readJson(request, 8_000);
  const values = body.settings;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return json({ error: "invalid_settings" }, 400);
  }
  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length === 0 || entries.length > CONFIG_KEYS.size) {
    return json({ error: "invalid_settings" }, 400);
  }
  const statements = [];
  for (const [key, value] of entries) {
    if (!CONFIG_KEYS.has(key) || !["string", "boolean", "number"].includes(typeof value)) {
      return json({ error: "invalid_setting", key }, 400);
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 300) return json({ error: "invalid_setting", key }, 400);
    if (key === "ai_model" && !ZERO_COST_MODELS.has(normalized)) {
      return json({ error: "invalid_ai_model" }, 400);
    }
    if (["daily_global_limit", "daily_app_limit", "daily_device_limit", "max_output_tokens"].includes(key)) {
      const n = Number(normalized);
      if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return json({ error: "invalid_numeric_setting", key }, 400);
    }
    if (["ai_enabled", "maintenance_mode"].includes(key) && !["true", "false"].includes(normalized)) {
      return json({ error: "invalid_boolean_setting", key }, 400);
    }
    statements.push(env.DB.prepare(
      "INSERT INTO runtime_settings(setting_key, setting_value, updated_at) VALUES(?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at"
    ).bind(key, normalized, nowIso()));
  }
  await env.DB.batch(statements);
  return json({ saved: entries.map(([key]) => key), settings: await readRuntimeSettings(env) });
};

const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/v1/admin/devices" && request.method === "GET") {
    return handleAdminDevices(request, env);
  }
  if (url.pathname === "/v1/admin/invitations" && request.method === "GET") {
    return handleAdminInvitations(request, env);
  }
  if (url.pathname === "/v1/admin/apps" && (request.method === "GET" || request.method === "POST")) {
    return handleAdminApps(request, env);
  }
  if (url.pathname === "/v1/admin/settings" && (request.method === "GET" || request.method === "POST")) {
    return handleAdminSettings(request, env);
  }
  if (url.pathname === "/v1/config" && request.method === "GET") {
    const settings = await readRuntimeSettings(env);
    return json(publicConfig(settings, env));
  }
  if (url.pathname === "/v1/status" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    const settings = await readRuntimeSettings(env);
    return json({
      service: "ciba-ai",
      status: "ready",
      database: "connected",
      ai_enabled: settings.ai_enabled !== "false" && Boolean(resolveModel(settings.ai_model, env.AI_MODEL)),
      maintenance_mode: settings.maintenance_mode === "true",
      inference: "cloudflare-workers-ai",
    });
  }
  if (url.pathname === "/v1/models" && request.method === "GET") {
    const settings = await readRuntimeSettings(env);
    const model = settings.ai_model || env.AI_MODEL || null;
    return json({ models: model ? [model] : [], configured: Boolean(model) });
  }
  if (url.pathname === "/v1/auth/register" && request.method === "POST") {
    return handleRegister(request, env);
  }
  if (url.pathname === "/v1/admin/invitations" && request.method === "POST") {
    return handleCreateInvitation(request, env);
  }
  if (url.pathname === "/v1/admin/devices/revoke" && request.method === "POST") {
    return handleRevokeDevice(request, env);
  }
  if (url.pathname === "/v1/ai/chat" && request.method === "POST") {
    return handleChat(request, env);
  }
  if (url.pathname === "/v1/usage" && request.method === "GET") {
    const device = await authenticateDevice(request, env);
    if (!device) return json({ error: "unauthorized" }, 401);
    return json(await usageFor(env, device.app_id, device.device_id));
  }
  return json({ error: "not_found" }, 404);
};

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const usageCutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invitationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM daily_usage WHERE day < ?").bind(usageCutoff),
      env.DB.prepare("DELETE FROM minute_usage WHERE minute < ?").bind(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)),
      env.DB.prepare("DELETE FROM invitations WHERE expires_at < ? AND used_at IS NULL").bind(invitationCutoff),
    ]);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    try {
      const response = await handleRequest(request, env);
      const headers = new Headers(response.headers);
      new Headers(cors).forEach((value, key) => headers.set(key, value));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      // Do not expose database errors, tokens, prompts, or provider internals.
      const reason = error instanceof Error ? error.message : "";
      if (reason === "body_too_large") {
        const response = json({ error: "body_too_large" }, 413);
        const headers = new Headers(response.headers);
        new Headers(cors).forEach((value, key) => headers.set(key, value));
        return new Response(response.body, { status: response.status, headers });
      }
      if (reason === "invalid_json") {
        const response = json({ error: "invalid_json" }, 400);
        const headers = new Headers(response.headers);
        new Headers(cors).forEach((value, key) => headers.set(key, value));
        return new Response(response.body, { status: response.status, headers });
      }
      console.error("Ciba AI request failed", error instanceof Error ? error.name : "unknown");
      const response = json({ error: "internal_error" }, 500);
      const headers = new Headers(response.headers);
      new Headers(cors).forEach((value, key) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }
  },
};
