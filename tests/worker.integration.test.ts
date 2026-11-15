import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

type WorkerEntrypoint = {
  fetch(request: Request): Promise<Response>;
};

const worker = exports.default as WorkerEntrypoint;
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
    const ai = (env as unknown as {
      AI: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
    }).AI;
    const aiRun = vi.spyOn(ai, "run").mockResolvedValue({ response: "Resposta de teste" });

    const chat = () => request("/v1/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondDevice.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Olá" }] }),
    });

    const firstChat = await chat();
    expect(firstChat.status).toBe(200);
    expect((await firstChat.json() as { response: string }).response).toBe("Resposta de teste");

    const overQuotaChat = await chat();
    expect(overQuotaChat.status).toBe(429);
    expect(await overQuotaChat.json()).toEqual({ error: "daily_quota_exceeded" });
    expect(aiRun).toHaveBeenCalledTimes(1);
    aiRun.mockRestore();

    const status = await request("/v1/status");
    expect(status.status).toBe(200);
    expect((await status.json() as { database: string }).database).toBe("connected");
  });
});
