import { GARCIA_DASHBOARD_HTML } from "./dashboard";
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

import { getLimit, resolveModel, isValidAppId, ZERO_COST_MODELS, MAX_REQUESTS_PER_MINUTE, MAX_ADMIN_AUTH_FAILURES_PER_MINUTE, MAX_DAILY_GLOBAL_LIMIT, MAX_DAILY_APP_LIMIT, MAX_DAILY_DEVICE_LIMIT, MAX_OUTPUT_TOKENS, MAX_MESSAGE_CHARS, MAX_TOTAL_INPUT_CHARS } from "./policy";
import { runCibaOrchestrator, CloudflareWorkersAIProvider, createProviderRegistry, listAgents } from "./core";
import { validateCuratedMemory } from "./core/memory";
import { prepareMemoryCandidate } from "./core/memory-candidates";
import { rankRelevantMemories, buildChatMemoryContext, type MemorySearchRecord } from "./core/memory-retrieval";
import { validateAppProfile, parseStoredAppCapabilities, parseStoredAppTaskTypes } from "./core/apps/registry";
import { isAppTaskType, selectTaskRoute } from "./core/task-coordinator";
import { consolidateTaskResults, type TaskResultRecord } from "./core/task-results";
import { buildTaskSynthesisRequest, MAX_TASK_SYNTHESIS_OUTPUT_TOKENS } from "./core/task-synthesis";

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
const secondsUntilUtcDayReset = () => {
  const now = new Date();
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
};

const allowedApps = (env: Env) =>
  new Set((env.ALLOWED_APP_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));

const isAppAllowed = async (env: Env, appId: string): Promise<boolean> => {
  const row = await env.DB.prepare(
    "SELECT enabled FROM app_registry WHERE app_id = ?"
  ).bind(appId).first<{ enabled: number }>();
  if (row) return row.enabled === 1;
  return allowedApps(env).has(appId);
};

const authorizeAdmin = async (request: Request, env: Env): Promise<Response | null> => {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
    return json({ error: "admin_auth_not_configured" }, 503);
  }

  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const candidate = supplied.length <= 256 ? supplied : "";
  const [expectedHash, candidateHash] = await Promise.all([
    sha256(env.ADMIN_TOKEN),
    sha256(candidate),
  ]);

  // Compare fixed-length digests to avoid leaking a matching token prefix.
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ candidateHash.charCodeAt(index);
  }
  if (difference === 0 && supplied.length > 0) return null;

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(`${ip}:${env.ADMIN_TOKEN}`);
  const minute = new Date().toISOString().slice(0, 16);
  try {
    await env.DB.prepare(`
      INSERT INTO admin_auth_usage(minute, ip_hash, attempts, attempt_limit, updated_at)
      VALUES(?, ?, 1, ?, ?)
      ON CONFLICT(minute, ip_hash) DO UPDATE SET
        attempts = admin_auth_usage.attempts + 1,
        attempt_limit = excluded.attempt_limit,
        updated_at = excluded.updated_at
    `).bind(minute, ipHash, MAX_ADMIN_AUTH_FAILURES_PER_MINUTE, nowIso()).run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("admin_auth_rate_exceeded")) {
      return json({ error: "admin_auth_rate_limited", retry_after_seconds: 60 }, 429, { "retry-after": "60" });
    }
    throw error;
  }

  return json({ error: "unauthorized" }, 401);
};

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
    global_daily: Math.min(getLimit(settings.daily_global_limit || env.DAILY_GLOBAL_LIMIT, MAX_DAILY_GLOBAL_LIMIT), MAX_DAILY_GLOBAL_LIMIT),
    app_daily: Math.min(getLimit(settings.daily_app_limit || env.DAILY_APP_LIMIT, MAX_DAILY_APP_LIMIT), MAX_DAILY_APP_LIMIT),
    device_daily: Math.min(getLimit(settings.daily_device_limit || env.DAILY_DEVICE_LIMIT, MAX_DAILY_DEVICE_LIMIT), MAX_DAILY_DEVICE_LIMIT),
    max_output_tokens: Math.min(getLimit(settings.max_output_tokens || env.MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS),
  },
});

const createRuntimeProviderRegistry = (env: Env, model: string | null, maxOutputTokens: number) => {
  const provider = new CloudflareWorkersAIProvider(env.AI);
  const roles = ["general", "reasoning", "research", "coding", "creative", "verification"] as const;
  return createProviderRegistry([provider], model ? [{
    providerId: provider.id,
    modelId: model,
    roles: [...roles],
    maxOutputTokens,
    zeroCostApproved: ZERO_COST_MODELS.has(model),
  }] : []);
};

const corsHeaders = (request: Request, env: Env): HeadersInit => {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = origin && (allowed.includes("*") || allowed.includes(origin))
    ? (allowed.includes("*") ? "*" : origin)
    : null;
  return {
    ...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
};

const applyResponseHeaders = (response: Response, cors: HeadersInit): Response => {
  const headers = new Headers(response.headers);
  new Headers(cors).forEach((value, key) => headers.set(key, value));
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const readJson = async (request: Request, maxBytes = 40_000): Promise<Record<string, unknown>> => {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("body_too_large");

  // Enforce the limit while reading; do not buffer an unbounded body before checking it.
  const reader = request.body?.getReader();
  let raw = "";
  let totalBytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error("body_too_large");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
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
    "SELECT device_id, app_id, owner_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first<{ device_id: string; app_id: string; owner_id: string | null }>();
};

const reserveQuota = async (env: Env, appId: string, deviceId: string) => {
  const day = utcDay();
  const timestamp = nowIso();
  const settings = await readRuntimeSettings(env);
  const globalLimit = Math.min(getLimit(settings.daily_global_limit || env.DAILY_GLOBAL_LIMIT, MAX_DAILY_GLOBAL_LIMIT), MAX_DAILY_GLOBAL_LIMIT);
  const appLimit = Math.min(getLimit(settings.daily_app_limit || env.DAILY_APP_LIMIT, MAX_DAILY_APP_LIMIT), MAX_DAILY_APP_LIMIT);
  const deviceLimit = Math.min(getLimit(settings.daily_device_limit || env.DAILY_DEVICE_LIMIT, MAX_DAILY_DEVICE_LIMIT), MAX_DAILY_DEVICE_LIMIT);

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
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
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

const handleCreateOwner = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
  const body = await readJson(request, 4_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!isValidAppId(appId) || !(await isAppAllowed(env, appId))) {
    return json({ error: "app_not_allowed" }, 400);
  }

  const ownerId = crypto.randomUUID();
  const code = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const codeHash = await sha256(code);
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO owners(owner_id, status, created_at) VALUES(?, 'active', ?)"
    ).bind(ownerId, createdAt),
    env.DB.prepare(`
      INSERT INTO owner_pairing_invitations(code_hash, owner_id, app_id, created_at, expires_at)
      SELECT ?, owner_id, ?, ?, ? FROM owners WHERE owner_id = ? AND status = 'active'
    `).bind(codeHash, appId, createdAt, expiresAt, ownerId),
  ]);
  if ((results[0]?.meta?.changes || 0) !== 1 || (results[1]?.meta?.changes || 0) !== 1) {
    return json({ error: "owner_creation_failed" }, 500);
  }
  return json({
    owner_id: ownerId,
    pairing_invitation_code: code,
    app_id: appId,
    expires_at: expiresAt,
    note: "Store this code securely; it is shown only once."
  }, 201);
};

const handleCreateOwnerInvitation = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
  const body = await readJson(request, 4_000);
  const ownerId = typeof body.owner_id === "string" ? body.owner_id.trim() : "";
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!ownerId || ownerId.length > 100 || !isValidAppId(appId) || !(await isAppAllowed(env, appId))) {
    return json({ error: "invalid_owner_or_app" }, 400);
  }

  const code = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO owner_pairing_invitations(code_hash, owner_id, app_id, created_at, expires_at)
    SELECT ?, owner_id, ?, ?, ? FROM owners WHERE owner_id = ? AND status = 'active'
  `).bind(await sha256(code), appId, createdAt, expiresAt, ownerId).run();

  if (result.meta.changes !== 1) return json({ error: "owner_not_found_or_revoked" }, 404);
  return json({
    pairing_invitation_code: code,
    owner_id: ownerId,
    app_id: appId,
    expires_at: expiresAt,
    note: "Store this code securely; it is shown only once."
  }, 201);
};

const handlePairOwner = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  if (device.owner_id) return json({ error: "device_already_paired" }, 409);

  const body = await readJson(request, 4_000);
  const code = typeof body.pairing_invitation_code === "string"
    ? body.pairing_invitation_code.trim() : "";
  if (code.length < 20 || code.length > 256) {
    return json({ error: "invalid_owner_pairing_invitation" }, 400);
  }

  const codeHash = await sha256(code);
  const timestamp = nowIso();
  // The first statement consumes the invitation only if this authenticated
  // device is still unlinked and belongs to the invited app. D1 batch runs
  // these statements transactionally; a consumed code cannot be replayed.
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE owner_pairing_invitations
      SET consumed_at = ?, consumed_device_id = ?
      WHERE code_hash = ? AND app_id = ? AND consumed_at IS NULL AND expires_at > ?
        AND EXISTS (
          SELECT 1 FROM owners
          WHERE owners.owner_id = owner_pairing_invitations.owner_id AND owners.status = 'active'
        )
        AND EXISTS (
          SELECT 1 FROM devices
          WHERE devices.device_id = ? AND devices.app_id = ?
            AND devices.owner_id IS NULL AND devices.revoked_at IS NULL
        )
    `).bind(timestamp, device.device_id, codeHash, device.app_id, timestamp, device.device_id, device.app_id),
    env.DB.prepare(`
      UPDATE devices
      SET owner_id = (
        SELECT owner_id FROM owner_pairing_invitations
        WHERE code_hash = ? AND consumed_at = ? AND consumed_device_id = ? AND app_id = ?
      )
      WHERE device_id = ? AND app_id = ? AND owner_id IS NULL AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM owner_pairing_invitations
          WHERE code_hash = ? AND consumed_at = ? AND consumed_device_id = ? AND app_id = ?
        )
    `).bind(codeHash, timestamp, device.device_id, device.app_id,
      device.device_id, device.app_id, codeHash, timestamp, device.device_id, device.app_id),
  ]);

  if ((results[0]?.meta?.changes || 0) !== 1) {
    return json({ error: "invalid_or_used_owner_pairing_invitation" }, 401);
  }
  if ((results[1]?.meta?.changes || 0) !== 1) {
    return json({ error: "owner_pairing_conflict" }, 409);
  }
  const paired = await env.DB.prepare(
    "SELECT owner_id FROM devices WHERE device_id = ?"
  ).bind(device.device_id).first<{ owner_id: string | null }>();
  if (!paired?.owner_id) return json({ error: "owner_pairing_failed" }, 500);
  return json({ paired: true, owner_id: paired.owner_id, app_id: device.app_id });
};

