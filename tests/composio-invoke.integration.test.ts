import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { hashComposioToolSchema } from "../src/core/composio/policy";
import { createD1ToolApprovalStore } from "../src/core/tools/durable-consent";
import { createComposioChatToolDefinitions } from "../src/core/composio/chat-tools";
import { createGarciaCapabilityToolRuntime } from "../src/core/tools/garcia-capability-tools";
import { runCibaOrchestrator } from "../src/core/orchestrator";
import { CIBA_TOOL_PROPOSAL_PREFIX } from "../src/core/tools/model-proposal";
import type { InferenceRequest, InferenceResult, ModelProvider } from "../src/core/types";
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
let previousExternalToolsControl: { enabled: number; reason: string | null; updated_by: string; updated_at: string } | null = null;

const workerEnv = {
  ...env,
  COMPOSIO_API_KEY: apiKey,
  // Explicitly enabled only inside this mocked integration-test environment.
  COMPOSIO_EXECUTION_ENABLED: "true",
} as Env;
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

function installComposioMock(
  remoteSchema: Record<string, unknown> = schema,
  calls: string[] = [],
) {
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
  previousExternalToolsControl = await db.prepare(
    "SELECT enabled, reason, updated_by, updated_at FROM cibagenio_controls WHERE resource_id = 'external_tools' AND scope = 'global' AND scope_id = ''"
  ).first<{ enabled: number; reason: string | null; updated_by: string; updated_at: string }>();
  await db.prepare("INSERT INTO cibagenio_controls(resource_id, scope, scope_id, enabled, reason, updated_by, updated_at) VALUES('external_tools', 'global', '', 1, 'Composio integration test', 'test', ?) ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET enabled = 1, reason = excluded.reason, updated_by = 'test', updated_at = excluded.updated_at")
    .bind(new Date().toISOString()).run();
  await setupOwner();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  try {
    for (const id of ownerIds.splice(0)) {
      await db.prepare("DELETE FROM tool_approvals WHERE owner_id = ?").bind(id).run();
      await db.prepare("DELETE FROM owner_composio_tool_policies WHERE owner_id = ?").bind(id).run();
      await db.prepare("DELETE FROM owner_composio_sessions WHERE owner_id = ?").bind(id).run();
      await db.prepare("DELETE FROM owner_pairing_invitations WHERE owner_id = ?").bind(id).run();
      await db.prepare("DELETE FROM devices WHERE owner_id = ?").bind(id).run();
      await db.prepare("DELETE FROM owners WHERE owner_id = ?").bind(id).run();
    }
  } finally {
    if (previousExternalToolsControl) {
      await db.prepare("UPDATE cibagenio_controls SET enabled = ?, reason = ?, updated_by = ?, updated_at = ? WHERE resource_id = 'external_tools' AND scope = 'global' AND scope_id = ''")
        .bind(previousExternalToolsControl.enabled, previousExternalToolsControl.reason, previousExternalToolsControl.updated_by, previousExternalToolsControl.updated_at).run();
    } else {
      await db.prepare("DELETE FROM cibagenio_controls WHERE resource_id = 'external_tools' AND scope = 'global' AND scope_id = ''").run();
    }
  }
});

