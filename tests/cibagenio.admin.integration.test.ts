import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";

const worker = {
  fetch: (request: Request) => workerModule.fetch(request, env as unknown as Env),
};
const adminToken = "integration-test-admin-token-0123456789abcdef";
const appId = "com.ciba.cibagenio.admin";

const request = (method: string, body?: unknown, token?: string) =>
  worker.fetch(new Request("https://ciba-ai.test/v1/admin/cibagenio", {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.prepare(
    "DELETE FROM cibagenio_audit_events WHERE resource_id = 'external_tools'"
  ).run();
  await db.prepare(
    "DELETE FROM cibagenio_controls WHERE resource_id = 'external_tools'"
  ).run();
});

describe("CibaGenio administrative API", () => {
  it("requires admin authentication for reads and writes", async () => {
    const read = await request("GET");
    expect(read.status).toBe(401);
    expect(await read.json()).toEqual({ error: "unauthorized" });

    const write = await request("POST", {
      resource_id: "external_tools",
      enabled: true,
    });
    expect(write.status).toBe(401);
    expect(await write.json()).toEqual({ error: "unauthorized" });
  });

  it("does not accept credentials from query parameters or request bodies", async () => {
    const queryCredential = await worker.fetch(new Request(
      "https://ciba-ai.test/v1/admin/cibagenio?token=not-a-valid-token",
      { method: "GET" },
    ));
    expect(queryCredential.status).toBe(401);

    const bodyCredential = await request("POST", {
      resource_id: "external_tools",
      enabled: true,
      admin_token: "not-a-valid-token",
    });
    expect(bodyCredential.status).toBe(401);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await db.prepare(
      "SELECT resource_id FROM cibagenio_controls WHERE resource_id = 'external_tools' LIMIT 1"
    ).first();
    expect(row).toBeNull();
  });

  it("persists global and app-scoped commands and records audit events", async () => {
    const globalWrite = await request("POST", {
      resource_id: "external_tools",
      enabled: false,
      reason: "Bloqueado até revisão",
    }, adminToken);
    expect(globalWrite.status).toBe(200);
    expect(await globalWrite.json()).toMatchObject({
      command: "CibaGenio",
      saved: true,
      resource_id: "external_tools",
      enabled: false,
      state: "locked",
      scope: "global",
      app_id: null,
    });

    const appWrite = await request("POST", {
      resource_id: "external_tools",
      enabled: true,
      scope: "app",
      app_id: appId,
      reason: "Liberação controlada",
    }, adminToken);
    expect(appWrite.status).toBe(200);
    expect(await appWrite.json()).toMatchObject({
      saved: true,
      resource_id: "external_tools",
      enabled: true,
      state: "unlocked",
      scope: "app",
      app_id: appId,
    });

    const read = await request("GET", undefined, adminToken);
    expect(read.status).toBe(200);
    const body = await read.json() as {
      command: string;
      default_state: string;
      controls: Array<{ resource_id: string; scope: string; app_id: string | null; enabled: boolean; reason: string | null }>;
      recent_changes: Array<{ resource_id: string; scope: string; scope_id: string; enabled: number; actor: string }>;
    };
    expect(body.command).toBe("CibaGenio");
    expect(body.default_state).toBe("locked");
    expect(body.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resource_id: "external_tools",
        scope: "global",
        app_id: null,
        enabled: false,
        reason: "Bloqueado até revisão",
      }),
      expect.objectContaining({
        resource_id: "external_tools",
        scope: "app",
        app_id: appId,
        enabled: true,
        reason: "Liberação controlada",
      }),
    ]));
    expect(body.recent_changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_id: "external_tools", scope: "global", enabled: 0, actor: "admin" }),
      expect.objectContaining({ resource_id: "external_tools", scope: "app", scope_id: appId, enabled: 1, actor: "admin" }),
    ]));
  });

  it("rejects malformed commands without persisting controls", async () => {
    const response = await request("POST", {
      resource_id: "not_a_resource",
      enabled: true,
    }, adminToken);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown_resource" });

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await db.prepare(
      "SELECT resource_id FROM cibagenio_controls WHERE resource_id = 'external_tools' LIMIT 1"
    ).first();
    expect(row).toBeNull();
  });
});