const getActiveOwnerForDevice = async (env: Env, ownerId: string | null) => {
  if (!ownerId) return null;
  return env.DB.prepare(
    "SELECT owner_id FROM owners WHERE owner_id = ? AND status = 'active'"
  ).bind(ownerId).first<{ owner_id: string }>();
};


type OwnerFeatureSettings = { memory_enabled: boolean; app_messaging_enabled: boolean };

const readOwnerFeatureSettings = async (env: Env, ownerId: string): Promise<OwnerFeatureSettings> => {
  const row = await env.DB.prepare(
    "SELECT memory_enabled, app_messaging_enabled FROM owner_settings WHERE owner_id = ?"
  ).bind(ownerId).first<{ memory_enabled: number; app_messaging_enabled: number }>();
  return {
    memory_enabled: row?.memory_enabled === 1,
    app_messaging_enabled: row?.app_messaging_enabled === 1,
  };
};

const handleOwnerAvailableApps = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const rows = await env.DB.prepare(
    "SELECT app_id, display_name FROM app_registry WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE"
  ).all<{ app_id: string; display_name: string }>();
  const apps = (rows.results || []).filter((app) => isValidAppId(app.app_id));
  return json({ apps });
};

const handleConnectOwnerApp = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const body = await readJson(request, 4_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  if (!isValidAppId(appId) || !(await isAppAllowed(env, appId))) return json({ error: "app_not_allowed" }, 400);
  const app = await env.DB.prepare(
    "SELECT app_id FROM app_registry WHERE app_id = ? AND enabled = 1"
  ).bind(appId).first<{ app_id: string }>();
  if (!app) return json({ error: "app_not_available" }, 404);
  const registrationCode = randomToken(24);
  const pairingCode = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO invitations(code_hash, app_id, created_at, expires_at) VALUES(?, ?, ?, ?)")
      .bind(await sha256(registrationCode), appId, createdAt, expiresAt),
    env.DB.prepare("INSERT INTO owner_pairing_invitations(code_hash, owner_id, app_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?)")
      .bind(await sha256(pairingCode), owner.owner_id, appId, createdAt, expiresAt),
  ]);
  if ((results[0]?.meta?.changes || 0) !== 1 || (results[1]?.meta?.changes || 0) !== 1) {
    return json({ error: "app_connection_invitation_failed" }, 500);
  }
  return json({
    app_id: appId,
    registration_invitation_code: registrationCode,
    pairing_invitation_code: pairingCode,
    expires_at: expiresAt,
    note: "Each code is shown only once. Register the device with the first code, then pair it with the second code.",
  }, 201);
};
const handleAppIdentity = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const app = await env.DB.prepare(
    "SELECT app_id, display_name, enabled, description, app_type, capabilities_json, task_types_json, contract_version FROM app_registry WHERE app_id = ?"
  ).bind(device.app_id).first<{
    app_id: string; display_name: string; enabled: number; description: string;
    app_type: string; capabilities_json: string; task_types_json: string; contract_version: string;
  }>();
  if (!app) return json({ error: "app_profile_not_found" }, 404);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  const connectedApps = owner ? await env.DB.prepare(`
    SELECT a.app_id, a.display_name, a.description, a.app_type,
      a.capabilities_json, a.task_types_json, a.contract_version,
      COUNT(DISTINCT d.device_id) AS active_device_count
    FROM devices d
    INNER JOIN app_registry a ON a.app_id = d.app_id
    WHERE d.owner_id = ? AND d.revoked_at IS NULL AND a.enabled = 1
    GROUP BY a.app_id, a.display_name, a.description, a.app_type,
      a.capabilities_json, a.task_types_json, a.contract_version
    ORDER BY a.display_name COLLATE NOCASE
  `).bind(owner.owner_id).all<{
    app_id: string; display_name: string; description: string; app_type: string;
    capabilities_json: string; task_types_json: string; contract_version: string; active_device_count: number;
  }>() : { results: [] };
  return json({
    contract: "garcia-app",
    contract_version: app.contract_version,
    identity: {
      app_id: app.app_id,
      display_name: app.display_name,
      enabled: app.enabled === 1,
      description: app.description,
      app_type: app.app_type,
      capabilities: parseStoredAppCapabilities(app.capabilities_json),
      task_types: parseStoredAppTaskTypes(app.task_types_json),
    },
    device: { device_id: device.device_id, owner_linked: Boolean(owner) },
    connected_apps: (connectedApps.results || []).map((item) => ({
      app_id: item.app_id,
      display_name: item.display_name,
      description: item.description,
      app_type: item.app_type,
      capabilities: parseStoredAppCapabilities(item.capabilities_json),
      task_types: parseStoredAppTaskTypes(item.task_types_json),
      contract_version: item.contract_version,
      active_device_count: item.active_device_count,
    })),
    capability_semantics: {
      descriptive_only: true,
      grants_required_for_cross_app_access: true,
      app_actions_executable_by_garcia: false,
    },
  });
};

const handleOwnerDashboard = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);

  const [settings, runtimeSettings, appRows, deviceRows, grantRows] = await Promise.all([
    readOwnerFeatureSettings(env, owner.owner_id),
    readRuntimeSettings(env),
    env.DB.prepare(`
      SELECT a.app_id, a.display_name, a.enabled, a.description, a.app_type,
        a.capabilities_json, a.task_types_json, a.contract_version,
        COUNT(d.device_id) AS device_count,
        SUM(CASE WHEN d.revoked_at IS NULL THEN 1 ELSE 0 END) AS active_device_count,
        MAX(d.last_seen_at) AS last_seen_at
      FROM devices d
      INNER JOIN app_registry a ON a.app_id = d.app_id
      WHERE d.owner_id = ?
      GROUP BY a.app_id, a.display_name, a.enabled, a.description, a.app_type,
        a.capabilities_json, a.task_types_json, a.contract_version
      ORDER BY a.display_name COLLATE NOCASE
    `).bind(owner.owner_id).all<{
      app_id: string; display_name: string; enabled: number; description: string;
      app_type: string; capabilities_json: string; task_types_json: string; contract_version: string;
      device_count: number; active_device_count: number; last_seen_at: string | null;
    }>(),
    env.DB.prepare(`
      SELECT d.device_id, d.app_id, a.display_name, d.created_at,
        d.last_seen_at, d.revoked_at
      FROM devices d
      INNER JOIN app_registry a ON a.app_id = d.app_id
      WHERE d.owner_id = ?
      ORDER BY d.created_at DESC LIMIT 100
    `).bind(owner.owner_id).all<{
      device_id: string; app_id: string; display_name: string;
      created_at: string; last_seen_at: string | null; revoked_at: string | null;
    }>(),
    env.DB.prepare(`
      SELECT grant_id, grantee_app_id, source_app_id, destination_app_id,
        permission, scope, created_at, expires_at, revoked_at
      FROM app_access_grants WHERE owner_id = ?
      ORDER BY created_at DESC LIMIT 200
    `).bind(owner.owner_id).all(),
  ]);

  const config = publicConfig(runtimeSettings, env);
  return json({
    identity: "Garcia",
    owner: { status: "active" },
    current_device_id: device.device_id,
    intelligence: {
      mode: "single-pass",
      enabled: config.ai_enabled,
      active: config.ai_enabled && !config.maintenance_mode,
      maintenance_mode: config.maintenance_mode,
      provider: config.model ? "cloudflare-workers-ai" : null,
      model: config.model,
      configured: Boolean(config.model),
      agents: listAgents(),
      multi_model_execution_enabled: false,
      ensemble_available_but_disabled: true,
      external_tool_execution_enabled: false,
      limits: config.limits,
    },
    features: settings,
    connected_apps: (appRows.results || []).map((app) => ({
      app_id: app.app_id,
      display_name: app.display_name,
      enabled: app.enabled === 1,
      description: app.description,
      app_type: app.app_type,
      capabilities: parseStoredAppCapabilities(app.capabilities_json),
      task_types: parseStoredAppTaskTypes(app.task_types_json),
      contract_version: app.contract_version,
      device_count: app.device_count,
      active_device_count: app.active_device_count,
      last_seen_at: app.last_seen_at,
    })),
    devices: (deviceRows.results || []).map((row) => ({
      ...row,
      status: row.revoked_at ? "revoked" : "active",
      is_current: row.device_id === device.device_id,
    })),
    access_grants: grantRows.results || [],
    limits: { maximum_devices_shown: 100, maximum_grants_shown: 200 },
    security: {
      owner_identity_derived_from_paired_device: true,
      credentials_returned: false,
      conversation_content_returned: false,
    },
  });
};