describe("owner Composio invocation approval boundary", () => {
  it("blocks remote execution server-side when the feature flag is disabled", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-execution-disabled",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Must remain blocked",
        body: "No remote execution",
      },
    };
    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    expect(proposed.status).toBe(202);
    const proposal = await proposed.json() as { approval_id: string };
    const approved = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: true,
    });
    expect(approved.status).toBe(200);

    const previousFlag = workerEnv.COMPOSIO_EXECUTION_ENABLED;
    workerEnv.COMPOSIO_EXECUTION_ENABLED = "false";
    try {
      const executed = await ownerRequest({
        ...invocation, action: "execute", approval_id: proposal.approval_id,
      });
      expect(executed.status).toBe(403);
      expect(await executed.json()).toMatchObject({ error: "composio_execution_disabled" });
      expect(calls).toEqual([]);
    } finally {
      workerEnv.COMPOSIO_EXECUTION_ENABLED = previousFlag;
    }
  });

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

  it("does not let an approval authorize modified arguments", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-approval-input-binding",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Original subject",
        body: "Original body",
      },
    };
    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    expect(proposed.status).toBe(202);
    const proposal = await proposed.json() as { approval_id: string };
    const approved = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: true,
    });
    expect(approved.status).toBe(200);

    const tampered = await ownerRequest({
      ...invocation,
      action: "execute",
      approval_id: proposal.approval_id,
      input: { ...invocation.input, to: "attacker@example.com" },
    });
    expect(tampered.status).toBe(403);
    expect(calls).toEqual([]);

    const original = await ownerRequest({
      ...invocation, action: "execute", approval_id: proposal.approval_id,
    });
    expect(original.status).toBe(200);
    expect(calls).toEqual([toolName]);
  });

  it("does not execute a denied approval", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-denied-approval",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Denied",
        body: "Must not be sent",
      },
    };
    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    expect(proposed.status).toBe(202);
    const proposal = await proposed.json() as { approval_id: string };
    const denied = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: false,
    });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toMatchObject({ approved: false });

    const executed = await ownerRequest({
      ...invocation, action: "execute", approval_id: proposal.approval_id,
    });
    expect(executed.status).toBe(403);
    expect(calls).toEqual([]);
  });


  it("invalidates an approved action when its local tool consent is revoked", async () => {
    const calls = installComposioMock();
    const invocation = {
      tool_name: toolName,
      conversation_id: "conversation-revoked-tool-consent",
      invocation_id: crypto.randomUUID(),
      input: {
        to: "recipient@example.com",
        subject: "Consent revoked",
        body: "Must not be sent",
      },
    };
    const proposed = await ownerRequest({ ...invocation, action: "propose" });
    expect(proposed.status).toBe(202);
    const proposal = await proposed.json() as { approval_id: string };
    const approved = await ownerRequest({
      ...invocation, action: "approve", approval_id: proposal.approval_id, allow: true,
    });
    expect(approved.status).toBe(200);
    expect(calls).toEqual([]);

    const previousPolicy = await db.prepare(
      "SELECT enabled FROM owner_composio_tool_policies WHERE owner_id = ? AND tool_name = ?"
    ).bind(ownerId, toolName).first<{ enabled: number }>();
    expect(previousPolicy).not.toBeNull();

    await db.prepare(
      "UPDATE owner_composio_tool_policies SET enabled = 0 WHERE owner_id = ? AND tool_name = ?"
    ).bind(ownerId, toolName).run();

    const previousFlag = workerEnv.COMPOSIO_EXECUTION_ENABLED;
    workerEnv.COMPOSIO_EXECUTION_ENABLED = "true";
    try {
      const executed = await ownerRequest({
        ...invocation, action: "execute", approval_id: proposal.approval_id,
      });
      expect(executed.status).toBe(403);
      expect(await executed.json()).toMatchObject({ error: "composio_tool_not_enabled" });
      expect(calls).toEqual([]);
    } finally {
      workerEnv.COMPOSIO_EXECUTION_ENABLED = previousFlag;
      await db.prepare(
        "UPDATE owner_composio_tool_policies SET enabled = ? WHERE owner_id = ? AND tool_name = ?"
      ).bind(previousPolicy!.enabled, ownerId, toolName).run();
    }
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
    installComposioMock(changedSchema, calls);
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

  it("bridges a chat-created durable approval into the owner approval endpoint without executing remotely", async () => {
    const calls = installComposioMock();
    const device = await db.prepare(
      "SELECT device_id FROM devices WHERE owner_id = ? AND revoked_at IS NULL LIMIT 1"
    ).bind(ownerId).first<{ device_id: string }>();
    expect(device?.device_id).toBeTruthy();

    const input = {
      to: "recipient@example.com",
      subject: "Chat approval bridge",
      body: "Must remain unexecuted",
    };
    const chatTools = await createComposioChatToolDefinitions({
      remoteTools: [{
        name: toolName,
        description: "Send an email",
        inputSchema: schema,
        annotations: { destructiveHint: true },
      }],
      enabledToolkits: ["gmail"],
      savedPolicies: [{
        tool_name: toolName,
        toolkit: "gmail",
        risk: "write",
        requires_approval: 1,
        schema_sha256: await hashComposioToolSchema(schema),
        enabled: 1,
      }],
      callTool: async (name) => {
        calls.push(name);
        return { content: [{ type: "text", text: "unexpected" }], isError: false };
      },
    });
    const conversationId = "conversation-chat-approval-bridge";
    const invocationId = crypto.randomUUID();
    const runtime = createGarciaCapabilityToolRuntime({
      authorize: async () => true,
      context: { conversationId, invocationId },
      additionalTools: chatTools,
      approval: {
        store: createD1ToolApprovalStore(db),
        identity: { ownerId, appId, deviceId: device!.device_id },
      },
    });
    const proposalText = CIBA_TOOL_PROPOSAL_PREFIX + JSON.stringify({
      protocol: "ciba.tool.proposal.v1",
      toolId: "composio.gmail_send_email",
      input,
    });
    const provider: ModelProvider = {
      id: "test-provider",
      enabled: true,
      generate: async (_request: InferenceRequest): Promise<InferenceResult> => ({
        text: proposalText,
        raw: null,
        provider: "test-provider",
        model: "test-model",
      }),
    };
    const chatResult = await runCibaOrchestrator({
      messages: [{ role: "user", content: "Envie este e-mail." }],
      model: "test-model",
      maxOutputTokens: 128,
      provider,
      toolRuntime: runtime,
    });

    expect(chatResult.toolProposal).toMatchObject({
      toolId: "composio.gmail_send_email",
      risk: "write",
      requiresApproval: true,
      input,
      conversationId,
      invocationId,
    });
    expect(chatResult.toolApproval).toMatchObject({ status: "approval_required" });
    const approvalId = chatResult.toolApproval?.approvalId;
    expect(approvalId).toBeTruthy();
    expect(calls).toEqual([]);

    const invocation = {
      tool_name: toolName,
      conversation_id: conversationId,
      invocation_id: invocationId,
      input,
    };
    const approved = await ownerRequest({
      ...invocation,
      action: "approve",
      approval_id: approvalId,
      allow: true,
    });
    expect(approved.status, JSON.stringify(await approved.clone().json())).toBe(200);
    expect(await approved.json()).toMatchObject({ approved: true, approval_id: approvalId });
    expect(calls).toEqual([]);

    const previousFlag = workerEnv.COMPOSIO_EXECUTION_ENABLED;
    workerEnv.COMPOSIO_EXECUTION_ENABLED = "false";
    try {
      const executed = await ownerRequest({
        ...invocation,
        action: "execute",
        approval_id: approvalId,
      });
      expect(executed.status).toBe(403);
      expect(await executed.json()).toMatchObject({ error: "composio_execution_disabled" });
      expect(calls).toEqual([]);
    } finally {
      workerEnv.COMPOSIO_EXECUTION_ENABLED = previousFlag;
    }
  });

});
