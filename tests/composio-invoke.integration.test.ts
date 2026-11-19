import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { hashComposioToolSchema } from "../src/core/composio/policy";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const adminToken = "integration-test-admin-token-0123456789abcdef";
const appId = "com.ciba.garcia";
const sessionId = "trs_1234567890abcdef";
const apiKey = "composio-integration-test-api-key";
const toolName = "GMAIL_SEND_EMAIL";
const schema = {
  type: "object",
  properties: {
    to: { type: "string", minLength: 3, maxLength: 200 },
    subject: { type: "string", maxLength: 200 },
    body: { type: "string", maxLength: 4_000 },
  },
  required: ["to", "subject", "body"],
  additionalProperties: false,
};

const db = (env as unknown as { DB: D1Database }).DB;
const ownerIds: string[] = [];
let accessToken = "";
let ownerId = "";

const workerEnv = { ...env, COMPOSIO_API_KEY: apiKey } as Env;
const request = (path: string, init: RequestInit = {}) => workerModule.fetch(
  new Request("https://ciba-ai.test" + path, init),
  workerEnv,
);
const adminRequest = (path: string, method: string, body?: unknown) => request(path, {
  method,
  headers: { authorization: "Bearer " + adminToken, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function setupOwner() {
  await adminRequest("/v1/admin/apps", "POST", {
    app_id: appId, display_name: "Garcia", enabled: true,
  });
  const invitation = await adminRequest("/v1/admin/invitations", "POST", {
    app_id: appId, valid_hours: 1,
  });
  expect(invitation.status).toBe(201);
  const invitationCode = (await invitation.json() as { invitation_code: string }).invitation_code;
  const registered = await request("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, invitation_code: invitationCode }),
  });
  expect(registered.status).toBe(201);
  const device = await registered.json() as { access_token: string };
  accessToken = device.access_token;

  const created = await adminRequest("/v1/admin/owners", "POST", { app_id: appId });
  expect(created.status).toBe(201);
  const owner = await created.json() as { owner_id: string; pairing_invitation_code: string };
  ownerId = owner.owner_id;
  ownerIds.push(ownerId);
  const paired = await request("/v1/owner/pair", {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ pairing_invitation_code: owner.pairing_invitation_code }),
  });
  expect(paired.status).toBe(200);

  const schemaSha256 = await hashComposioToolSchema(schema);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO owner_composio_sessions(owner_id, session_id, toolkits_json, status, created_at, updated_at) VALUES(?, ?, '[\"gmail\"]', 'active', ?, ?)")
      .bind(ownerId, sessionId, now, now),
    db.prepare("INSERT INTO owner_composio_tool_policies(owner_id, tool_name, toolkit, risk, requires_approval, schema_sha256, description, enabled, consented_at, updated_at) VALUES(?, ?, 'gmail', 'write', 1, ?, 'Send email', 1, ?, ?)")
      .bind(ownerId, toolName, schemaSha256, now, now),
  ]);
}

function installComposioMock(remoteSchema: Record<string, unknown> = schema) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://backend.composio.dev/api/v3.1/tool_router/session/" + sessionId + "/attach") {
      return Response.json({
        session_id: sessionId,
        mcp: { url: "https://app.composio.dev/tool_router/v3/" + sessionId + "/mcp" },
      });
    }
    if (url !== "https://app.composio.dev/tool_router/v3/" + sessionId + "/mcp") {
      throw new Error("unexpected_composio_test_url");
    }
    const body = JSON.parse(String(init?.body || "{}")) as {
      id?: string; method?: string; params?: { name?: string };
    };
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0", id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "composio-test", version: "1" },
        },
      });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0", id: body.id,
        result: { tools: [{
          name: toolName,
          description: "Send an email",
          inputSchema: remoteSchema,
          annotations: { destructiveHint: true },
        }] },
      });
    }
    if (body.method === "tools/call") {
      calls.push(body.params?.name || "");
      return Response.json({
        jsonrpc: "2.0", id: body.id,
        result: { content: [{ type: "text", text: "mocked" }], isError: false },
      });
    }
    throw new Error("unexpected_composio_test_method");
  }) as typeof fetch);
  return calls;
}

const ownerRequest = (body: Record<string, unknown>) => request("/v1/owner/composio/invoke", {
  method: "POST",
  headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  await db.prepare("INSERT INTO cibagenio_controls(resource_id, scope, scope_id, enabled, reason, updated_by, updated_at) VALUES('external_tools', 'global', '', 1, 'Composio integration test', 'test', ?) ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET enabled = 1, reason = excluded.reason, updated_by = 'test', updated_at = excluded.updated_at")
    .bind(new Date().toISOString()).run();
  await setupOwner();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("owner Composio invocation approval boundary", () => {
  it("does not call the remote tool until explicit approval and one-shot execution", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-composio-test",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Test",
        body: "Mock execution only",
      },
    };

    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    expect(proposed.status).toBe(202);
    const proposal = await proposed.json() as { approval_id: string; execution_enabled: boolean };
    expect(proposal.execution_enabled).toBe(false);
    expect(calls).toEqual([]);

    const approved = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: true,
    });
    expect(approved.status).toBe(200);
    expect(calls).toEqual([]);

    const executed = await ownerRequest({
      ...invocation, action: "execute", approval_id: proposal.approval_id,
    });
    expect(executed.status, JSON.stringify(await executed.clone().json())).toBe(200);
    expect(calls).toEqual([toolName]);

    const replay = await ownerRequest({
      ...invocation, action: "execute", approval_id: proposal.approval_id,
    });
    expect(replay.status).toBe(403);
    expect(calls).toEqual([toolName]);
  });

  it("rejects schema drift before consuming approval or calling the remote tool", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-schema-drift",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Test",
        body: "Must not be sent",
      },
    };
    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    const proposal = await proposed.json() as { approval_id: string };
    const approved = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: true,
    });
    expect(approved.status).toBe(200);

    const changedSchema = {
      ...schema,
      properties: {
        ...schema.properties,
        body: { type: "string", maxLength: 2_000 },
      },
    };
    installComposioMock(changedSchema);
    const executed = await ownerRequest({
      ...invocation, action: "execute", approval_id: proposal.approval_id,
    });
    expect(executed.status).toBe(409);
    expect(await executed.json()).toMatchObject({
      error: "composio_tool_policy_changed",
      reauthorize: true,
    });
    expect(calls).toEqual([]);
    const approval = await db.prepare(
      "SELECT status FROM tool_approvals WHERE approval_id = ?"
    ).bind(proposal.approval_id).first<{ status: string }>();
    expect(approval?.status).toBe("approved");
  });
});