const handleOwnerSettings = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);

  if (request.method === "GET") {
    return json({ settings: await readOwnerFeatureSettings(env, owner.owner_id) });
  }

  const body = await readJson(request, 2_000);
  const settings = body.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return json({ error: "invalid_owner_settings" }, 400);
  }
  const values = settings as Record<string, unknown>;
  const keys = Object.keys(values);
  if (!keys.length || keys.some((key) => !["memory_enabled", "app_messaging_enabled"].includes(key)) ||
      keys.some((key) => typeof values[key] !== "boolean")) {
    return json({ error: "invalid_owner_settings" }, 400);
  }
  const current = await readOwnerFeatureSettings(env, owner.owner_id);
  const next = {
    memory_enabled: values.memory_enabled === undefined ? current.memory_enabled : values.memory_enabled as boolean,
    app_messaging_enabled: values.app_messaging_enabled === undefined ? current.app_messaging_enabled : values.app_messaging_enabled as boolean,
  };
  await env.DB.prepare(`
    INSERT INTO owner_settings(owner_id, memory_enabled, app_messaging_enabled, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      memory_enabled = excluded.memory_enabled,
      app_messaging_enabled = excluded.app_messaging_enabled,
      updated_at = excluded.updated_at
  `).bind(owner.owner_id, next.memory_enabled ? 1 : 0, next.app_messaging_enabled ? 1 : 0, nowIso()).run();

  return json({ updated: true, settings: next });
};

const handleOwnerAccessGrants = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT grant_id, grantee_app_id, source_app_id, destination_app_id,
        permission, scope, created_at, expires_at, revoked_at
      FROM app_access_grants WHERE owner_id = ?
      ORDER BY created_at DESC LIMIT 200
    `).bind(owner.owner_id).all();
    return json({ grants: rows.results || [], maximum: 200 });
  }

  const body = await readJson(request, 8_000);
  const featureSettings = await readOwnerFeatureSettings(env, owner.owner_id);
  const granteeAppId = typeof body.grantee_app_id === "string" ? body.grantee_app_id.trim() : "";
  const sourceAppId = typeof body.source_app_id === "string" ? body.source_app_id.trim() : null;
  const destinationAppId = typeof body.destination_app_id === "string" ? body.destination_app_id.trim() : null;
  const rawPermission = body.permission;
  const rawScope = body.scope;
  const permissions = ["send", "receive", "memory_read", "memory_write"];
  const scopes = ["task", "context", "app_memory", "owner_memory"];
  if (
    !isValidAppId(granteeAppId) ||
    !permissions.includes(String(rawPermission)) ||
    !scopes.includes(String(rawScope)) ||
    !(await isAppAllowed(env, granteeAppId))
  ) return json({ error: "invalid_grant_fields" }, 400);
  const permission = rawPermission as "send" | "receive" | "memory_read" | "memory_write";
  if ((permission === "send" || permission === "receive") && !featureSettings.app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }
  if ((permission === "memory_read" || permission === "memory_write") && !featureSettings.memory_enabled) {
    return json({ error: "memory_disabled" }, 403);
  }
  const scope = rawScope as "task" | "context" | "app_memory" | "owner_memory";

  if (permission === "send" || permission === "receive") {
    if (
      (scope !== "task" && scope !== "context") ||
      !sourceAppId || !destinationAppId ||
      !isValidAppId(sourceAppId) || !isValidAppId(destinationAppId) ||
      sourceAppId === destinationAppId ||
      !(await isAppAllowed(env, sourceAppId)) ||
      !(await isAppAllowed(env, destinationAppId)) ||
      (permission === "send" && granteeAppId !== sourceAppId) ||
      (permission === "receive" && granteeAppId !== destinationAppId)
    ) return json({ error: "invalid_message_grant_direction" }, 400);
  } else if (scope === "app_memory") {
    if (
      !sourceAppId || destinationAppId !== null ||
      !isValidAppId(sourceAppId) || !(await isAppAllowed(env, sourceAppId))
    ) return json({ error: "invalid_app_memory_grant" }, 400);
  } else if (scope === "owner_memory") {
    if (sourceAppId !== null || destinationAppId !== null) {
      return json({ error: "invalid_owner_memory_grant" }, 400);
    }
  } else {
    return json({ error: "invalid_memory_grant_scope" }, 400);
  }

  const validHours = body.valid_hours === undefined ? 720 : body.valid_hours;
  if (typeof validHours !== "number" || !Number.isInteger(validHours) || validHours < 1 || validHours > 8760) {
    return json({ error: "invalid_grant_valid_hours", minimum: 1, maximum: 8760 }, 400);
  }

  const grantId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO app_access_grants(
      grant_id, owner_id, grantee_app_id, source_app_id, destination_app_id,
      permission, scope, created_by_device_id, created_at, expires_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    grantId, owner.owner_id, granteeAppId, sourceAppId, destinationAppId,
    permission, scope, device.device_id, createdAt, expiresAt
  ).run();

  return json({
    created: true,
    grant: {
      grant_id: grantId, grantee_app_id: granteeAppId,
      source_app_id: sourceAppId, destination_app_id: destinationAppId,
      permission, scope, created_at: createdAt, expires_at: expiresAt
    }
  }, 201);
};


const handleMemoryRetrieve = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);

  const featureSettings = await readOwnerFeatureSettings(env, owner.owner_id);
  if (!featureSettings.memory_enabled) return json({ error: "memory_disabled" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);

  const body = await readJson(request, 2_000);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 500) {
    return json({ error: "invalid_memory_query", minimum: 2, maximum: 500 }, 400);
  }
  const limit = body.limit === undefined ? 10 : body.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    return json({ error: "invalid_memory_limit", minimum: 1, maximum: 20 }, 400);
  }

  const timestamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT m.memory_id, m.scope, m.source_app_id, m.memory_key, m.value,
      m.created_by_app_id, m.updated_at, m.expires_at
    FROM memory_records m
    WHERE m.owner_id = ? AND m.deleted_at IS NULL
      AND (m.expires_at IS NULL OR m.expires_at > ?)
      AND (
        (m.scope = 'app' AND m.source_app_id = ?)
        OR (m.scope = 'app' AND EXISTS (
          SELECT 1 FROM app_access_grants g
          WHERE g.owner_id = m.owner_id AND g.grantee_app_id = ?
            AND g.permission = 'memory_read' AND g.scope = 'app_memory'
            AND g.source_app_id = m.source_app_id AND g.destination_app_id IS NULL
            AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
        ))
        OR (m.scope = 'owner' AND EXISTS (
          SELECT 1 FROM app_access_grants g
          WHERE g.owner_id = m.owner_id AND g.grantee_app_id = ?
            AND g.permission = 'memory_read' AND g.scope = 'owner_memory'
            AND g.source_app_id IS NULL AND g.destination_app_id IS NULL
            AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
        ))
      )
    ORDER BY m.updated_at DESC LIMIT 200
  `).bind(
    owner.owner_id, timestamp, device.app_id, device.app_id, timestamp,
    device.app_id, timestamp
  ).all<MemorySearchRecord>();

  const memories = rankRelevantMemories(query, rows.results || [], limit);
  return json({
    query,
    memories,
    returned: memories.length,
    searched_records: (rows.results || []).length,
    retrieval: "deterministic-keyword",
    inference_calls: 0,
    shared_memory_requires_explicit_grant: true,
  });
};

