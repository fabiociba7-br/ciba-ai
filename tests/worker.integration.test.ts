import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { createD1ToolApprovalStore } from "../src/core/tools/durable-consent";
import { beforeEach, describe, expect, it } from "vitest";

const worker = {
  fetch: (request: Request) => workerModule.fetch(
    request,
    env as unknown as Env,
  ),
};
const adminToken = "integration-test-admin-token-0123456789abcdef";
const appId = "com.ciba.integration";

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  const resources = [
    "chat", "persistent_memory", "app_messaging", "task_dispatch",
    "context_sharing", "multi_model_ensemble", "external_tools",
  ];
  await db.batch(resources.map((resourceId) => db.prepare(`
    INSERT INTO cibagenio_controls(resource_id, scope, scope_id, enabled, reason, updated_by, updated_at)
    VALUES(?, 'global', '', 1, 'Integration test setup', 'test', ?)
    ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET
      enabled = 1, reason = excluded.reason, updated_by = 'test', updated_at = excluded.updated_at
  `).bind(resourceId, new Date().toISOString())));
});

const request = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://ciba-ai.test${path}`, init));

const adminRequest = (path: string, method: string, body?: unknown) =>
  request(path, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const createInvitation = async () => {
  const response = await adminRequest("/v1/admin/invitations", "POST", {
    app_id: appId,
    valid_hours: 1,
  });
  expect(response.status).toBe(201);
  return (await response.json() as { invitation_code: string }).invitation_code;
};

const registerDevice = async (invitationCode: string, targetAppId = appId) => {
  const response = await request("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: targetAppId, invitation_code: invitationCode }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { device_id: string; access_token: string };
};

describe("owner-scoped operational observability", () => {
  it("returns only the paired owner's aggregate usage metrics", async () => {
    const appRegistration = await adminRequest("/v1/admin/apps", "POST", {
      app_id: appId,
      display_name: "Observability Test App",
      enabled: true,
    });
    expect(appRegistration.status).toBe(200);

    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: appId });
    expect(ownerResponse.status).toBe(201);
    const owner = await ownerResponse.json() as { owner_id: string; pairing_invitation_code: string };

    const device = await registerDevice(await createInvitation());
    const paired = await request("/v1/owner/pair", {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ pairing_invitation_code: owner.pairing_invitation_code }),
    });
    expect(paired.status).toBe(200);

    const db = (env as unknown as { DB: D1Database }).DB;
    const day = new Date().toISOString().slice(0, 10);
    const minute = new Date().toISOString().slice(0, 16);
    await db.batch([
      db.prepare("DELETE FROM daily_usage WHERE day = ? AND scope_key IN ('global', ?, ?)").bind(day, `app:${appId}`, `device:${device.device_id}`),
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, 'global', 9, 50, ?)").bind(day, new Date().toISOString()),
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, ?, 8, 25, ?)").bind(day, `app:${appId}`, new Date().toISOString()),
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, ?, 7, 10, ?)").bind(day, `device:${device.device_id}`, new Date().toISOString()),
      db.prepare("INSERT INTO minute_usage(minute, device_id, requests, updated_at, request_limit) VALUES(?, ?, 3, ?, 12)").bind(minute, device.device_id, new Date().toISOString()),
    ]);

    const response = await request("/v1/owner/observability", {
      headers: { authorization: `Bearer ${device.access_token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data_available: boolean;
      request_metrics: {
        daily: Array<{ global_bucket_requests: number; app_bucket_requests: number; device_bucket_requests: number }>;
        last_24_hours: { device_requests: number; peak_requests_per_minute: number };
      };
      privacy: { owner_scoped: boolean; prompts_recorded: boolean; responses_recorded: boolean; device_identifiers_exposed: boolean };
    };
    expect(body.data_available).toBe(true);
    expect(body.request_metrics.daily[0]).toMatchObject({
      global_bucket_requests: 9,
      app_bucket_requests: 8,
      device_bucket_requests: 7,
    });
    expect(body.request_metrics.last_24_hours).toMatchObject({
      device_requests: 3,
      peak_requests_per_minute: 3,
    });
    expect(body.privacy).toEqual({
      owner_scoped: true,
      prompts_recorded: false,
      responses_recorded: false,
      device_identifiers_exposed: false,
    });
    expect(JSON.stringify(body)).not.toContain(device.device_id);
    expect(JSON.stringify(body)).not.toContain(owner.owner_id);
  });

  it("rejects requests without a paired device token", async () => {
    const response = await request("/v1/owner/observability");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});


describe("Ciba AI Worker integration", () => {
  it("serves the Garcia dashboard shell with restrictive browser security headers", async () => {
    const response = await request("/dashboard");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const html = await response.text();
    expect(html).toContain("Garcia");
    expect(html).toContain("/v1/owner/dashboard");
    expect(html).toContain("Aprendizado aguardando revisão");
    expect(html).toContain("/v1/owner/memory/reviews");
    expect(html).toContain("Relações entre memórias");
    expect(html).toContain("/v1/owner/memory/insights");
    expect(html).toContain("Histórico de alterações da memória");
    expect(html).toContain("/v1/owner/memory/history");
    expect(html).toContain("Aprovações de ferramentas");
    expect(html).toContain("Aprovar não executa a ação; apenas registra sua autorização de uso único.");
    expect(html).toContain("/v1/owner/tool-approvals");
    expect(html).toContain("Saúde e uso da infraestrutura");
    expect(html).toContain("/v1/owner/observability");
    const scriptStart = html.indexOf("<script>") + "<script>".length;
    const scriptEnd = html.lastIndexOf("</script>");
    expect(scriptStart).toBeGreaterThan("<script>".length);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const dashboardScript = html.slice(scriptStart, scriptEnd);
    expect(() => new Function(dashboardScript!)).not.toThrow();
    expect(html).toContain("Perfil contextual do proprietário");
    expect(html).toContain("/v1/owner/profile");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("localStorage");
  });

  it("registers devices, consumes invitations once, revokes access and preserves technical input protections", async () => {
    const appResponse = await adminRequest("/v1/admin/apps", "POST", {
      app_id: appId,
      display_name: "Ciba Integration Test",
      enabled: true,
    });
    expect(appResponse.status).toBe(200);

    const firstInvitation = await createInvitation();
    const firstDevice = await registerDevice(firstInvitation);

    const reusedInvitation = await request("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, invitation_code: firstInvitation }),
    });
    expect(reusedInvitation.status).toBe(401);

    const revokeResponse = await adminRequest("/v1/admin/devices/revoke", "POST", {
      device_id: firstDevice.device_id,
    });
    expect(revokeResponse.status).toBe(200);

    const revokedUsage = await request("/v1/usage", {
      headers: { authorization: `Bearer ${firstDevice.access_token}` },
    });
    expect(revokedUsage.status).toBe(401);

    const publicConfig = await request("/v1/config");
    expect(publicConfig.status).toBe(200);
    expect((await publicConfig.json() as { limits: { daily_requests: number | null; requests_per_minute: number | null } }).limits)
      .toMatchObject({ daily_requests: null, requests_per_minute: null });

    const secondDevice = await registerDevice(await createInvitation());
    const oversizedMessage = await request("/v1/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondDevice.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(1_501) }] }),
    });
    expect(oversizedMessage.status).toBe(400);
    expect(await oversizedMessage.json()).toEqual({ error: "invalid_message" });

    const oversizedConversation = await request("/v1/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondDevice.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [
        { role: "user", content: "x".repeat(1_500) },
        { role: "assistant", content: "x".repeat(1_500) },
        { role: "user", content: "x" },
      ] }),
    });
    expect(oversizedConversation.status).toBe(413);
    expect(await oversizedConversation.json()).toEqual({
      error: "prompt_too_large",
      max_input_chars: 3_000,
    });

    const testDb = (env as unknown as { DB: D1Database }).DB;
    await testDb.prepare(
      "INSERT INTO runtime_settings(setting_key, setting_value, updated_at) VALUES(?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at"
    ).bind("ai_model", "not-an-allowed-model", new Date().toISOString()).run();

    const assistantHistory = await request("/v1/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondDevice.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [
        { role: "assistant", content: "x".repeat(1_937) },
        { role: "user", content: "Quem sou eu?" },
      ] }),
    });
    expect(assistantHistory.status).toBe(503);
    expect(await assistantHistory.json()).toEqual({ error: "ai_model_not_available" });

    const chat = async () => {
      return request("/v1/ai/chat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secondDevice.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "Olá" }] }),
      });
    };

    await testDb.prepare(
      "UPDATE cibagenio_controls SET enabled = 0 WHERE resource_id = 'chat' AND scope = 'global' AND scope_id = ''"
    ).run();
    const lockedChat = await chat();
    expect(lockedChat.status).toBe(403);
    expect(await lockedChat.json()).toEqual({
      error: "resource_locked_by_cibagenio",
      resource_id: "chat",
      scope: "global",
    });
    // An app-level unlock overrides a global lock only for this app.
    await testDb.prepare(`
      INSERT INTO cibagenio_controls(resource_id, scope, scope_id, enabled, reason, updated_by, updated_at)
      VALUES('chat', 'app', ?, 1, 'App override test', 'test', ?)
      ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET
        enabled = 1, reason = excluded.reason, updated_by = 'test', updated_at = excluded.updated_at
    `).bind(appId, new Date().toISOString()).run();
    const appOverrideChat = await chat();
    expect(appOverrideChat.status).toBe(503);
    expect(await appOverrideChat.json()).toEqual({ error: "ai_model_not_available" });

    // An app-level lock also overrides a global unlock.
    await testDb.prepare(
      "UPDATE cibagenio_controls SET enabled = 1 WHERE resource_id = 'chat' AND scope = 'global' AND scope_id = ''"
    ).run();
    await testDb.prepare(
      "UPDATE cibagenio_controls SET enabled = 0 WHERE resource_id = 'chat' AND scope = 'app' AND scope_id = ?"
    ).bind(appId).run();
    const appLockedChat = await chat();
    expect(appLockedChat.status).toBe(403);
    expect(await appLockedChat.json()).toEqual({
      error: "resource_locked_by_cibagenio",
      resource_id: "chat",
      scope: "app",
    });
    await testDb.prepare(
      "DELETE FROM cibagenio_controls WHERE resource_id = 'chat' AND scope = 'app' AND scope_id = ?"
    ).bind(appId).run();
    await testDb.prepare(
      "UPDATE cibagenio_controls SET enabled = 1 WHERE resource_id = 'chat' AND scope = 'global' AND scope_id = ''"
    ).run();

    // Repeated requests must not be rejected by removed daily or per-minute
    // application quotas. The deliberately invalid model remains the expected
    // independent reason for these requests to return 503.
    const firstChat = await chat();
    expect(firstChat.status).toBe(503);
    expect(await firstChat.json()).toEqual({ error: "ai_model_not_available" });

    const repeatedChat = await chat();
    expect(repeatedChat.status).toBe(503);
    expect(await repeatedChat.json()).toEqual({ error: "ai_model_not_available" });

    const status = await request("/v1/status");
    expect(status.status).toBe(200);
    const statusBody = await status.json() as { database: string; status: string; ai_enabled: boolean };
    expect(statusBody.database).toBe("connected");
    expect(statusBody.status).toBe("degraded");
    expect(statusBody.ai_enabled).toBe(false);

    const models = await request("/v1/models");
    expect(await models.json()).toEqual({ models: [], configured: false });

    const config = await request("/v1/config");
    expect((await config.json() as { ai_enabled: boolean }).ai_enabled).toBe(false);
  });
});


describe("Ciba AI administrative authentication", () => {
  it("limits repeated invalid admin tokens by Cloudflare edge IP", async () => {
    const attempt = () => worker.fetch(new Request("https://ciba-ai.test/v1/admin/apps", {
      method: "GET",
      headers: { "CF-Connecting-IP": "198.51.100.77" },
    }));

    for (let index = 0; index < 10; index += 1) {
      const response = await attempt();
      expect(response.status).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: "admin_auth_rate_limited",
      retry_after_seconds: 60,
    });
    expect(blocked.headers.get("retry-after")).toBe("60");
  });
});


describe("Ciba AI browser-origin policy", () => {
  it("does not grant CORS access to origins unless explicitly configured", async () => {
    const response = await worker.fetch(new Request("https://ciba-ai.test/v1/status", {
      headers: { Origin: "https://untrusted.example" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await worker.fetch(new Request("https://ciba-ai.test/v1/admin/apps", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "GET",
      },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});


describe("Ciba AI response security headers", () => {
  it("sets baseline browser security headers on API responses", async () => {
    const response = await request("/v1/status");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");

    const invalidJson = await request("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.headers.get("x-content-type-options")).toBe("nosniff");
    expect(invalidJson.headers.get("referrer-policy")).toBe("no-referrer");
    expect(invalidJson.headers.get("x-frame-options")).toBe("DENY");

    const oversizedBody = await request("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: "com.ciba.test", invitation_code: "x".repeat(9_000) }),
    });
    expect(oversizedBody.status).toBe(413);
    expect(await oversizedBody.json()).toEqual({ error: "body_too_large" });
  });
});


describe("Garcia private single-owner access", () => {
  it("allows only one active Garcia device and one owner pairing", async () => {
    const privateAppId = "com.ciba.garcia";
    const app = await adminRequest("/v1/admin/apps", "POST", {
      app_id: privateAppId, display_name: "Garcia", enabled: true,
    });
    expect(app.status).toBe(200);
    const firstInvite = await adminRequest("/v1/admin/invitations", "POST", { app_id: privateAppId });
    expect(firstInvite.status).toBe(201);
    const inviteCode = (await firstInvite.json() as { invitation_code: string }).invitation_code;
    const device = await registerDevice(inviteCode, privateAppId);

    const secondInvite = await adminRequest("/v1/admin/invitations", "POST", { app_id: privateAppId });
    expect(secondInvite.status).toBe(409);
    expect(await secondInvite.json()).toEqual({ error: "private_device_already_registered" });

    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: privateAppId });
    expect(ownerResponse.status).toBe(201);
    const owner = await ownerResponse.json() as { owner_id: string; pairing_invitation_code: string };

    const duplicateOwner = await adminRequest("/v1/admin/owners", "POST", { app_id: privateAppId });
    expect(duplicateOwner.status).toBe(409);
    expect(await duplicateOwner.json()).toEqual({ error: "private_owner_already_configured" });

    const paired = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${device.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: owner.pairing_invitation_code }),
    });
    expect(paired.status).toBe(200);

    const duplicatePairing = await adminRequest("/v1/admin/owner-invitations", "POST", {
      owner_id: owner.owner_id, app_id: privateAppId,
    });
    expect(duplicatePairing.status).toBe(409);
    expect(await duplicatePairing.json()).toEqual({ error: "private_owner_device_already_paired" });

    const revoked = await adminRequest("/v1/admin/devices/revoke", "POST", { device_id: device.device_id });
    expect(revoked.status).toBe(200);
  });
});

describe("Ciba AI administrative technical safety ceilings", () => {
  it("rejects output-token settings that exceed the technical safety ceiling", async () => {
    const outputLimit = await adminRequest("/v1/admin/settings", "POST", {
      settings: { max_output_tokens: 513 },
    });
    expect(outputLimit.status).toBe(400);
    expect(await outputLimit.json()).toEqual({
      error: "setting_exceeds_safety_ceiling",
      key: "max_output_tokens",
      maximum: 512,
    });
  });
});


describe("Ciba AI owner-controlled app access grants", () => {
  it("creates, lists and revokes scoped grants only from a paired owner device", async () => {
    const sourceApp = "com.ciba.grants.source";
    const targetApp = "com.ciba.grants.target";
    for (const [appId, displayName, appType, capabilities] of [
      [sourceApp, "Grant Source", "assistant", ["assistant", "productivity"]],
      [targetApp, "Grant Target", "productivity", ["notes", "calendar"]],
    ] as const) {
      const response = await adminRequest("/v1/admin/apps", "POST", {
        app_id: appId, display_name: displayName, enabled: true,
        description: displayName + " integration test app",
        app_type: appType, capabilities,
        task_types: appId === sourceApp ? ["analyze", "plan"] : ["organize", "summarize"],
        contract_version: "1.0.0",
      });
      expect(response.status).toBe(200);
    }

    const invitationResponse = await adminRequest("/v1/admin/invitations", "POST", {
      app_id: sourceApp, valid_hours: 1,
    });
    expect(invitationResponse.status).toBe(201);
    const invitationCode = (await invitationResponse.json() as { invitation_code: string }).invitation_code;
    const device = await registerDevice(invitationCode, sourceApp);

    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: sourceApp });
    expect(ownerResponse.status).toBe(201);
    const ownerBody = await ownerResponse.json() as { owner_id: string; pairing_invitation_code: string };
    const ownerCode = ownerBody.pairing_invitation_code;
    const pairResponse = await request("/v1/owner/pair", {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ pairing_invitation_code: ownerCode }),
    });
    expect(pairResponse.status).toBe(200);

    const ownerRequest = (path: string, method: string, body?: unknown) => request(path, {
      method,
      headers: {
        authorization: `Bearer ${device.access_token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const defaultSettings = await ownerRequest("/v1/owner/settings", "GET");
    expect((await defaultSettings.json() as { settings: { memory_enabled: boolean; app_messaging_enabled: boolean } }).settings)
      .toEqual({ memory_enabled: false, app_messaging_enabled: false });

    const dashboardResponse = await ownerRequest("/v1/owner/dashboard", "GET");
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json() as {
      identity: string;
      intelligence: { mode: string; multi_model_execution_enabled: boolean };
      connected_apps: Array<{ app_id: string; active_device_count: number }>;
      devices: Array<Record<string, unknown>>;
      security: { credentials_returned: boolean; conversation_content_returned: boolean };
    };
    expect(dashboard.identity).toBe("Garcia");
    expect(dashboard.intelligence.mode).toBe("single-pass");
    expect(dashboard.intelligence.multi_model_execution_enabled).toBe(false);
    expect(dashboard.connected_apps.some((app) => app.app_id === sourceApp && app.active_device_count === 1)).toBe(true);
    expect(dashboard.devices).toHaveLength(1);
    expect(dashboard.devices[0]).not.toHaveProperty("token_hash");
    expect(dashboard.security).toEqual({
      owner_identity_derived_from_paired_device: true,
      credentials_returned: false,
      conversation_content_returned: false,
    });
    const selfRevoke = await ownerRequest("/v1/owner/devices/revoke", "POST", {
      device_id: device.device_id,
    });
    expect(selfRevoke.status).toBe(400);
    expect(await selfRevoke.json()).toEqual({ error: "current_device_cannot_revoke" });
    const availableApps = await ownerRequest("/v1/owner/available-apps", "GET");
    expect(availableApps.status).toBe(200);
    expect((await availableApps.json() as { apps: Array<{ app_id: string }> }).apps.map((app) => app.app_id))
      .toContain(targetApp);
    const appConnection = await ownerRequest("/v1/owner/apps/connect", "POST", { app_id: targetApp });
    expect(appConnection.status).toBe(201);
    const connectionCodes = await appConnection.json() as {
      app_id: string; registration_invitation_code: string; pairing_invitation_code: string; expires_at: string;
    };
    expect(connectionCodes.app_id).toBe(targetApp);
    expect(connectionCodes.registration_invitation_code).toHaveLength(32);
    expect(connectionCodes.pairing_invitation_code).toHaveLength(32);
    expect(connectionCodes.expires_at).toBeTruthy();
    const connectedAppDevice = await registerDevice(connectionCodes.registration_invitation_code, targetApp);
    const connectedAppPairing = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${connectedAppDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: connectionCodes.pairing_invitation_code }),
    });
    expect(connectedAppPairing.status).toBe(200);
    const connectedDashboard = await ownerRequest("/v1/owner/dashboard", "GET");
    expect((await connectedDashboard.json() as { connected_apps: Array<{ app_id: string }> }).connected_apps)
      .toEqual(expect.arrayContaining([expect.objectContaining({ app_id: targetApp })]));
    const replayedPairing = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${connectedAppDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: connectionCodes.pairing_invitation_code }),
    });
    expect(replayedPairing.status).toBe(409);
    const invalidAppConnection = await ownerRequest("/v1/owner/apps/connect", "POST", { app_id: "com.ciba.not-registered" });
    expect(invalidAppConnection.status).toBe(400);

    const secondInvitation = await adminRequest("/v1/admin/invitations", "POST", {
      app_id: sourceApp, valid_hours: 1,
    });
    const secondDevice = await registerDevice(
      (await secondInvitation.json() as { invitation_code: string }).invitation_code,
      sourceApp,
    );
    const ownerId = ownerBody.owner_id;
    const secondPairing = await adminRequest("/v1/admin/owner-invitations", "POST", {
      owner_id: ownerId, app_id: sourceApp,
    });
    expect(secondPairing.status).toBe(201);
    const secondPairingCode = (await secondPairing.json() as { pairing_invitation_code: string }).pairing_invitation_code;
    const secondPair = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${secondDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: secondPairingCode }),
    });
    expect(secondPair.status).toBe(200);
    const revokedDevice = await ownerRequest("/v1/owner/devices/revoke", "POST", {
      device_id: secondDevice.device_id,
    });
    expect(revokedDevice.status).toBe(200);
    expect(await revokedDevice.json()).toMatchObject({ revoked: true, device_id: secondDevice.device_id });
    const revokedDeviceAccess = await request("/v1/owner/dashboard", {
      headers: { authorization: `Bearer ${secondDevice.access_token}` },
    });
    expect(revokedDeviceAccess.status).toBe(401);

    const enabled = await ownerRequest("/v1/owner/settings", "POST", {
      settings: { app_messaging_enabled: true },
    });
    expect(enabled.status).toBe(200);

    const created = await ownerRequest("/v1/owner/access-grants", "POST", {
      grantee_app_id: sourceApp,
      source_app_id: sourceApp,
      destination_app_id: targetApp,
      permission: "send",
      scope: "task",
      valid_hours: 24,
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { grant: { grant_id: string; permission: string; scope: string } };
    expect(createdBody.grant.permission).toBe("send");
    expect(createdBody.grant.scope).toBe("task");

    const listed = await ownerRequest("/v1/owner/access-grants", "GET");
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { grants: Array<{ grant_id: string; revoked_at: string | null }> };
    expect(listBody.grants.some((grant) => grant.grant_id === createdBody.grant.grant_id)).toBe(true);

    const badDirection = await ownerRequest("/v1/owner/access-grants", "POST", {
      grantee_app_id: targetApp,
      source_app_id: sourceApp,
      destination_app_id: targetApp,
      permission: "send",
      scope: "task",
    });
    expect(badDirection.status).toBe(400);

    const revoked = await ownerRequest("/v1/owner/access-grants/revoke", "POST", {
      grant_id: createdBody.grant.grant_id,
    });
    expect(revoked.status).toBe(200);
    const repeatedRevoke = await ownerRequest("/v1/owner/access-grants/revoke", "POST", {
      grant_id: createdBody.grant.grant_id,
    });
    expect(repeatedRevoke.status).toBe(404);

    const targetInvitation = await adminRequest("/v1/admin/invitations", "POST", {
      app_id: targetApp, valid_hours: 1,
    });
    const targetCode = (await targetInvitation.json() as { invitation_code: string }).invitation_code;
    const unpairedTarget = await registerDevice(targetCode, targetApp);
    const denied = await request("/v1/owner/access-grants", {
      headers: { authorization: `Bearer ${unpairedTarget.access_token}` },
    });
    expect(denied.status).toBe(403);
  });
});


