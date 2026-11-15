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

const registerDevice = async (invitationCode: string) => {
  const response = await request("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, invitation_code: invitationCode }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { device_id: string; access_token: string };
};

describe("Ciba AI Worker integration", () => {
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
    for (const [appId, displayName] of [[sourceApp, "Grant Source"], [targetApp, "Grant Target"]]) {
      const response = await adminRequest("/v1/admin/apps", "POST", {
        app_id: appId, display_name: displayName, enabled: true,
      });
      expect(response.status).toBe(200);
    }

    const invitationResponse = await adminRequest("/v1/admin/invitations", "POST", {
      app_id: sourceApp, valid_hours: 1,
    });
    expect(invitationResponse.status).toBe(201);
    const invitationCode = (await invitationResponse.json() as { invitation_code: string }).invitation_code;
    const device = await registerDevice(invitationCode);

    const ownerResponse = await adminRequest("/v1/admin/owners", "POST", { app_id: sourceApp });
    expect(ownerResponse.status).toBe(201);
    const ownerCode = (await ownerResponse.json() as { pairing_invitation_code: string }).pairing_invitation_code;
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
    const unpairedTarget = await registerDevice(targetCode);
    const denied = await request("/v1/owner/access-grants", {
      headers: { authorization: `Bearer ${unpairedTarget.access_token}` },
    });
    expect(denied.status).toBe(403);
  });
});