const handlePrepareMemoryCandidate = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const featureSettings = await readOwnerFeatureSettings(env, owner.owner_id);
  if (!featureSettings.memory_enabled) return json({ error: "memory_disabled" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);

  const body = await readJson(request, 8_000);
  const scope = body.scope === undefined ? "app" : body.scope;
  if (scope !== "app" && scope !== "owner") return json({ error: "invalid_memory_scope" }, 400);
  if (scope === "owner") {
    const grant = await env.DB.prepare(`
      SELECT grant_id FROM app_access_grants
      WHERE owner_id = ? AND grantee_app_id = ? AND permission = 'memory_write'
        AND scope = 'owner_memory' AND source_app_id IS NULL AND destination_app_id IS NULL
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).bind(owner.owner_id, device.app_id, nowIso()).first<{ grant_id: string }>();
    if (!grant) return json({ error: "memory_access_not_granted" }, 403);
  }

  try {
    const candidate = prepareMemoryCandidate({
      sourceRole: body.source_role,
      sourceText: body.source_text,
      key: body.key,
      value: body.value,
    });
    return json({
      candidate,
      scope,
      source_app_id: scope === "app" ? device.app_id : null,
      next_step: "Show this candidate to the owner. Only after explicit confirmation call POST /v1/owner/memory with consent=curated.",
      stored: false,
      inference_calls: 0,
    }, 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_memory_candidate";
    return json({ error: code }, 400);
  }
};

const handleOwnerMemory = async (request: Request, env: Env, url: URL) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);

  const featureSettings = await readOwnerFeatureSettings(env, owner.owner_id);
  if (!featureSettings.memory_enabled) return json({ error: "memory_disabled" }, 403);
  const scope = url.searchParams.get("scope") || "app";
  const sourceAppId = url.searchParams.get("source_app_id") || device.app_id;
  if (scope !== "app" && scope !== "owner") return json({ error: "invalid_memory_scope" }, 400);
  if (scope === "app" && (!isValidAppId(sourceAppId) || !(await isAppAllowed(env, sourceAppId)))) {
    return json({ error: "invalid_memory_app" }, 400);
  }
  if (scope === "owner" && url.searchParams.has("source_app_id")) {
    return json({ error: "owner_memory_has_no_source_app" }, 400);
  }

  const isOwnAppMemory = scope === "app" && sourceAppId === device.app_id;
  const permission = request.method === "GET" ? "memory_read" : "memory_write";
  if (!isOwnAppMemory) {
    const grant = await env.DB.prepare(`
      SELECT grant_id FROM app_access_grants
      WHERE owner_id = ? AND grantee_app_id = ? AND permission = ?
        AND scope = ? AND source_app_id IS ? AND destination_app_id IS NULL
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      LIMIT 1
    `).bind(
      owner.owner_id, device.app_id, permission,
      scope === "owner" ? "owner_memory" : "app_memory",
      scope === "owner" ? null : sourceAppId, nowIso()
    ).first<{ grant_id: string }>();
    if (!grant) return json({ error: "memory_access_not_granted" }, 403);
  }

  if (request.method === "GET") {
    const search = (url.searchParams.get("q") || "").trim().slice(0, 100).toLocaleLowerCase("pt-BR");
    const includeExpired = url.searchParams.get("include_expired") === "true";
    const expiryClause = includeExpired ? "" : "AND (expires_at IS NULL OR expires_at > ?)";
    const query = scope === "owner"
      ? `SELECT memory_id, scope, memory_key, value, created_by_app_id, created_at, updated_at, expires_at
         FROM memory_records WHERE owner_id = ? AND scope = 'owner' AND deleted_at IS NULL ${expiryClause}
         ORDER BY updated_at DESC LIMIT 200`
      : `SELECT memory_id, scope, memory_key, value, created_by_app_id, created_at, updated_at, expires_at
         FROM memory_records WHERE owner_id = ? AND scope = 'app' AND source_app_id = ? AND deleted_at IS NULL ${expiryClause}
         ORDER BY updated_at DESC LIMIT 200`;
    const statement = scope === "owner"
      ? env.DB.prepare(query).bind(...(includeExpired ? [owner.owner_id] : [owner.owner_id, nowIso()]))
      : env.DB.prepare(query).bind(...(includeExpired ? [owner.owner_id, sourceAppId] : [owner.owner_id, sourceAppId, nowIso()]));
    const rows = await statement.all<Record<string, unknown>>();
    const memories = (rows.results || []).filter((memory) => !search
      || String(memory.memory_key || "").toLocaleLowerCase("pt-BR").includes(search)
      || String(memory.value || "").toLocaleLowerCase("pt-BR").includes(search));
    return json({ memories, maximum: 200, scope, source_app_id: scope === "app" ? sourceAppId : null, search, include_expired: includeExpired });
  }

  const body = await readJson(request, 4_000);
  if (request.method === "POST") {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key)) {
      return json({ error: "invalid_memory_key" }, 400);
    }
    let value: string;
    try {
      value = validateCuratedMemory({
        consent: body.consent === "curated" ? "curated" : "disabled",
        value: typeof body.value === "string" ? body.value : "",
        maxCharacters: 500,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_memory_value";
      return json({ error: code }, 400);
    }
    const validHours = body.valid_hours;
    if (validHours !== undefined &&
      (typeof validHours !== "number" || !Number.isInteger(validHours) || validHours < 1 || validHours > 8760)) {
      return json({ error: "invalid_memory_valid_hours", minimum: 1, maximum: 8760 }, 400);
    }
    const timestamp = nowIso();
    const expiresAt = validHours === undefined
      ? null : new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
    const storedSourceAppId = scope === "owner" ? null : sourceAppId;
    const existing = scope === "owner"
      ? await env.DB.prepare(`
          SELECT memory_id FROM memory_records
          WHERE owner_id = ? AND scope = 'owner' AND memory_key = ? AND deleted_at IS NULL
        `).bind(owner.owner_id, key).first<{ memory_id: string }>()
      : await env.DB.prepare(`
          SELECT memory_id FROM memory_records
          WHERE owner_id = ? AND scope = 'app' AND source_app_id = ?
            AND memory_key = ? AND deleted_at IS NULL
        `).bind(owner.owner_id, sourceAppId, key).first<{ memory_id: string }>();
    if (existing) {
      await env.DB.prepare(`
        UPDATE memory_records SET value = ?, updated_at = ?, expires_at = ?
        WHERE memory_id = ? AND owner_id = ? AND deleted_at IS NULL
      `).bind(value, timestamp, expiresAt, existing.memory_id, owner.owner_id).run();
      return json({ saved: true, updated: true, memory_id: existing.memory_id, scope, source_app_id: storedSourceAppId });
    }
    const count = scope === "owner"
      ? await env.DB.prepare("SELECT COUNT(*) AS total FROM memory_records WHERE owner_id = ? AND scope = 'owner' AND deleted_at IS NULL")
          .bind(owner.owner_id).first<{ total: number }>()
      : await env.DB.prepare("SELECT COUNT(*) AS total FROM memory_records WHERE owner_id = ? AND scope = 'app' AND source_app_id = ? AND deleted_at IS NULL")
          .bind(owner.owner_id, sourceAppId).first<{ total: number }>();
    if ((count?.total || 0) >= 200) return json({ error: "memory_limit_reached", maximum: 200 }, 409);
    const memoryId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO memory_records(
        memory_id, owner_id, scope, source_app_id, memory_key, value,
        consent, created_by_app_id, created_at, updated_at, expires_at
      ) VALUES(?, ?, ?, ?, ?, ?, 'curated', ?, ?, ?, ?)
    `).bind(memoryId, owner.owner_id, scope, storedSourceAppId, key, value,
      device.app_id, timestamp, timestamp, expiresAt).run();
    return json({ saved: true, updated: false, memory_id: memoryId, scope, source_app_id: storedSourceAppId }, 201);
  }

  if (request.method === "PATCH") {
    const memoryId = typeof body.memory_id === "string" ? body.memory_id.trim() : "";
    if (!memoryId || memoryId.length > 100) return json({ error: "invalid_memory_id" }, 400);
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key)) return json({ error: "invalid_memory_key" }, 400);
    let value: string;
    try {
      value = validateCuratedMemory({ consent: body.consent === "curated" ? "curated" : "disabled", value: typeof body.value === "string" ? body.value : "", maxCharacters: 500 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid_memory_value" }, 400);
    }
    const validHours = body.valid_hours;
    if (validHours !== undefined && validHours !== null &&
      (typeof validHours !== "number" || !Number.isInteger(validHours) || validHours < 1 || validHours > 8760)) {
      return json({ error: "invalid_memory_valid_hours", minimum: 1, maximum: 8760 }, 400);
    }
    const timestamp = nowIso();
    const expiresAt = validHours === undefined ? null : validHours === null ? null : new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
    const result = await env.DB.prepare(`
      UPDATE memory_records SET memory_key = ?, value = ?, updated_at = ?,
        expires_at = CASE WHEN ? = 1 THEN NULL WHEN ? = 2 THEN expires_at ELSE ? END
      WHERE memory_id = ? AND owner_id = ? AND scope = ?
        AND source_app_id IS ? AND deleted_at IS NULL
    `).bind(key, value, timestamp,
      validHours === null ? 1 : validHours === undefined ? 2 : 0,
      validHours === undefined ? 2 : 0, expiresAt,
      memoryId, owner.owner_id, scope, scope === "owner" ? null : sourceAppId).run();
    return result.meta.changes === 1 ? json({ updated: true, memory_id: memoryId, scope }) : json({ error: "memory_not_found" }, 404);
  }

  if (request.method === "DELETE") {
    const memoryId = typeof body.memory_id === "string" ? body.memory_id.trim() : "";
    if (!memoryId || memoryId.length > 100) return json({ error: "invalid_memory_id" }, 400);
    const result = await env.DB.prepare(`
      UPDATE memory_records SET deleted_at = ?, updated_at = ?
      WHERE memory_id = ? AND owner_id = ? AND scope = ?
        AND source_app_id IS ? AND deleted_at IS NULL
    `).bind(nowIso(), nowIso(), memoryId, owner.owner_id, scope, scope === "owner" ? null : sourceAppId).run();
    return result.meta.changes === 1
      ? json({ deleted: true, memory_id: memoryId })
      : json({ error: "memory_not_found" }, 404);
  }
  return json({ error: "method_not_allowed" }, 405);
};

const handleRevokeOwnerDevice = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const body = await readJson(request, 4_000);
  const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
  if (!deviceId || deviceId.length > 100) return json({ error: "invalid_device_id" }, 400);
  if (deviceId === device.device_id) return json({ error: "current_device_cannot_revoke" }, 400);
  const result = await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE device_id = ? AND owner_id = ? AND revoked_at IS NULL")
    .bind(nowIso(), deviceId, owner.owner_id).run();
  return result.meta.changes === 1
    ? json({ revoked: true, device_id: deviceId })
    : json({ error: "device_not_found_or_already_revoked" }, 404);
};
const handleRevokeOwnerAccessGrant = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  const body = await readJson(request, 4_000);
  const grantId = typeof body.grant_id === "string" ? body.grant_id.trim() : "";
  if (!grantId || grantId.length > 100) return json({ error: "invalid_grant_id" }, 400);
  const timestamp = nowIso();
  const result = await env.DB.prepare(`
    UPDATE app_access_grants SET revoked_at = ?
    WHERE grant_id = ? AND owner_id = ? AND revoked_at IS NULL
  `).bind(timestamp, grantId, owner.owner_id).run();
  return result.meta.changes === 1
    ? json({ revoked: true, grant_id: grantId, revoked_at: timestamp })
    : json({ error: "grant_not_found_or_already_revoked" }, 404);
};