describe("Ciba AI private app-to-app message relay", () => {
  it("delivers only with paired owner identity and matching send/receive grants", async () => {
    const sourceApp = "com.ciba.relay.source";
    const targetApp = "com.ciba.relay.target";
    for (const [appId, displayName, appType, capabilities, taskTypes] of [
      [sourceApp, "Relay Source", "assistant", ["assistant", "productivity"], ["analyze", "plan"]],
      [targetApp, "Relay Target", "productivity", ["notes", "calendar"], ["organize", "summarize"]],
    ] as const) {
      const response = await adminRequest("/v1/admin/apps", "POST", {
        app_id: appId, display_name: displayName, enabled: true,
        description: displayName + " app",
        app_type: appType, capabilities, task_types: taskTypes,
        contract_version: "1.0.0",
      });
      expect(response.status).toBe(200);
    }

    const sourceInvite = await adminRequest("/v1/admin/invitations", "POST", { app_id: sourceApp, valid_hours: 1 });
    const sourceCode = (await sourceInvite.json() as { invitation_code: string }).invitation_code;
    const sourceDevice = await registerDevice(sourceCode, sourceApp);
    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: sourceApp });
    const ownerDetails = await ownerResponse.json() as { owner_id: string; pairing_invitation_code: string };
    const ownerCode = ownerDetails.pairing_invitation_code;
    const pair = (token: string, code: string) => request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: code }),
    });
    expect((await pair(sourceDevice.access_token, ownerCode)).status).toBe(200);

    const targetInvite = await adminRequest("/v1/admin/invitations", "POST", { app_id: targetApp, valid_hours: 1 });
    const targetCode = (await targetInvite.json() as { invitation_code: string }).invitation_code;
    const targetDevice = await registerDevice(targetCode, targetApp);
    const targetPairInvite = await adminRequest("/v1/admin/owner-invitations", "POST", {
      owner_id: ownerDetails.owner_id, app_id: targetApp,
    });
    const targetPairCode = (await targetPairInvite.json() as { pairing_invitation_code: string }).pairing_invitation_code;
    expect((await pair(targetDevice.access_token, targetPairCode)).status).toBe(200);

    const partialProfileUpdate = await adminRequest("/v1/admin/apps", "POST", {
      app_id: sourceApp, display_name: "Relay Source", enabled: true,
    });
    expect(partialProfileUpdate.status).toBe(200);

    const sourceIdentityResponse = await request("/v1/apps/identity", {
      headers: { authorization: `Bearer ${sourceDevice.access_token}` },
    });
    expect(sourceIdentityResponse.status).toBe(200);
    const sourceIdentity = await sourceIdentityResponse.json() as {
      contract: string;
      contract_version: string;
      identity: { app_id: string; app_type: string; capabilities: string[]; task_types: string[] };
      connected_apps: Array<{ app_id: string; capabilities: string[]; task_types: string[] }>;
      capability_semantics: { descriptive_only: boolean; grants_required_for_cross_app_access: boolean; app_actions_executable_by_garcia: boolean };
    };
    expect(sourceIdentity.contract).toBe("garcia-app");
    expect(sourceIdentity.contract_version).toBe("1.0.0");
    expect(sourceIdentity.identity).toMatchObject({
      app_id: sourceApp, app_type: "assistant", capabilities: ["assistant", "productivity"], task_types: ["analyze", "plan"],
    });
    expect(sourceIdentity.connected_apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ app_id: targetApp, capabilities: ["notes", "calendar"], task_types: ["organize", "summarize"] }),
    ]));
    expect(sourceIdentity.capability_semantics).toEqual({
      descriptive_only: true,
      grants_required_for_cross_app_access: true,
      app_actions_executable_by_garcia: false,
    });

    const unauthenticatedIdentity = await request("/v1/apps/identity");
    expect(unauthenticatedIdentity.status).toBe(401);

    const invalidProfile = await adminRequest("/v1/admin/apps", "POST", {
      app_id: "com.ciba.invalid.profile",
      display_name: "Invalid Profile",
      capabilities: ["execute_shell"],
    });
    expect(invalidProfile.status).toBe(400);
    expect(await invalidProfile.json()).toEqual({ error: "invalid_app_capabilities" });

    const enableMessaging = await request("/v1/owner/settings", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ settings: { app_messaging_enabled: true } }),
    });
    expect(enableMessaging.status).toBe(200);

    const grant = (token: string, grantee: string, permission: "send" | "receive") =>
      request("/v1/owner/access-grants", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          grantee_app_id: grantee,
          source_app_id: sourceApp,
          destination_app_id: targetApp,
          permission,
          scope: "task",
          valid_hours: 24,
        }),
      });
    const sendGrant = await grant(sourceDevice.access_token, sourceApp, "send");
    const receiveGrant = await grant(sourceDevice.access_token, targetApp, "receive");
    expect(sendGrant.status).toBe(201);
    expect(receiveGrant.status).toBe(201);
    const receiveGrantId = (await receiveGrant.json() as { grant: { grant_id: string } }).grant.grant_id;

    const send = (clientMessageId: string) => request("/v1/apps/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        destination_app_id: targetApp,
        client_message_id: clientMessageId,
        task_id: "task-relay-1",
        scope: "task",
        payload: { instruction: "summarize", data: "private task data" },
      }),
    });
    const queued = await send("source-msg-001");
    expect(queued.status).toBe(201);
    const duplicate = await send("source-msg-001");
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true);

    const inbox = () => request("/v1/apps/messages/inbox", {
      headers: { authorization: `Bearer ${targetDevice.access_token}` },
    });
    const received = await inbox();
    expect(received.status).toBe(200);
    const inboxBody = await received.json() as { messages: Array<{ message_id: string; payload: { data: string } }> };
    expect(inboxBody.messages).toHaveLength(1);
    expect(inboxBody.messages[0].payload.data).toBe("private task data");

    const messageId = inboxBody.messages[0].message_id;
    const acknowledged = await request("/v1/apps/messages/ack", {
      method: "POST",
      headers: { authorization: `Bearer ${targetDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ message_ids: [messageId] }),
    });
    expect(acknowledged.status).toBe(200);
    expect((await acknowledged.json() as { acknowledged: number }).acknowledged).toBe(1);
    expect((await (await inbox()).json() as { messages: unknown[] }).messages).toHaveLength(0);


    const contextGrant = (token: string, grantee: string, permission: "send" | "receive") =>
      request("/v1/owner/access-grants", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          grantee_app_id: grantee,
          source_app_id: sourceApp,
          destination_app_id: targetApp,
          permission,
          scope: "context",
          valid_hours: 24,
        }),
      });
    expect((await contextGrant(sourceDevice.access_token, sourceApp, "send")).status).toBe(201);
    expect((await contextGrant(sourceDevice.access_token, targetApp, "receive")).status).toBe(201);
    const contextShare = await request("/v1/apps/context/share", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        destination_app_id: targetApp,
        client_message_id: "context-share-001",
        purpose: "Dar continuidade ao planejamento",
        items: [
          { key: "preferred_style", value: "Respostas diretas", kind: "preference", origin: "curated_memory" },
          { key: "current_phase", value: "Revisão de arquitetura", kind: "project", origin: "task_state" },
        ],
      }),
    });
    expect(contextShare.status).toBe(201);
    expect(await contextShare.json()).toMatchObject({
      shared: true, duplicate: false,
      message: { scope: "context", item_count: 2, conversation_history_included: false },
    });
    const contextInbox = await inbox();
    const contextBody = await contextInbox.json() as {
      messages: Array<{ message_id: string; scope: string; payload: { protocol: string; items: Array<{ key: string }> } }>;
    };
    expect(contextBody.messages).toHaveLength(1);
    expect(contextBody.messages[0]).toMatchObject({
      scope: "context",
      payload: { protocol: "garcia.context.package", conversation_history_included: false,
        items: [{ key: "preferred_style" }, { key: "current_phase" }] },
    });
    const deniedContext = await request("/v1/apps/context/share", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        destination_app_id: targetApp,
        client_message_id: "context-share-invalid",
        purpose: "Contexto inválido",
        items: [{ key: "transcript", value: "x", kind: "fact", origin: "task_state" }],
      }),
    });
    expect(deniedContext.status).toBe(400);
    const contextAck = await request("/v1/apps/messages/ack", {
      method: "POST",
      headers: { authorization: `Bearer ${targetDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ message_ids: [contextBody.messages[0].message_id] }),
    });
    expect(contextAck.status).toBe(200);

    const enableMemoryForTask = await request("/v1/owner/settings", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ settings: { memory_enabled: true } }),
    });
    expect(enableMemoryForTask.status).toBe(200);
    const savedTaskMemory = await request("/v1/owner/memory?scope=app", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        key: "project_phase",
        value: "Projeto em revisão da arquitetura do aplicativo",
        consent: "curated",
      }),
    });
    expect(savedTaskMemory.status).toBe(201);

    const dispatched = await request("/v1/apps/tasks/dispatch", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        task_type: "summarize",
        instruction: "Resuma a arquitetura do aplicativo e a fase do projeto.",
        client_message_id: "coordinator-task-001",
        context: { source: "integration-test" },
        include_context: true,
      }),
    });
    expect(dispatched.status).toBe(201);
    const dispatchBody = await dispatched.json() as {
      dispatched: boolean;
      route: { task_id: string; destination_app_id: string; destination_display_name: string; task_type: string; context_sharing: { requested: boolean; included: boolean; items_count: number; reason: string } };
    };
    expect(dispatchBody.dispatched).toBe(true);
    expect(dispatchBody.route.context_sharing).toMatchObject({ requested: true, included: true, items_count: 1, reason: "authorized_relevant_memories" });
    const queuedStatus = await request(`/v1/apps/tasks/status?task_id=${encodeURIComponent(dispatchBody.route.task_id)}`, {
      headers: { authorization: `Bearer ${sourceDevice.access_token}` },
    });
    expect(queuedStatus.status).toBe(200);
    expect(await queuedStatus.json()).toMatchObject({
      task_id: dispatchBody.route.task_id,
      lifecycle: { status: "awaiting_delivery", acknowledged: false, result_count: 0 },
      automatic_execution: false,
    });

    expect(dispatchBody.route).toMatchObject({
      destination_app_id: targetApp, destination_display_name: "Relay Target", task_type: "summarize",
    });
    const taskInbox = await inbox();
    const taskInboxBody = await taskInbox.json() as {
      messages: Array<{ message_id: string; task_id: string; payload: { protocol: string; task_type: string; instruction: string; context: { source: string }; context_package: { protocol: string; conversation_history_included: false; items: Array<{ key: string; value: string }> } } }>;
    };
    expect(taskInboxBody.messages).toHaveLength(1);
    expect(taskInboxBody.messages[0]).toMatchObject({
      task_id: dispatchBody.route.task_id,
      payload: {
        protocol: "garcia.task.request",
        task_type: "summarize",
        instruction: "Resuma a arquitetura do aplicativo e a fase do projeto.",
        context: { source: "integration-test" },
        context_package: {
          protocol: "garcia.context.package",
          conversation_history_included: false,
          items: [{ key: "project_phase", value: "Projeto em revisão da arquitetura do aplicativo" }],
        },
      },
    });
    const taskAck = await request("/v1/apps/messages/ack", {
      method: "POST",
      headers: { authorization: `Bearer ${targetDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ message_ids: [taskInboxBody.messages[0].message_id] }),
    });
    expect(taskAck.status).toBe(200);

    const reverseGrant = (token: string, grantee: string, source: string, destination: string, permission: "send" | "receive") =>
      request("/v1/owner/access-grants", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          grantee_app_id: grantee, source_app_id: source, destination_app_id: destination,
          permission, scope: "task", valid_hours: 24,
        }),
      });
    expect((await reverseGrant(sourceDevice.access_token, targetApp, targetApp, sourceApp, "send")).status).toBe(201);
    expect((await reverseGrant(sourceDevice.access_token, sourceApp, targetApp, sourceApp, "receive")).status).toBe(201);

    const submittedResult = await request("/v1/apps/tasks/results", {
      method: "POST",
      headers: { authorization: `Bearer ${targetDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        task_id: dispatchBody.route.task_id,
        client_message_id: "coordinator-result-001",
        status: "completed",
        result: { summary: "Resumo concluído", items: 3 },
      }),
    });
    const submittedResultBody = await submittedResult.clone().json();
    expect(submittedResult.status, JSON.stringify(submittedResultBody)).toBe(201);
    const taskResults = await request(`/v1/apps/tasks/results?task_id=${encodeURIComponent(dispatchBody.route.task_id)}`, {
      headers: { authorization: `Bearer ${sourceDevice.access_token}` },
    });
    expect(taskResults.status).toBe(200);
    const completedStatus = await request(`/v1/apps/tasks/status?task_id=${encodeURIComponent(dispatchBody.route.task_id)}`, {
      headers: { authorization: `Bearer ${sourceDevice.access_token}` },
    });
    expect(completedStatus.status).toBe(200);
    expect(await completedStatus.json()).toMatchObject({
      lifecycle: { status: "completed", acknowledged: true, result_count: 1, completed_results: 1 },
      destination_app_id: targetApp,
    });

    expect(await taskResults.json()).toMatchObject({
      task_id: dispatchBody.route.task_id,
      count: 1,
      consolidation: {
        status: "single_result",
        completed_results: 1,
        agreement: true,
        consensus_result: { summary: "Resumo concluído", items: 3 },
      },
      results: [expect.objectContaining({
        source_app_id: targetApp,
        payload: {
          protocol: "garcia.task.result",
          contract: "garcia-app",
          contract_version: "1.0.0",
          task_id: dispatchBody.route.task_id,
          status: "completed",
          result: { summary: "Resumo concluído", items: 3 },
        },
      })],
    });
    const badTaskResult = await request("/v1/apps/tasks/results", {
      method: "POST",
      headers: { authorization: `Bearer ${targetDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        task_id: "task-not-owned",
        client_message_id: "coordinator-result-invalid",
        result: { summary: "não autorizado" },
      }),
    });
    expect(badTaskResult.status).toBe(404);

    const queuedAfterRevoke = await send("source-msg-002");
    expect(queuedAfterRevoke.status).toBe(201);
    const revoked = await request("/v1/owner/access-grants/revoke", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ grant_id: receiveGrantId }),
    });
    expect(revoked.status).toBe(200);
    expect((await (await inbox()).json() as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it("rejects unpaired devices and messages without both sides' grants", async () => {
    const sourceApp = "com.ciba.relay.denied.source";
    const targetApp = "com.ciba.relay.denied.target";
    for (const appId of [sourceApp, targetApp]) {
      await adminRequest("/v1/admin/apps", "POST", { app_id: appId, display_name: appId, enabled: true });
    }
    const sourceInvite = await adminRequest("/v1/admin/invitations", "POST", { app_id: sourceApp, valid_hours: 1 });
    const sourceCode = (await sourceInvite.json() as { invitation_code: string }).invitation_code;
    const source = await registerDevice(sourceCode, sourceApp);
    const denied = await request("/v1/apps/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${source.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        destination_app_id: targetApp, client_message_id: "no-grant",
        task_id: "task-denied", scope: "task", payload: { secret: "no" },
      }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "active_owner_required" });
  });
});

describe("Ciba AI curated private memory", () => {
  it("isolates app memory and requires explicit grants for owner memory", async () => {
    const memoryApp = "com.ciba.memory.owner";
    const response = await adminRequest("/v1/admin/apps", "POST", {
      app_id: memoryApp, display_name: "Memory Owner App", enabled: true,
    });
    expect(response.status).toBe(200);

    const invitation = await adminRequest("/v1/admin/invitations", "POST", {
      app_id: memoryApp, valid_hours: 1,
    });
    const code = (await invitation.json() as { invitation_code: string }).invitation_code;
    const device = await registerDevice(code, memoryApp);
    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: memoryApp });
    const ownerCode = (await ownerResponse.json() as { pairing_invitation_code: string }).pairing_invitation_code;
    const paired = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${device.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: ownerCode }),
    });
    expect(paired.status).toBe(200);

    const ownerRequest = (path: string, method = "GET", body?: unknown) => request(path, {
      method,
      headers: {
        authorization: `Bearer ${device.access_token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const defaults = await ownerRequest("/v1/owner/settings");
    expect((await defaults.json() as { settings: { memory_enabled: boolean; app_messaging_enabled: boolean } }).settings)
      .toEqual({ memory_enabled: false, app_messaging_enabled: false });
    const blockedMemory = await ownerRequest("/v1/owner/memory?scope=app");
    expect(blockedMemory.status).toBe(403);
    const blockedInsights = await ownerRequest("/v1/owner/memory/insights");
    expect(blockedInsights.status).toBe(403);
    const blockedProfile = await ownerRequest("/v1/owner/profile");
    expect(blockedProfile.status).toBe(403);
    const blockedHistory = await ownerRequest("/v1/owner/memory/history?scope=app");
    expect(blockedHistory.status).toBe(403);
    const blockedCandidate = await ownerRequest("/v1/owner/memory/candidates", "POST", {
      source_role: "user", source_text: "Prefiro respostas diretas.", key: "response_style", value: "Prefiro respostas diretas",
    });
    expect(blockedCandidate.status).toBe(403);
    expect(await blockedCandidate.json()).toEqual({ error: "memory_disabled" });
    const enabled = await ownerRequest("/v1/owner/settings", "POST", {
      settings: { memory_enabled: true },
    });
    expect(enabled.status).toBe(200);

    const candidateResponse = await ownerRequest("/v1/owner/memory/candidates", "POST", {
      source_role: "user",
      source_text: "Prefiro respostas diretas e sem rodeios.",
      key: "response_style",
      value: "Prefiro respostas diretas",
      scope: "app",
    });
    expect(candidateResponse.status).toBe(200);
    const candidateBody = await candidateResponse.json() as {
      candidate: { key: string; value: string; requires_confirmation: boolean; persisted: boolean };
      stored: boolean; inference_calls: number;
    };
    expect(candidateBody.candidate).toMatchObject({
      key: "response_style", value: "Prefiro respostas diretas",
      requires_confirmation: true, persisted: false,
    });
    expect(candidateBody.stored).toBe(false);
    expect(candidateBody.inference_calls).toBe(0);
    const beforeConfirmation = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await beforeConfirmation.json() as { memories: unknown[] }).memories).toHaveLength(0);

    const unsupportedCandidate = await ownerRequest("/v1/owner/memory/candidates", "POST", {
      source_role: "user", source_text: "Gosto de rock.", key: "music", value: "Prefiro jazz.",
    });
    expect(unsupportedCandidate.status).toBe(400);
    expect(await unsupportedCandidate.json()).toEqual({ error: "memory_candidate_not_supported_by_user_quote" });

    const assistantCandidate = await ownerRequest("/v1/owner/memory/candidates", "POST", {
      source_role: "assistant", source_text: "Prefiro respostas diretas.", key: "response_style", value: "Prefiro respostas diretas",
    });
    expect(assistantCandidate.status).toBe(400);
    expect(await assistantCandidate.json()).toEqual({ error: "memory_candidate_user_source_required" });

    const saved = await ownerRequest("/v1/owner/memory?scope=app", "POST", {
      key: candidateBody.candidate.key, value: candidateBody.candidate.value, consent: "curated",
    });
    expect(saved.status).toBe(201);
    const savedBody = await saved.json() as { memory_id: string };
    const listed = await ownerRequest("/v1/owner/memory?scope=app");
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { memories: Array<{ memory_id: string; value: string }> };
    expect(listBody.memories).toHaveLength(1);
    expect(listBody.memories[0].memory_id).toBe(savedBody.memory_id);

    const filteredMemory = await ownerRequest("/v1/owner/memory?scope=app&q=RESP");
    expect((await filteredMemory.json() as { memories: Array<{ memory_id: string }> }).memories.map((item) => item.memory_id))
      .toContain(savedBody.memory_id);
    const noMatchMemory = await ownerRequest("/v1/owner/memory?scope=app&q=nao-existe");
    expect((await noMatchMemory.json() as { memories: unknown[] }).memories).toHaveLength(0);

    const updatedMemory = await ownerRequest("/v1/owner/memory?scope=app", "PATCH", {
      memory_id: savedBody.memory_id,
      key: "response_style",
      value: "Prefere respostas objetivas e claras.",
      consent: "curated",
      valid_hours: 72,
    });
    expect(updatedMemory.status).toBe(200);
    const updatedList = await ownerRequest("/v1/owner/memory?scope=app&q=objetivas");
    const updatedRecords = (await updatedList.json() as { memories: Array<{ memory_id: string; value: string; expires_at: string }> }).memories;
    expect(updatedRecords).toHaveLength(1);
    expect(updatedRecords[0].memory_id).toBe(savedBody.memory_id);
    expect(updatedRecords[0].value).toBe("Prefere respostas objetivas e claras.");
    expect(updatedRecords[0].expires_at).toBeTruthy();

    const clearExpiry = await ownerRequest("/v1/owner/memory?scope=app", "PATCH", {
      memory_id: savedBody.memory_id, key: "response_style",
      value: "Prefere respostas objetivas e claras.", consent: "curated", valid_hours: null,
    });
    expect(clearExpiry.status).toBe(200);
    const permanentList = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await permanentList.json() as { memories: Array<{ expires_at: string | null }> }).memories[0].expires_at).toBeNull();

    const proposalResponse = await ownerRequest("/v1/owner/memory/reviews?scope=app", "POST", {
      source_role: "user",
      source_text: "Prefiro respostas concisas e claras.",
      key: "response_style",
      value: "Prefiro respostas concisas e claras.",
      valid_hours: 120,
    });
    expect(proposalResponse.status).toBe(201);
    const proposal = await proposalResponse.json() as { proposal_id: string; classification: string; stored_as_memory: boolean };
    expect(proposal.classification).toBe("possible_conflict");
    expect(proposal.stored_as_memory).toBe(false);
    const pendingReviews = await ownerRequest("/v1/owner/memory/reviews?scope=app");
    expect((await pendingReviews.json() as { proposals: unknown[] }).proposals).toHaveLength(1);
    const memoryBeforeApproval = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await memoryBeforeApproval.json() as { memories: Array<{ value: string }> }).memories[0].value)
      .toBe("Prefere respostas objetivas e claras.");
    const approvedReview = await ownerRequest("/v1/owner/memory/reviews?scope=app", "PATCH", {
      proposal_id: proposal.proposal_id, decision: "approve",
    });
    expect(approvedReview.status).toBe(200);
    expect(await approvedReview.json()).toMatchObject({ decided: true, decision: "approved", updated_memory: true });
    const memoryAfterApproval = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await memoryAfterApproval.json() as { memories: Array<{ value: string }> }).memories[0].value)
      .toBe("Prefiro respostas concisas e claras.");

    const ownSearch = await ownerRequest("/v1/owner/memory/retrieve", "POST", {
      query: "estilo de resposta", limit: 5,
    });
    expect(ownSearch.status).toBe(200);
    const ownSearchBody = await ownSearch.json() as {
      memories: Array<{ memory_id: string; scope: string }>;
      inference_calls: number;
    };
    expect(ownSearchBody.memories.map((memory) => memory.memory_id)).toContain(savedBody.memory_id);
    expect(ownSearchBody.memories.every((memory) => memory.scope === "app")).toBe(true);
    expect(ownSearchBody.inference_calls).toBe(0);

    const noConsent = await ownerRequest("/v1/owner/memory?scope=app", "POST", {
      key: "no_consent", value: "Não deve salvar.", consent: "disabled",
    });
    expect(noConsent.status).toBe(400);

    const secret = await ownerRequest("/v1/owner/memory?scope=app", "POST", {
      key: "credential", value: "api_key=not-a-real-key", consent: "curated",
    });
    expect(secret.status).toBe(400);

    const deniedOwnerMemory = await ownerRequest("/v1/owner/memory?scope=owner");
    expect(deniedOwnerMemory.status).toBe(403);

    for (const permission of ["memory_read", "memory_write"]) {
      const grant = await ownerRequest("/v1/owner/access-grants", "POST", {
        grantee_app_id: memoryApp,
        permission,
        scope: "owner_memory",
        valid_hours: 24,
      });
      expect(grant.status).toBe(201);
    }

    const savedOwner = await ownerRequest("/v1/owner/memory?scope=owner", "POST", {
      key: "global_preference", value: "Memória central explícita.", consent: "curated",
    });
    expect(savedOwner.status).toBe(201);
    const ownerList = await ownerRequest("/v1/owner/memory?scope=owner");
    const insightsResponse = await ownerRequest("/v1/owner/memory/insights");
    expect(insightsResponse.status).toBe(200);
    const insights = await insightsResponse.json() as {
      analyzed_records: number;
      possible_conflicts: Array<{ first: { memory_id: string }; second: { memory_id: string } }>;
      inference_calls: number;
      cross_app_memory_requires_explicit_grant: boolean;
      automatic_changes: boolean;
    };
    expect(insights.analyzed_records).toBeGreaterThanOrEqual(2);
    expect(insights.inference_calls).toBe(0);
    expect(insights.cross_app_memory_requires_explicit_grant).toBe(true);
    expect(insights.automatic_changes).toBe(false);

    const profileResponse = await ownerRequest("/v1/owner/profile");
    expect(profileResponse.status).toBe(200);
    const profile = await profileResponse.json() as {
      profile: Record<string, Array<{ memory_key: string }>>;
      recurring_preferences: Array<{ term: string; memory_ids: string[] }>;
      review_suggestions: Array<{ requires_owner_confirmation: boolean }>;
      inference_calls: number;
      automatic_changes: boolean;
      cross_app_memory_requires_explicit_grant: boolean;
    };
    expect(profile.profile.preferences.length + profile.profile.communication.length + profile.profile.other.length).toBeGreaterThan(0);
    expect(profile.inference_calls).toBe(0);
    expect(profile.automatic_changes).toBe(false);
    expect(profile.cross_app_memory_requires_explicit_grant).toBe(true);
    expect(profile.review_suggestions.every((item) => item.requires_owner_confirmation)).toBe(true);

    const sharedSearch = await ownerRequest("/v1/owner/memory/retrieve", "POST", {
      query: "memória central explícita", limit: 10,
    });
    expect(sharedSearch.status).toBe(200);
    const sharedSearchBody = await sharedSearch.json() as {
      memories: Array<{ memory_id: string; scope: string }>;
    };
    expect(sharedSearchBody.memories.some((memory) => memory.scope === "owner")).toBe(true);

    expect(ownerList.status).toBe(200);

    const deleted = await ownerRequest("/v1/owner/memory?scope=app", "DELETE", {
      memory_id: savedBody.memory_id,
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await afterDelete.json() as { memories: unknown[] }).memories).toHaveLength(0);
    const historyResponse = await ownerRequest("/v1/owner/memory/history?scope=app&limit=50");
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as {
      events: Array<{ action: string; memory_key: string; actor_app_id: string }>;
      values_stored: boolean;
    };
    expect(history.values_stored).toBe(false);
    expect(history.events.some((event) => event.action === "created" && event.memory_key === "response_style")).toBe(true);
    expect(history.events.some((event) => event.action === "updated" && event.memory_key === "response_style")).toBe(true);
    expect(history.events.some((event) => event.action === "deleted" && event.memory_key === "response_style")).toBe(true);
    expect(history.events.every((event) => event.actor_app_id === memoryApp)).toBe(true);

  });
});

