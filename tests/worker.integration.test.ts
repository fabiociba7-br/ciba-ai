import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { describe, expect, it } from "vitest";

const worker = {
  fetch: (request: Request) => workerModule.fetch(
    request,
    env as unknown as Env,
  ),
};
const adminToken = "integration-test-admin-token-0123456789abcdef";
const appId = "com.ciba.integration";

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
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain("localStorage");
  });

  it("registers devices, consumes invitations once, revokes access and enforces daily quota", async () => {
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

    const settingsResponse = await adminRequest("/v1/admin/settings", "POST", {
      settings: { daily_device_limit: 1 },
    });
    expect(settingsResponse.status).toBe(200);

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

    const chat = () => request("/v1/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondDevice.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Olá" }] }),
    });

    const firstChat = await chat();
    expect(firstChat.status).toBe(503);
    expect(await firstChat.json()).toEqual({ error: "ai_model_not_available" });

    const overQuotaChat = await chat();
    expect(overQuotaChat.status).toBe(429);
    const quotaBody = await overQuotaChat.json() as { error: string; retry_after_seconds: number };
    expect(quotaBody.error).toBe("daily_quota_exceeded");
    expect(quotaBody.retry_after_seconds).toBeGreaterThan(0);
    expect(overQuotaChat.headers.get("retry-after")).toBe(String(quotaBody.retry_after_seconds));

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


describe("Ciba AI administrative safety ceilings", () => {
  it("rejects runtime limits that exceed the zero-cost safety ceilings", async () => {
    const globalLimit = await adminRequest("/v1/admin/settings", "POST", {
      settings: { daily_global_limit: 51 },
    });
    expect(globalLimit.status).toBe(400);
    expect(await globalLimit.json()).toEqual({
      error: "setting_exceeds_safety_ceiling",
      key: "daily_global_limit",
      maximum: 50,
    });

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

    const dispatched = await request("/v1/apps/tasks/dispatch", {
      method: "POST",
      headers: { authorization: `Bearer ${sourceDevice.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        task_type: "summarize",
        instruction: "Resuma os pontos principais do texto.",
        client_message_id: "coordinator-task-001",
        context: { source: "integration-test" },
      }),
    });
    expect(dispatched.status).toBe(201);
    const dispatchBody = await dispatched.json() as {
      dispatched: boolean;
      route: { task_id: string; destination_app_id: string; destination_display_name: string; task_type: string };
    };
    expect(dispatchBody.dispatched).toBe(true);
    expect(dispatchBody.route).toMatchObject({
      destination_app_id: targetApp, destination_display_name: "Relay Target", task_type: "summarize",
    });
    const taskInbox = await inbox();
    const taskInboxBody = await taskInbox.json() as {
      messages: Array<{ message_id: string; task_id: string; payload: { protocol: string; task_type: string; instruction: string; context: { source: string } } }>;
    };
    expect(taskInboxBody.messages).toHaveLength(1);
    expect(taskInboxBody.messages[0]).toMatchObject({
      task_id: dispatchBody.route.task_id,
      payload: {
        protocol: "garcia.task.request",
        task_type: "summarize",
        instruction: "Resuma os pontos principais do texto.",
        context: { source: "integration-test" },
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
    expect(await taskResults.json()).toMatchObject({
      task_id: dispatchBody.route.task_id,
      count: 1,
      results: [expect.objectContaining({
        source_app_id: targetApp,
        payload: {
          protocol: "garcia.task.result",
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
    const enabled = await ownerRequest("/v1/owner/settings", "POST", {
      settings: { memory_enabled: true },
    });
    expect(enabled.status).toBe(200);

    const saved = await ownerRequest("/v1/owner/memory?scope=app", "POST", {
      key: "response_style", value: "Prefere respostas diretas.", consent: "curated",
    });
    expect(saved.status).toBe(201);
    const savedBody = await saved.json() as { memory_id: string };
    const listed = await ownerRequest("/v1/owner/memory?scope=app");
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { memories: Array<{ memory_id: string; value: string }> };
    expect(listBody.memories).toHaveLength(1);
    expect(listBody.memories[0].memory_id).toBe(savedBody.memory_id);

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
    expect(ownerList.status).toBe(200);

    const deleted = await ownerRequest("/v1/owner/memory?scope=app", "DELETE", {
      memory_id: savedBody.memory_id,
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await ownerRequest("/v1/owner/memory?scope=app");
    expect((await afterDelete.json() as { memories: unknown[] }).memories).toHaveLength(0);
  });
});