const handleRevokeDevice = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
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
      return json({ error: "rate_limit_exceeded", retry_after_seconds: 60 }, 429, { "retry-after": "60" });
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
        typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARS) {
      return json({ error: "invalid_message" }, 400);
    }
    totalChars += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (totalChars > MAX_TOTAL_INPUT_CHARS) return json({ error: "prompt_too_large", max_input_chars: MAX_TOTAL_INPUT_CHARS }, 413);

  try {
    await reserveQuota(env, device.app_id, device.device_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("quota_exceeded")) {
      const retryAfter = secondsUntilUtcDayReset();
      return json({ error: "daily_quota_exceeded", retry_after_seconds: retryAfter }, 429, { "retry-after": String(retryAfter) });
    }
    throw error;
  }

  const model = resolveModel(settings.ai_model, env.AI_MODEL);
  if (!model) return json({ error: "ai_model_not_available" }, 503);
  const maxTokens = Math.min(getLimit(settings.max_output_tokens || env.MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS);
  const registry = createRuntimeProviderRegistry(env, model, maxTokens);
  const registeredModel = registry.select("general", "cloudflare-workers-ai");
  const provider = registeredModel ? registry.get(registeredModel.providerId) : undefined;
  if (!registeredModel || !provider) return json({ error: "ai_provider_not_available" }, 503);

  let memoryContext = { text: "", entriesUsed: 0, characters: 0 };
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (owner) {
    const featureSettings = await readOwnerFeatureSettings(env, owner.owner_id);
    if (featureSettings.memory_enabled) {
      const query = [...messages].reverse().find((message) => message.role === "user")?.content.trim().slice(0, 500) || "";
      if (query.length >= 2) {
        const timestamp = nowIso();
        const visibleRows = await env.DB.prepare(`
          SELECT m.memory_id, m.scope, m.source_app_id, m.memory_key, m.value,
            m.created_by_app_id, m.updated_at, m.expires_at
          FROM memory_records m
          WHERE m.owner_id = ? AND m.deleted_at IS NULL
            AND (m.expires_at IS NULL OR m.expires_at > ?)
            AND (
              (m.scope = 'app' AND m.source_app_id = ?)
              OR (m.scope = 'app' AND EXISTS (
                SELECT 1 FROM app_access_grants g
                WHERE g.owner_id = m.owner_id AND g.grantee_app_id = ?
                  AND g.permission = 'memory_read' AND g.scope = 'app_memory'
                  AND g.source_app_id = m.source_app_id AND g.destination_app_id IS NULL
                  AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
              ))
              OR (m.scope = 'owner' AND EXISTS (
                SELECT 1 FROM app_access_grants g
                WHERE g.owner_id = m.owner_id AND g.grantee_app_id = ?
                  AND g.permission = 'memory_read' AND g.scope = 'owner_memory'
                  AND g.source_app_id IS NULL AND g.destination_app_id IS NULL
                  AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
              ))
            )
          ORDER BY m.updated_at DESC LIMIT 200
        `).bind(
          owner.owner_id, timestamp, device.app_id, device.app_id, timestamp,
          device.app_id, timestamp
        ).all<MemorySearchRecord>();
        memoryContext = buildChatMemoryContext(rankRelevantMemories(query, visibleRows.results || [], 5));
      }
    }
  }

  const orchestration = await runCibaOrchestrator({
    messages,
    model: registeredModel.modelId,
    maxOutputTokens: Math.min(maxTokens, registeredModel.maxOutputTokens),
    provider,
    memoryContext: memoryContext.text,
  });
  await env.DB.prepare(
    "UPDATE devices SET last_seen_at = ? WHERE device_id = ?"
  ).bind(nowIso(), device.device_id).run();

  return json({
    model,
    response: orchestration.text,
    intelligence: {
      agent: orchestration.selectedAgent,
      strategy: orchestration.strategy,
      provider: orchestration.provider,
      inference_calls: orchestration.usedInferenceCalls,
      memory_context: { enabled: memoryContext.entriesUsed > 0, entries_used: memoryContext.entriesUsed, characters: memoryContext.characters },
    },
  });
};

const handleAdminDevices = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  const appId = url.searchParams.get("app_id");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const rows = appId
    ? await env.DB.prepare("SELECT device_id, app_id, owner_id, created_at, last_seen_at, revoked_at FROM devices WHERE app_id = ? ORDER BY created_at DESC LIMIT ?").bind(appId, limit).all()
    : await env.DB.prepare("SELECT device_id, app_id, owner_id, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ devices: rows.results || [] });
};

const handleAdminInvitations = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
  const url = new URL(request.url);
  const appId = url.searchParams.get("app_id");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const rows = appId
    ? await env.DB.prepare("SELECT app_id, created_at, expires_at, used_at, consumed_device_id FROM invitations WHERE app_id = ? ORDER BY created_at DESC LIMIT ?").bind(appId, limit).all()
    : await env.DB.prepare("SELECT app_id, created_at, expires_at, used_at, consumed_device_id FROM invitations ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return json({ invitations: rows.results || [] });
};

const handleAdminApps = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT app_id, display_name, enabled, description, app_type, capabilities_json, task_types_json, contract_version, created_at, updated_at FROM app_registry ORDER BY display_name"
    ).all<{
      app_id: string; display_name: string; enabled: number; description: string;
      app_type: string; capabilities_json: string; task_types_json: string; contract_version: string;
      created_at: string; updated_at: string;
    }>();
    return json({ apps: (rows.results || []).map((app) => ({
      app_id: app.app_id, display_name: app.display_name, enabled: app.enabled === 1,
      description: app.description, app_type: app.app_type,
      capabilities: parseStoredAppCapabilities(app.capabilities_json),
      task_types: parseStoredAppTaskTypes(app.task_types_json),
      contract_version: app.contract_version, created_at: app.created_at, updated_at: app.updated_at,
    })) });
  }
  const body = await readJson(request, 8_000);
  const appId = typeof body.app_id === "string" ? body.app_id.trim() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const enabled = body.enabled === undefined ? true : body.enabled;
  if (!isValidAppId(appId) || !displayName || displayName.length > 100 ||
      typeof enabled !== "boolean") return json({ error: "invalid_app" }, 400);
  const existing = await env.DB.prepare(
    "SELECT description, app_type, capabilities_json, task_types_json, contract_version FROM app_registry WHERE app_id = ?"
  ).bind(appId).first<{
    description: string; app_type: string; capabilities_json: string;
    task_types_json: string; contract_version: string;
  }>();
  const profile = validateAppProfile({
    description: body.description === undefined ? existing?.description : body.description,
    app_type: body.app_type === undefined ? existing?.app_type : body.app_type,
    capabilities: body.capabilities === undefined
      ? (existing ? parseStoredAppCapabilities(existing.capabilities_json) : undefined)
      : body.capabilities,
    task_types: body.task_types === undefined
      ? (existing ? parseStoredAppTaskTypes(existing.task_types_json) : undefined)
      : body.task_types,
    contract_version: body.contract_version === undefined ? existing?.contract_version : body.contract_version,
  });
  if (!profile.valid) return json({ error: profile.error }, 400);
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO app_registry(app_id, display_name, enabled, description, app_type, capabilities_json, task_types_json, contract_version, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET display_name = excluded.display_name, enabled = excluded.enabled, description = excluded.description, app_type = excluded.app_type, capabilities_json = excluded.capabilities_json, task_types_json = excluded.task_types_json, contract_version = excluded.contract_version, updated_at = excluded.updated_at"
  ).bind(appId, displayName, enabled ? 1 : 0, profile.profile.description,
    profile.profile.app_type, JSON.stringify(profile.profile.capabilities),
    JSON.stringify(profile.profile.task_types), profile.profile.contract_version, timestamp, timestamp).run();
  return json({
    saved: true, app_id: appId, display_name: displayName, enabled,
    ...profile.profile,
  });
};