describe("CibaGenio administrative resource controls", () => {
  it("requires admin authentication and persists global/app resource switches with an audit trail", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.batch([
      db.prepare("DELETE FROM cibagenio_controls"),
      db.prepare("DELETE FROM cibagenio_audit_events"),
    ]);
    const unauthorized = await request("/v1/admin/cibagenio");
    expect(unauthorized.status).toBe(401);

    const initial = await adminRequest("/v1/admin/cibagenio", "GET");
    expect(initial.status).toBe(200);
    const initialBody = await initial.json() as {
      command: string;
      default_state: string;
      resources: Array<{ id: string }>;
      controls: unknown[];
    };
    expect(initialBody.command).toBe("CibaGenio");
    expect(initialBody.default_state).toBe("locked");
    expect(initialBody.resources.map((resource) => resource.id)).toContain("chat");
    expect(initialBody.controls).toEqual([]);

    const unlock = await adminRequest("/v1/admin/cibagenio", "POST", {
      resource_id: "chat",
      enabled: true,
      reason: "Liberação inicial controlada",
    });
    expect(unlock.status).toBe(200);
    expect(await unlock.json()).toMatchObject({
      command: "CibaGenio",
      saved: true,
      resource_id: "chat",
      enabled: true,
      state: "unlocked",
      scope: "global",
    });

    const appLock = await adminRequest("/v1/admin/cibagenio", "POST", {
      resource_id: "chat",
      enabled: false,
      scope: "app",
      app_id: "com.ciba.integration",
      reason: "Bloqueio apenas neste aplicativo",
    });
    expect(appLock.status).toBe(200);
    expect(await appLock.json()).toMatchObject({
      resource_id: "chat",
      enabled: false,
      state: "locked",
      scope: "app",
      app_id: "com.ciba.integration",
    });

    const invalid = await adminRequest("/v1/admin/cibagenio", "POST", {
      resource_id: "run_shell",
      enabled: true,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "unknown_resource" });

    const current = await adminRequest("/v1/admin/cibagenio", "GET");
    const currentBody = await current.json() as {
      controls: Array<{ resource_id: string; scope: string; scope_id: string; enabled: boolean }>;
      recent_changes: Array<{ resource_id: string }>;
    };
    expect(currentBody.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_id: "chat", scope: "global", scope_id: "", enabled: true }),
      expect.objectContaining({ resource_id: "chat", scope: "app", scope_id: "com.ciba.integration", enabled: false }),
    ]));
    expect(currentBody.recent_changes.filter((event) => event.resource_id === "chat")).toHaveLength(2);
  });
});



