import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { describe, expect, it } from "vitest";

const worker = {
  fetch: (request: Request) => workerModule.fetch(
    request,
    env as unknown as Env,
  ),
};
const adminToken = "integration-test-admin-token";
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
    expect(await overQuotaChat.json()).toEqual({ error: "daily_quota_exceeded" });

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