const handleAdminSettings = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;
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
    const settingCeilings: Record<string, number> = {
      daily_global_limit: MAX_DAILY_GLOBAL_LIMIT,
      daily_app_limit: MAX_DAILY_APP_LIMIT,
      daily_device_limit: MAX_DAILY_DEVICE_LIMIT,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    };
    if (key in settingCeilings) {
      const n = Number(normalized);
      if (!Number.isSafeInteger(n) || n < 1 || n > settingCeilings[key]) {
        return json({ error: "setting_exceeds_safety_ceiling", key, maximum: settingCeilings[key] }, 400);
      }
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

const handleAdminAiOverview = async (request: Request, env: Env) => {
  const authError = await authorizeAdmin(request, env);
  if (authError) return authError;

  const settings = await readRuntimeSettings(env);
  const config = publicConfig(settings, env);
  const modelConfigured = Boolean(config.model);
  const aiActive = config.ai_enabled && !config.maintenance_mode;
  const registry = createRuntimeProviderRegistry(env, config.model, config.limits.max_output_tokens);

  return json({
    service: "ciba-ai",
    mode: "single-pass",
    ai: {
      enabled: config.ai_enabled,
      active: aiActive,
      maintenance_mode: config.maintenance_mode,
      provider: "cloudflare-workers-ai",
      model: config.model,
      configured: modelConfigured
    },
    agents: listAgents(),
    providers: registry.list(),
    models: registry.listModels(),
    extensions: {
      ensemble: {
        implemented: true,
        enabled: false,
        public_chat_enabled: false,
        requires_distinct_models: true,
        requires_zero_cost_approval: true,
        max_agent_calls: 3,
        max_total_output_tokens: 2048,
        note: "Requires distinct server-configured models, explicit zero-cost approval and an administrator-controlled budget."
      },
      provider_registry: {
        implemented: true,
        openai_compatible_adapter_available: true,
        additional_providers_configured: false
      },
      memory: {
        mode: "request_context_only",
        persistent: false
      },
      tools: {
        contracts_defined: true,
        execution_enabled: false
      }
    },
    limits: config.limits
  });
};


const MESSAGE_MAX_PAYLOAD_CHARS = 8_000;
const MESSAGE_MAX_PENDING_PER_DESTINATION = 100;
const MESSAGE_DEFAULT_TTL_HOURS = 24;
const MESSAGE_MAX_TTL_HOURS = 72;

const hasMessageGrant = async (
  env: Env,
  ownerId: string,
  granteeAppId: string,
  sourceAppId: string,
  destinationAppId: string,
  permission: "send" | "receive",
  scope: "task" | "context",
  timestamp: string
): Promise<boolean> => {
  const row = await env.DB.prepare(`
    SELECT grant_id FROM app_access_grants
    WHERE owner_id = ? AND grantee_app_id = ?
      AND source_app_id = ? AND destination_app_id = ?
      AND permission = ? AND scope = ?
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `).bind(ownerId, granteeAppId, sourceAppId, destinationAppId, permission, scope, timestamp)
    .first<{ grant_id: string }>();
  return Boolean(row);
};

const handleTaskDispatch = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }

  const body = await readJson(request, 12_000);
  const taskType = body.task_type;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const preferredAppId = body.preferred_app_id === undefined
    ? undefined
    : typeof body.preferred_app_id === "string" ? body.preferred_app_id.trim() : "";
  const clientMessageId = typeof body.client_message_id === "string" ? body.client_message_id.trim() : "";
  if (!isAppTaskType(taskType) || !instruction || instruction.length > 6_000 ||
      !clientMessageId || clientMessageId.length > 100 ||
      (preferredAppId !== undefined && (!preferredAppId || !isValidAppId(preferredAppId)))) {
    return json({ error: "invalid_task_dispatch_fields" }, 400);
  }
  const ttlHours = body.ttl_hours === undefined ? MESSAGE_DEFAULT_TTL_HOURS : body.ttl_hours;
  if (typeof ttlHours !== "number" || !Number.isInteger(ttlHours) ||
      ttlHours < 1 || ttlHours > MESSAGE_MAX_TTL_HOURS) {
    return json({ error: "invalid_message_ttl", minimum_hours: 1, maximum_hours: MESSAGE_MAX_TTL_HOURS }, 400);
  }

  let contextJson: string | undefined;
  if (body.context !== undefined) {
    try { contextJson = JSON.stringify(body.context); } catch {
      return json({ error: "invalid_task_context" }, 400);
    }
    if (contextJson === undefined || contextJson.length > 1_500) {
      return json({ error: "task_context_too_large", max_characters: 1_500 }, 413);
    }
  }

  const timestamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT a.app_id, a.display_name, a.task_types_json
    FROM devices d
    INNER JOIN app_registry a ON a.app_id = d.app_id
    WHERE d.owner_id = ? AND d.revoked_at IS NULL AND a.enabled = 1
      AND d.app_id <> ?
    GROUP BY a.app_id, a.display_name, a.task_types_json
    ORDER BY a.display_name COLLATE NOCASE
  `).bind(owner.owner_id, device.app_id).all<{
    app_id: string; display_name: string; task_types_json: string;
  }>();
  const capableRows = (rows.results || []).filter((row) =>
    parseStoredAppTaskTypes(row.task_types_json).includes(taskType)
  );
  const candidates = await Promise.all(capableRows.map(async (row) => {
    const [sendGranted, receiveGranted] = await Promise.all([
      hasMessageGrant(env, owner.owner_id, device.app_id, device.app_id, row.app_id, "send", "task", timestamp),
      hasMessageGrant(env, owner.owner_id, row.app_id, device.app_id, row.app_id, "receive", "task", timestamp),
    ]);
    return {
      appId: row.app_id,
      displayName: row.display_name,
      taskTypes: parseStoredAppTaskTypes(row.task_types_json),
      sendGranted,
      receiveGranted,
    };
  }));
  const decision = selectTaskRoute(taskType, candidates, preferredAppId);
  if (decision.status === "no_capable_app") {
    return json({ error: "no_capable_app", task_type: taskType }, 404);
  }
  if (decision.status === "no_granted_app") {
    return json({
      error: "no_eligible_app_grants",
      task_type: taskType,
      capable_apps: decision.capableAppIds,
    }, 403);
  }
  if (decision.status === "ambiguous") {
    return json({
      error: "task_route_ambiguous",
      task_type: taskType,
      candidates: decision.candidates.map((candidate) => ({
        app_id: candidate.appId, display_name: candidate.displayName,
      })),
      note: "Informe preferred_app_id para escolher explicitamente.",
    }, 409);
  }

  const destinationAppId = decision.candidate.appId;
  const taskId = crypto.randomUUID();
  const payload = {
    protocol: "garcia.task.request",
    contract: "garcia-app",
    contract_version: "1.0.0",
    task_id: taskId,
    task_type: taskType,
    instruction,
    ...(body.context === undefined ? {} : { context: body.context }),
  };
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > MESSAGE_MAX_PAYLOAD_CHARS) {
    return json({ error: "message_payload_too_large", max_characters: MESSAGE_MAX_PAYLOAD_CHARS }, 413);
  }
  const messageId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO app_messages(
      message_id, owner_id, source_app_id, destination_app_id,
      client_message_id, task_id, scope, payload_json, created_at, expires_at
    )
    SELECT ?, ?, ?, ?, ?, ?, 'task', ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM app_messages
      WHERE owner_id = ? AND destination_app_id = ?
        AND acknowledged_at IS NULL AND expires_at > ?
    ) < ?
    ON CONFLICT(owner_id, source_app_id, client_message_id) DO NOTHING
  `).bind(
    messageId, owner.owner_id, device.app_id, destinationAppId,
    clientMessageId, taskId, payloadJson, timestamp, expiresAt,
    owner.owner_id, destinationAppId, timestamp, MESSAGE_MAX_PENDING_PER_DESTINATION
  ).run();
  if (inserted.meta.changes !== 1) {
    const existing = await env.DB.prepare(`
      SELECT message_id, task_id, destination_app_id, created_at, expires_at
      FROM app_messages
      WHERE owner_id = ? AND source_app_id = ? AND client_message_id = ?
    `).bind(owner.owner_id, device.app_id, clientMessageId)
      .first<{ message_id: string; task_id: string; destination_app_id: string; created_at: string; expires_at: string }>();
    if (existing) return json({ dispatched: true, duplicate: true, route: existing }, 200);
    return json({ error: "destination_queue_full", maximum_pending: MESSAGE_MAX_PENDING_PER_DESTINATION }, 429);
  }

  return json({
    dispatched: true,
    duplicate: false,
    route: {
      message_id: messageId,
      task_id: taskId,
      source_app_id: device.app_id,
      destination_app_id: destinationAppId,
      destination_display_name: decision.candidate.displayName,
      task_type: taskType,
      scope: "task",
      created_at: timestamp,
      expires_at: expiresAt,
      result_delivery: "destination_app_must_reply_with_same_task_id",
    },
  }, 201);
};

const handleSubmitTaskResult = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }

  const body = await readJson(request, 12_000);
  const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
  const clientMessageId = typeof body.client_message_id === "string" ? body.client_message_id.trim() : "";
  const status = body.status === undefined ? "completed" : body.status;
  if (!taskId || taskId.length > 100 || !clientMessageId || clientMessageId.length > 100 ||
      !["completed", "failed", "partial"].includes(String(status)) ||
      !body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
    return json({ error: "invalid_task_result_fields" }, 400);
  }

  let resultJson: string;
  try { resultJson = JSON.stringify(body.result); } catch {
    return json({ error: "invalid_task_result" }, 400);
  }
  if (!resultJson || resultJson.length > 7_000) {
    return json({ error: "task_result_too_large", max_characters: 7_000 }, 413);
  }

  const timestamp = nowIso();
  const original = await env.DB.prepare(`
    SELECT source_app_id, expires_at, payload_json
    FROM app_messages
    WHERE owner_id = ? AND destination_app_id = ? AND task_id = ?
      AND scope = 'task' AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(owner.owner_id, device.app_id, taskId, timestamp)
    .first<{ source_app_id: string; expires_at: string; payload_json: string }>();
  if (!original) return json({ error: "task_request_not_found_or_expired" }, 404);

  let requestPayload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(original.payload_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) requestPayload = parsed;
  } catch { /* Invalid stored request cannot authorize a response. */ }
  if (requestPayload.protocol !== "garcia.task.request" || requestPayload.task_id !== taskId) {
    return json({ error: "task_request_not_found_or_expired" }, 404);
  }

  const sourceAppId = original.source_app_id;
  const [sendAllowed, receiveAllowed] = await Promise.all([
    hasMessageGrant(env, owner.owner_id, device.app_id, device.app_id, sourceAppId, "send", "task", timestamp),
    hasMessageGrant(env, owner.owner_id, sourceAppId, device.app_id, sourceAppId, "receive", "task", timestamp),
  ]);
  if (!sendAllowed || !receiveAllowed) return json({
    error: "task_result_access_not_granted",
    missing_permissions: [
      ...(!sendAllowed ? ["send"] : []),
      ...(!receiveAllowed ? ["receive"] : []),
    ],
  }, 403);

  const payload = {
    protocol: "garcia.task.result",
    contract: "garcia-app",
    contract_version: "1.0.0",
    task_id: taskId,
    status,
    result: body.result,
  };
  const payloadJson = JSON.stringify(payload);
  const messageId = crypto.randomUUID();
  const expiresAt = new Date(Math.min(
    Date.now() + MESSAGE_DEFAULT_TTL_HOURS * 60 * 60 * 1000,
    new Date(original.expires_at).getTime()
  )).toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO app_messages(
      message_id, owner_id, source_app_id, destination_app_id,
      client_message_id, task_id, scope, payload_json, created_at, expires_at
    )
    SELECT ?, ?, ?, ?, ?, ?, 'task', ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM app_messages
      WHERE owner_id = ? AND destination_app_id = ?
        AND acknowledged_at IS NULL AND expires_at > ?
    ) < ?
    ON CONFLICT(owner_id, source_app_id, client_message_id) DO NOTHING
  `).bind(
    messageId, owner.owner_id, device.app_id, sourceAppId,
    clientMessageId, taskId, payloadJson, timestamp, expiresAt,
    owner.owner_id, sourceAppId, timestamp, MESSAGE_MAX_PENDING_PER_DESTINATION
  ).run();

  if (inserted.meta.changes !== 1) {
    const existing = await env.DB.prepare(`
      SELECT message_id, task_id, created_at, expires_at
      FROM app_messages WHERE owner_id = ? AND source_app_id = ? AND client_message_id = ?
    `).bind(owner.owner_id, device.app_id, clientMessageId)
      .first<{ message_id: string; task_id: string; created_at: string; expires_at: string }>();
    if (existing) return json({ submitted: true, duplicate: true, message: existing }, 200);
    return json({ error: "destination_queue_full", maximum_pending: MESSAGE_MAX_PENDING_PER_DESTINATION }, 429);
  }

  return json({
    submitted: true,
    duplicate: false,
    message: {
      message_id: messageId,
      task_id: taskId,
      source_app_id: device.app_id,
      destination_app_id: sourceAppId,
      status,
      created_at: timestamp,
      expires_at: expiresAt,
    },
  }, 201);
};