describe("Ciba AI authenticated durable tool approvals", () => {
  const approvalRequest = {
    conversationId: "approval-conversation",
    invocationId: "approval-invocation",
    toolId: "profile.update",
    risk: "write" as const,
    input: { display_name: "Fábio" },
  };

  const createPairedOwnerDevices = async () => {
    const app = await adminRequest("/v1/admin/apps", "POST", {
      app_id: appId, display_name: "Ciba Approval Integration", enabled: true,
    });
    expect(app.status).toBe(200);
    const source = await registerDevice(await createInvitation());
    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: appId });
    expect(ownerResponse.status).toBe(201);
    const owner = await ownerResponse.json() as { owner_id: string; pairing_invitation_code: string };
    const pair = async (device: { access_token: string }, code: string) => request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${device.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: code }),
    });
    expect((await pair(source, owner.pairing_invitation_code)).status).toBe(200);

    const second = await registerDevice(await createInvitation());
    const invitation = await adminRequest("/v1/admin/owner-invitations", "POST", {
      owner_id: owner.owner_id, app_id: appId,
    });
    expect(invitation.status).toBe(201);
    const code = (await invitation.json() as { pairing_invitation_code: string }).pairing_invitation_code;
    expect((await pair(second, code)).status).toBe(200);
    return { source, second, owner };
  };

  it("lists requests only to paired owner devices and accepts a one-time decision from a paired device", async () => {
    const { source, second, owner } = await createPairedOwnerDevices();
    const db = (env as unknown as { DB: D1Database }).DB;
    const store = createD1ToolApprovalStore(db);
    const saved = await store.request({
      ownerId: owner.owner_id, appId, deviceId: source.device_id,
    }, approvalRequest);

    const unauthenticated = await request("/v1/owner/tool-approvals");
    expect(unauthenticated.status).toBe(401);

    const list = await request("/v1/owner/tool-approvals", {
      headers: { authorization: `Bearer ${second.access_token}` },
    });
    expect(list.status).toBe(200);
    const body = await list.json() as { approvals: Array<Record<string, unknown>>; count: number };
    expect(body.count).toBe(1);
    expect(body.approvals[0]).toMatchObject({
      approval_id: saved.approvalId,
      source_device_id: source.device_id,
      tool_id: "profile.update",
      risk: "write",
      input: { display_name: "Fábio" },
      status: "pending",
    });
    expect(body.approvals[0]).not.toHaveProperty("input_sha256");

    const invalidDecision = await request(`/v1/owner/tool-approvals/${saved.approvalId}/decision`, {
      method: "POST",
      headers: { authorization: `Bearer ${second.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ allow: true, owner_id: "attacker-controlled" }),
    });
    expect(invalidDecision.status).toBe(400);

    const decision = await request(`/v1/owner/tool-approvals/${saved.approvalId}/decision`, {
      method: "POST",
      headers: { authorization: `Bearer ${second.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ allow: true }),
    });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({
      decided: true, approval_id: saved.approvalId, decision: "approved",
      approved_by_device_id: second.device_id,
    });

    const approvedInbox = await request("/v1/owner/tool-approvals", {
      headers: { authorization: `Bearer ${second.access_token}` },
    });
    const approvedItems = await approvedInbox.json() as { approvals: Array<{ approval_id: string; status: string }> };
    expect(approvedItems.approvals).toContainEqual(expect.objectContaining({
      approval_id: saved.approvalId, status: "approved",
    }));

    expect(await store.consume({
      approvalId: saved.approvalId,
      identity: { ownerId: owner.owner_id, appId, deviceId: source.device_id },
      request: approvalRequest,
    })).toBe(true);
    expect(await store.consume({
      approvalId: saved.approvalId,
      identity: { ownerId: owner.owner_id, appId, deviceId: source.device_id },
      request: approvalRequest,
    })).toBe(false);

    const replay = await request(`/v1/owner/tool-approvals/${saved.approvalId}/decision`, {
      method: "POST",
      headers: { authorization: `Bearer ${second.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ allow: false }),
    });
    expect(replay.status).toBe(404);
  });

  it("keeps approvals isolated by owner and allows only the originating device to cancel", async () => {
    const { source, second, owner } = await createPairedOwnerDevices();
    const db = (env as unknown as { DB: D1Database }).DB;
    const store = createD1ToolApprovalStore(db);
    const saved = await store.request({
      ownerId: owner.owner_id, appId, deviceId: source.device_id,
    }, { ...approvalRequest, invocationId: "approval-cancel-invocation" });

    const otherOwnerDevice = await registerDevice(await createInvitation());
    const otherOwnerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: appId });
    const otherOwner = await otherOwnerResponse.json() as { pairing_invitation_code: string };
    const pairedOther = await request("/v1/owner/pair", {
      method: "POST",
      headers: { authorization: `Bearer ${otherOwnerDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ pairing_invitation_code: otherOwner.pairing_invitation_code }),
    });
    expect(pairedOther.status).toBe(200);

    const isolated = await request("/v1/owner/tool-approvals", {
      headers: { authorization: `Bearer ${otherOwnerDevice.access_token}` },
    });
    expect((await isolated.json() as { approvals: unknown[] }).approvals).toHaveLength(0);

    const wrongDeviceCancel = await request(`/v1/owner/tool-approvals/${saved.approvalId}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${second.access_token}` },
    });
    expect(wrongDeviceCancel.status).toBe(404);

    const cancel = await request(`/v1/owner/tool-approvals/${saved.approvalId}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${source.access_token}` },
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ cancelled: true, approval_id: saved.approvalId });
  });

  it("does not expose approvals to unpaired devices", async () => {
    const device = await registerDevice(await createInvitation());
    const response = await request("/v1/owner/tool-approvals", {
      headers: { authorization: `Bearer ${device.access_token}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "active_owner_required" });
  });
});


describe("Composio discovery endpoint security", () => {
  it("rejects Composio tool discovery without an authenticated Garcia device", async () => {
    const response = await request("/v1/owner/composio/tools");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });

    const policy = await request("/v1/owner/composio/policy");
    expect(policy.status).toBe(401);
    expect(await policy.json()).toEqual({ error: "unauthorized" });

    const invoke = await request("/v1/owner/composio/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        tool_name: "GMAIL_SEND_EMAIL",
        conversation_id: "conversation-1",
        invocation_id: "invocation-1",
        input: {},
      }),
    });
    expect(invoke.status).toBe(401);
    expect(await invoke.json()).toEqual({ error: "unauthorized" });
  });
});

describe("Garcia MCP endpoint security", () => {
  it("rejects MCP requests without an authenticated device token", async () => {
    const response = await request("/v1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "integration-test", version: "1.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
