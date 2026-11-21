import { describe, expect, it, vi } from "vitest";
import {
  handleAppIdentity,
  handleConnectOwnerApp,
  handleOwnerAvailableApps,
  type OwnerAppsEnv,
} from "../src/http/owner-apps";

const token = "device-token-0123456789-abcdefghijklmnop";
const ownerId = "owner-123";
const device = {
  device_id: "device-123",
  app_id: "com.ciba.garcia",
  owner_id: ownerId,
};

const app = {
  app_id: "com.ciba.garcia",
  display_name: "Garcia",
  enabled: 1,
  description: "Assistente pessoal",
  app_type: "assistant",
  capabilities_json: '["assistant","notes","unknown"]',
  task_types_json: '["research","summarize","unknown"]',
  contract_version: "1.0.0",
};

const createEnv = (options: {
  device?: typeof device | null;
  owner?: { owner_id: string } | null;
  app?: typeof app | null;
  appAllowed?: number | null;
  availableApps?: Array<{ app_id: string; display_name: string }>;
  connectedApps?: Array<Record<string, unknown>>;
  batchChanges?: [number, number];
} = {}) => {
  const prepared: Array<{ sql: string; values: unknown[] }> = [];
  const batches: unknown[][] = [];
  const prepare = vi.fn((sql: string) => {
    const query = {
      values: [] as unknown[],
      bind: vi.fn((...values: unknown[]) => {
        query.values = values;
        prepared.push({ sql, values });
        return query;
      }),
      first: vi.fn(async () => {
        if (sql.includes("FROM devices")) return options.device === undefined ? device : options.device;
        if (sql.includes("FROM owners")) return options.owner === undefined ? { owner_id: ownerId } : options.owner;
        if (sql === "SELECT enabled FROM app_registry WHERE app_id = ?") {
          return options.appAllowed === undefined ? { enabled: 1 } :
            options.appAllowed === null ? null : { enabled: options.appAllowed };
        }
        if (sql.includes("FROM app_registry") && sql.includes("AND enabled = 1")) {
          return options.app === undefined ? { app_id: "com.example.notes" } : options.app;
        }
        if (sql.includes("FROM app_registry")) return options.app === undefined ? app : options.app;
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes("SELECT app_id, display_name FROM app_registry")) {
          return { results: options.availableApps ?? [
            { app_id: "com.example.notes", display_name: "Notes" },
            { app_id: "invalid app id", display_name: "Invalid" },
          ] };
        }
        if (sql.includes("FROM devices d") && sql.includes("active_device_count")) {
          return { results: options.connectedApps ?? [{
            app_id: app.app_id,
            display_name: app.display_name,
            description: app.description,
            app_type: app.app_type,
            capabilities_json: app.capabilities_json,
            task_types_json: app.task_types_json,
            contract_version: app.contract_version,
            active_device_count: 1,
          }] };
        }
        return { results: [] };
      }),
    };
    return query;
  });
  const env = {
    DB: {
      prepare,
      batch: vi.fn(async (statements: unknown[]) => {
        batches.push(statements);
        const changes = options.batchChanges ?? [1, 1];
        return changes.map((count) => ({ meta: { changes: count } }));
      }),
    } as unknown as D1Database,
    ALLOWED_APP_IDS: "",
  } satisfies OwnerAppsEnv;
  return { env, prepare, prepared, batches };
};

const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`https://garcia.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("owner app handlers", () => {
  it("rejects unauthenticated app-list requests before querying the database", async () => {
    const { env, prepare } = createEnv();
    const response = await handleOwnerAvailableApps(
      new Request("https://garcia.test/v1/owner/apps"),
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires an active owner and filters malformed app identifiers", async () => {
    const { env } = createEnv();
    const response = await handleOwnerAvailableApps(
      request("/v1/owner/apps"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      apps: [{ app_id: "com.example.notes", display_name: "Notes" }],
    });
  });

  it("creates registration and pairing invitations only for an allowed, enabled app", async () => {
    const { env, batches } = createEnv();
    const response = await handleConnectOwnerApp(
      request("/v1/owner/apps/connect", "POST", { app_id: "com.example.notes" }),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.app_id).toBe("com.example.notes");
    expect(typeof body.registration_invitation_code).toBe("string");
    expect((body.registration_invitation_code as string).length).toBeGreaterThanOrEqual(32);
    expect(typeof body.pairing_invitation_code).toBe("string");
    expect((body.pairing_invitation_code as string).length).toBeGreaterThanOrEqual(32);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("rejects apps disabled in the registry even if otherwise requested", async () => {
    const { env, batches } = createEnv({ appAllowed: 0 });
    const response = await handleConnectOwnerApp(
      request("/v1/owner/apps/connect", "POST", { app_id: "com.example.notes" }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "app_not_allowed" });
    expect(batches).toHaveLength(0);
  });

  it("returns sanitized app identity and descriptive-only connected capabilities", async () => {
    const { env } = createEnv();
    const response = await handleAppIdentity(
      request("/v1/apps/identity"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contract: "garcia-app",
      contract_version: "1.0.0",
      identity: {
        app_id: "com.ciba.garcia",
        enabled: true,
        capabilities: ["assistant", "notes"],
        task_types: ["research", "summarize"],
      },
      device: { device_id: "device-123", owner_linked: true },
      connected_apps: [{
        app_id: "com.ciba.garcia",
        capabilities: ["assistant", "notes"],
        task_types: ["research", "summarize"],
      }],
      capability_semantics: {
        descriptive_only: true,
        grants_required_for_cross_app_access: true,
        app_actions_executable_by_garcia: false,
      },
    });
  });

  it("does not create invitations when an app is not available", async () => {
    const { env, batches } = createEnv({ app: null });
    const response = await handleConnectOwnerApp(
      request("/v1/owner/apps/connect", "POST", { app_id: "com.example.notes" }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "app_not_available" });
    expect(batches).toHaveLength(0);
  });
});