const handleTaskResults = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }
  const taskId = new URL(request.url).searchParams.get("task_id")?.trim() || "";
  if (!taskId || taskId.length > 100) return json({ error: "invalid_task_id" }, 400);

  const timestamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT m.message_id, m.source_app_id, m.task_id, m.payload_json, m.created_at, m.expires_at
    FROM app_messages m
    WHERE m.owner_id = ? AND m.destination_app_id = ? AND m.task_id = ?
      AND m.scope = 'task' AND m.acknowledged_at IS NULL AND m.expires_at > ?
      AND json_extract(m.payload_json, '$.protocol') = 'garcia.task.result'
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.source_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'send' AND g.scope = 'task'
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.destination_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'receive' AND g.scope = 'task'
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
    ORDER BY m.created_at ASC LIMIT 20
  `).bind(owner.owner_id, device.app_id, taskId, timestamp, timestamp, timestamp)
    .all<{ message_id: string; source_app_id: string; task_id: string; payload_json: string; created_at: string; expires_at: string }>();
  const results = (rows.results || []).map((row) => {
    let payload: unknown = null;
    try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
    return { message_id: row.message_id, source_app_id: row.source_app_id, task_id: row.task_id, payload, created_at: row.created_at, expires_at: row.expires_at };
  });
  const consolidation = consolidateTaskResults(taskId, results as TaskResultRecord[]);
  return json({ task_id: taskId, results, count: results.length, maximum: 20, consolidation });
};


const handleTaskSynthesis = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }

  const body = await readJson(request, 2_000);
  const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
  if (!taskId || taskId.length > 100) return json({ error: "invalid_task_id" }, 400);

  const timestamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT m.source_app_id, m.task_id, m.payload_json
    FROM app_messages m
    WHERE m.owner_id = ? AND m.destination_app_id = ? AND m.task_id = ?
      AND m.scope = 'task' AND m.acknowledged_at IS NULL AND m.expires_at > ?
      AND json_extract(m.payload_json, '$.protocol') = 'garcia.task.result'
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.source_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'send' AND g.scope = 'task'
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.destination_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'receive' AND g.scope = 'task'
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
    ORDER BY m.created_at ASC LIMIT 20
  `).bind(owner.owner_id, device.app_id, taskId, timestamp, timestamp, timestamp)
    .all<{ source_app_id: string; task_id: string; payload_json: string }>();

  const results = (rows.results || []).flatMap((row) => {
    try {
      const payload = JSON.parse(row.payload_json);
      return [{ source_app_id: row.source_app_id, task_id: row.task_id, payload }];
    } catch {
      return [];
    }
  });
  const synthesisRequest = buildTaskSynthesisRequest(taskId, results as TaskResultRecord[]);
  if (!synthesisRequest) return json({ error: "no_usable_task_results" }, 409);

  try {
    await reserveMinuteRateLimit(env, device.device_id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("request_rate_exceeded")) {
      return json({ error: "rate_limit_exceeded", retry_after_seconds: 60 }, 429, { "retry-after": "60" });
    }
    throw error;
  }

  const settings = await readRuntimeSettings(env);
  if (settings.maintenance_mode === "true") return json({ error: "maintenance_mode" }, 503);
  if (settings.ai_enabled === "false") return json({ error: "ai_disabled" }, 503);
  const model = resolveModel(settings.ai_model, env.AI_MODEL);
  if (!model || !ZERO_COST_MODELS.has(model)) return json({ error: "ai_model_not_available" }, 503);

  try {
    await reserveQuota(env, device.app_id, device.device_id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("quota_exceeded")) {
      const retryAfter = secondsUntilUtcDayReset();
      return json({ error: "daily_quota_exceeded", retry_after_seconds: retryAfter }, 429, { "retry-after": String(retryAfter) });
    }
    throw error;
  }

  const registry = createRuntimeProviderRegistry(env, model, MAX_TASK_SYNTHESIS_OUTPUT_TOKENS);
  const registeredModel = registry.select("general", "cloudflare-workers-ai");
  const provider = registeredModel ? registry.get(registeredModel.providerId) : undefined;
  if (!registeredModel || !provider || !registeredModel.zeroCostApproved) {
    return json({ error: "ai_provider_not_available" }, 503);
  }

  const inference = await provider.generate({
    model: registeredModel.modelId,
    maxOutputTokens: Math.min(registeredModel.maxOutputTokens, MAX_TASK_SYNTHESIS_OUTPUT_TOKENS),
    messages: synthesisRequest.messages,
  });
  await env.DB.prepare(
    "UPDATE devices SET last_seen_at = ? WHERE device_id = ?"
  ).bind(nowIso(), device.device_id).run();

  return json({
    task_id: taskId,
    synthesis: inference.text,
    sources: synthesisRequest.sources.map((source) => ({
      app_id: source.app_id,
      status: source.status,
    })),
    input_characters: synthesisRequest.input_characters,
    model: inference.model,
    intelligence: {
      strategy: "bounded-task-synthesis",
      provider: inference.provider,
      inference_calls: 1,
      max_output_tokens: MAX_TASK_SYNTHESIS_OUTPUT_TOKENS,
      zero_cost_model_approved: true,
    },
  });
};

const handleSendAppMessage = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "source_app_disabled" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }

  const body = await readJson(request, 12_000);
  const destinationAppId = typeof body.destination_app_id === "string" ? body.destination_app_id.trim() : "";
  const clientMessageId = typeof body.client_message_id === "string" ? body.client_message_id.trim() : "";
  const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
  const scope = body.scope;
  if (
    !isValidAppId(destinationAppId) ||
    destinationAppId === device.app_id ||
    !clientMessageId || clientMessageId.length > 100 ||
    !taskId || taskId.length > 100 ||
    (scope !== "task" && scope !== "context") ||
    !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)
  ) return json({ error: "invalid_message_fields" }, 400);
  if (!(await isAppAllowed(env, destinationAppId))) return json({ error: "destination_app_disabled" }, 403);

  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(body.payload);
  } catch {
    return json({ error: "invalid_message_payload" }, 400);
  }
  if (!payloadJson || payloadJson.length > MESSAGE_MAX_PAYLOAD_CHARS) {
    return json({ error: "message_payload_too_large", max_characters: MESSAGE_MAX_PAYLOAD_CHARS }, 413);
  }

  const ttlHours = body.ttl_hours === undefined ? MESSAGE_DEFAULT_TTL_HOURS : body.ttl_hours;
  if (typeof ttlHours !== "number" || !Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > MESSAGE_MAX_TTL_HOURS) {
    return json({ error: "invalid_message_ttl", minimum_hours: 1, maximum_hours: MESSAGE_MAX_TTL_HOURS }, 400);
  }

  const timestamp = nowIso();
  const sendAllowed = await hasMessageGrant(
    env, owner.owner_id, device.app_id, device.app_id, destinationAppId, "send", scope, timestamp
  );
  const receiveAllowed = await hasMessageGrant(
    env, owner.owner_id, destinationAppId, device.app_id, destinationAppId, "receive", scope, timestamp
  );
  if (!sendAllowed || !receiveAllowed) return json({ error: "message_access_not_granted" }, 403);

  const messageId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const inserted = await env.DB.prepare(`
    INSERT INTO app_messages(
      message_id, owner_id, source_app_id, destination_app_id,
      client_message_id, task_id, scope, payload_json, created_at, expires_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM app_messages
      WHERE owner_id = ? AND destination_app_id = ?
        AND acknowledged_at IS NULL AND expires_at > ?
    ) < ?
    ON CONFLICT(owner_id, source_app_id, client_message_id) DO NOTHING
  `).bind(
    messageId, owner.owner_id, device.app_id, destinationAppId,
    clientMessageId, taskId, scope, payloadJson, timestamp, expiresAt,
    owner.owner_id, destinationAppId, timestamp, MESSAGE_MAX_PENDING_PER_DESTINATION
  ).run();

  if (inserted.meta.changes !== 1) {
    const existing = await env.DB.prepare(`
      SELECT message_id, task_id, scope, created_at, expires_at
      FROM app_messages
      WHERE owner_id = ? AND source_app_id = ? AND client_message_id = ?
    `).bind(owner.owner_id, device.app_id, clientMessageId)
      .first<{ message_id: string; task_id: string; scope: string; created_at: string; expires_at: string }>();
    if (existing) return json({ queued: true, duplicate: true, message: existing }, 200);
    const pending = await env.DB.prepare(`
      SELECT COUNT(*) AS total FROM app_messages
      WHERE owner_id = ? AND destination_app_id = ?
        AND acknowledged_at IS NULL AND expires_at > ?
    `).bind(owner.owner_id, destinationAppId, timestamp).first<{ total: number }>();
    if ((pending?.total || 0) >= MESSAGE_MAX_PENDING_PER_DESTINATION) {
      return json({ error: "destination_queue_full", maximum_pending: MESSAGE_MAX_PENDING_PER_DESTINATION }, 429);
    }
    return json({ error: "message_access_not_granted" }, 403);
  }

  return json({
    queued: true,
    duplicate: false,
    message: {
      message_id: messageId,
      task_id: taskId,
      source_app_id: device.app_id,
      destination_app_id: destinationAppId,
      scope,
      created_at: timestamp,
      expires_at: expiresAt
    }
  }, 201);
};

const handleAppMessageInbox = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await isAppAllowed(env, device.app_id))) return json({ error: "destination_app_disabled" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const timestamp = nowIso();
  const rows = await env.DB.prepare(`
    SELECT m.message_id, m.source_app_id, m.destination_app_id,
      m.task_id, m.scope, m.payload_json, m.created_at, m.expires_at
    FROM app_messages m
    WHERE m.owner_id = ? AND m.destination_app_id = ?
      AND m.acknowledged_at IS NULL AND m.expires_at > ?
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.source_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'send' AND g.scope = m.scope
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
      AND EXISTS (
        SELECT 1 FROM app_access_grants g
        WHERE g.owner_id = m.owner_id AND g.grantee_app_id = m.destination_app_id
          AND g.source_app_id = m.source_app_id AND g.destination_app_id = m.destination_app_id
          AND g.permission = 'receive' AND g.scope = m.scope
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
      )
    ORDER BY m.created_at ASC LIMIT ?
  `).bind(owner.owner_id, device.app_id, timestamp, timestamp, timestamp, limit)
    .all<{
      message_id: string; source_app_id: string; destination_app_id: string;
      task_id: string; scope: "task" | "context"; payload_json: string;
      created_at: string; expires_at: string;
    }>();

  const messages = (rows.results || []).map((row) => {
    let payload: unknown = null;
    try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
    return {
      message_id: row.message_id,
      source_app_id: row.source_app_id,
      destination_app_id: row.destination_app_id,
      task_id: row.task_id,
      scope: row.scope,
      payload,
      created_at: row.created_at,
      expires_at: row.expires_at
    };
  });
  return json({ messages, count: messages.length, maximum: limit });
};

const handleAcknowledgeAppMessages = async (request: Request, env: Env) => {
  const device = await authenticateDevice(request, env);
  if (!device) return json({ error: "unauthorized" }, 401);
  const owner = await getActiveOwnerForDevice(env, device.owner_id);
  if (!owner) return json({ error: "active_owner_required" }, 403);
  if (!(await readOwnerFeatureSettings(env, owner.owner_id)).app_messaging_enabled) {
    return json({ error: "app_messaging_disabled" }, 403);
  }
  const body = await readJson(request, 8_000);
  if (!Array.isArray(body.message_ids) || body.message_ids.length < 1 || body.message_ids.length > 50) {
    return json({ error: "invalid_message_ids", maximum: 50 }, 400);
  }
  const ids = [...new Set(body.message_ids)];
  if (ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) {
    return json({ error: "invalid_message_ids", maximum: 50 }, 400);
  }
  const timestamp = nowIso();
  const results = await env.DB.batch(ids.map((id) => env.DB.prepare(`
    UPDATE app_messages SET acknowledged_at = ?
    WHERE message_id = ? AND owner_id = ? AND destination_app_id = ?
      AND acknowledged_at IS NULL
  `).bind(timestamp, id, owner.owner_id, device.app_id)));
  const acknowledged = results.reduce((total, result) => total + (result.meta.changes || 0), 0);
  return json({ acknowledged, requested: ids.length });
};

const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/dashboard" && request.method === "GET") {
    return new Response(GARCIA_DASHBOARD_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
      },
    });
  }
  if (url.pathname === "/v1/admin/devices" && request.method === "GET") {
    return handleAdminDevices(request, env);
  }
  if (url.pathname === "/v1/admin/invitations" && request.method === "GET") {
    return handleAdminInvitations(request, env);
  }
  if (url.pathname === "/v1/admin/apps" && (request.method === "GET" || request.method === "POST")) {
    return handleAdminApps(request, env);
  }
  if (url.pathname === "/v1/admin/ai/overview" && request.method === "GET") {
    return handleAdminAiOverview(request, env);
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
    const maintenanceMode = settings.maintenance_mode === "true";
    const aiEnabled = settings.ai_enabled !== "false" && Boolean(resolveModel(settings.ai_model, env.AI_MODEL));
    return json({
      service: "ciba-ai",
      status: maintenanceMode ? "maintenance" : aiEnabled ? "ready" : "degraded",
      database: "connected",
      ai_enabled: aiEnabled,
      maintenance_mode: maintenanceMode,
      inference: "cloudflare-workers-ai",
    });
  }
  if (url.pathname === "/v1/models" && request.method === "GET") {
    const settings = await readRuntimeSettings(env);
    const model = resolveModel(settings.ai_model, env.AI_MODEL);
    return json({ models: model ? [model] : [], configured: Boolean(model) });
  }
  if (url.pathname === "/v1/ai/capabilities" && request.method === "GET") {
    const settings = await readRuntimeSettings(env);
    const model = resolveModel(settings.ai_model, env.AI_MODEL);
    return json({
      identity: "ciba-ai",
      core: "ciba-orchestrator",
      mode: "single-pass",
      provider: model ? "cloudflare-workers-ai" : null,
      model,
      agents: listAgents(),
      multi_model_fanout_enabled: false,
      multi_model_ensemble_available: true,
      provider_registry_available: true,
      openai_compatible_adapter_available: true,
      persistent_memory_enabled: false,
      persistent_memory_api_available: true,
      external_tools_enabled: false,
      tool_contracts_available: true,
    });
  }
  if (url.pathname === "/v1/auth/register" && request.method === "POST") {
    return handleRegister(request, env);
  }
  if (url.pathname === "/v1/admin/owners" && request.method === "POST") {
    return handleCreateOwner(request, env);
  }
  if (url.pathname === "/v1/admin/owner-invitations" && request.method === "POST") {
    return handleCreateOwnerInvitation(request, env);
  }
  if (url.pathname === "/v1/owner/pair" && request.method === "POST") {
    return handlePairOwner(request, env);
  }
  if (url.pathname === "/v1/owner/available-apps" && request.method === "GET") {
    return handleOwnerAvailableApps(request, env);
  }
  if (url.pathname === "/v1/owner/apps/connect" && request.method === "POST") {
    return handleConnectOwnerApp(request, env);
  }
  if (url.pathname === "/v1/apps/identity" && request.method === "GET") {
    return handleAppIdentity(request, env);
  }
  if (url.pathname === "/v1/owner/dashboard" && request.method === "GET") {
    return handleOwnerDashboard(request, env);
  }
  if (url.pathname === "/v1/owner/settings" && (request.method === "GET" || request.method === "POST")) {
    return handleOwnerSettings(request, env);
  }
  if (url.pathname === "/v1/owner/access-grants" && (request.method === "GET" || request.method === "POST")) {
    return handleOwnerAccessGrants(request, env);
  }
  if (url.pathname === "/v1/owner/memory/candidates" && request.method === "POST") {
    return handlePrepareMemoryCandidate(request, env);
  }
  if (url.pathname === "/v1/owner/memory/retrieve" && request.method === "POST") {
    return handleMemoryRetrieve(request, env);
  }
  if (url.pathname === "/v1/owner/memory" && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return handleOwnerMemory(request, env, url);
  }
  if (url.pathname === "/v1/owner/devices/revoke" && request.method === "POST") {
    return handleRevokeOwnerDevice(request, env);
  }
  if (url.pathname === "/v1/owner/access-grants/revoke" && request.method === "POST") {
    return handleRevokeOwnerAccessGrant(request, env);
  }
  if (url.pathname === "/v1/apps/tasks/dispatch" && request.method === "POST") {
    return handleTaskDispatch(request, env);
  }
  if (url.pathname === "/v1/apps/tasks/results" && request.method === "GET") {
    return handleTaskResults(request, env);
  }
  if (url.pathname === "/v1/apps/tasks/results" && request.method === "POST") {
    return handleSubmitTaskResult(request, env);
  }
  if (url.pathname === "/v1/apps/tasks/synthesize" && request.method === "POST") {
    return handleTaskSynthesis(request, env);
  }
  if (url.pathname === "/v1/apps/messages" && request.method === "POST") {
    return handleSendAppMessage(request, env);
  }
  if (url.pathname === "/v1/apps/messages/inbox" && request.method === "GET") {
    return handleAppMessageInbox(request, env);
  }
  if (url.pathname === "/v1/apps/messages/ack" && request.method === "POST") {
    return handleAcknowledgeAppMessages(request, env);
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
      env.DB.prepare("DELETE FROM admin_auth_usage WHERE minute < ?").bind(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)),
      env.DB.prepare("DELETE FROM invitations WHERE expires_at < ? AND used_at IS NULL").bind(invitationCutoff),
      env.DB.prepare("DELETE FROM owner_pairing_invitations WHERE expires_at < ? AND consumed_at IS NULL").bind(invitationCutoff),
      env.DB.prepare("DELETE FROM app_messages WHERE expires_at < ? OR (acknowledged_at IS NOT NULL AND acknowledged_at < ?)").bind(nowIso(), new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      env.DB.prepare("DELETE FROM memory_records WHERE (expires_at IS NOT NULL AND expires_at < ?) OR (deleted_at IS NOT NULL AND deleted_at < ?)").bind(nowIso(), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    try {
      return applyResponseHeaders(await handleRequest(request, env), cors);
    } catch (error) {
      // Do not expose database errors, tokens, prompts, or provider internals.
      const reason = error instanceof Error ? error.message : "";
      if (reason === "body_too_large") {
        return applyResponseHeaders(json({ error: "body_too_large" }, 413), cors);
      }
      if (reason === "invalid_json") {
        return applyResponseHeaders(json({ error: "invalid_json" }, 400), cors);
      }
      console.error("Ciba AI request failed", error instanceof Error ? error.name : "unknown");
      return applyResponseHeaders(json({ error: "internal_error" }, 500), cors);
    }
  }
};
