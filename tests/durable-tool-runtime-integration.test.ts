import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1ToolApprovalStore } from "../src/core/tools/durable-consent";
import {
  createDurableCibaToolApprovalFlow,
  createDurableCibaToolRegistry,
} from "../src/core/tools/durable-approval-flow";

const db = (env as unknown as { DB: D1Database }).DB;
const createdOwners: string[] = [];
const schema = {
  type: "object",
  properties: { action: { type: "string", minLength: 1, maxLength: 40 } },
  required: ["action"],
  additionalProperties: false,
};

async function createOwner() {
  const ownerId = crypto.randomUUID();
  createdOwners.push(ownerId);
  await db.prepare("INSERT INTO owners(owner_id, status, created_at) VALUES(?, 'active', ?)")
    .bind(ownerId, new Date().toISOString()).run();
  return ownerId;
}

async function createDevice(ownerId: string, appId = "com.ciba.runtime.test") {
  const deviceId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO devices(device_id, app_id, token_hash, created_at, last_seen_at, owner_id)
    VALUES(?, ?, ?, ?, ?, ?)
  `).bind(deviceId, appId, crypto.randomUUID(), timestamp, timestamp, ownerId).run();
  return { ownerId, appId, deviceId };
}

async function setup(options: { policy?: () => boolean | Promise<boolean> } = {}) {
  const ownerId = await createOwner();
  const identity = await createDevice(ownerId);
  const approver = await createDevice(ownerId);
  const approvals = createD1ToolApprovalStore(db);
  const handler = vi.fn(async (input: unknown) => ({ executed: true, input }));
  const registry = createDurableCibaToolRegistry([{
    id: "profile.update",
    description: "Update a profile",
    risk: "write",
    requiresApproval: true,
    inputSchema: schema,
    execute: handler,
  }], {
    allowlist: ["profile.update"],
    approvals,
    authorize: options.policy ?? (async () => true),
  });
  const flow = createDurableCibaToolApprovalFlow(registry, approvals);
  const context = {
    conversationId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
  };
  const proposal = await flow.propose(identity, "profile.update", { action: "update" }, context);
  return { identity, approver, approvals, handler, registry, flow, context, proposal };
}

afterEach(async () => {
  for (const ownerId of createdOwners.splice(0)) {
    await db.prepare("DELETE FROM tool_approvals WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM devices WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM owners WHERE owner_id = ?").bind(ownerId).run();
  }
});

describe("D1-backed durable tool execution boundary", () => {
  it("requires explicit approval, executes once and rejects replay", async () => {
    const { identity, approver, handler, flow, context, proposal } = await setup();

    expect(proposal.approval).toBe("approval_required");
    expect(handler).not.toHaveBeenCalled();

    expect(await flow.answer({
      identity,
      approverDeviceId: approver.deviceId,
      approvalId: proposal.approvalId!,
      plan: proposal.plan,
      context,
      allow: true,
    })).toBe(true);

    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).resolves.toMatchObject({ executed: true, input: { action: "update" } });
    expect(handler).toHaveBeenCalledOnce();

    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).rejects.toThrow("tool_approval_required");
    expect(handler).toHaveBeenCalledOnce();

    const row = await db.prepare(
      "SELECT status, consumed_at FROM tool_approvals WHERE approval_id = ?"
    ).bind(proposal.approvalId).first<{ status: string; consumed_at: string | null }>();
    expect(row?.status).toBe("consumed");
    expect(row?.consumed_at).toBeTruthy();
  });

  it("rejects altered parameters and a different owner identity", async () => {
    const { identity, approver, handler, flow, context, proposal } = await setup();
    expect(await flow.answer({
      identity,
      approverDeviceId: approver.deviceId,
      approvalId: proposal.approvalId!,
      plan: proposal.plan,
      context,
      allow: true,
    })).toBe(true);

    const alteredPlan = { ...proposal.plan, input: { action: "delete" } };
    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: alteredPlan, context,
    })).rejects.toThrow("tool_approval_required");

    const foreignOwner = await createOwner();
    const foreignIdentity = await createDevice(foreignOwner);
    await expect(flow.execute({
      identity: foreignIdentity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).rejects.toThrow("tool_approval_required");

    expect(handler).not.toHaveBeenCalled();
    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).resolves.toMatchObject({ executed: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("atomically allows only one concurrent execution", async () => {
    const { identity, approver, handler, flow, context, proposal } = await setup();
    expect(await flow.answer({
      identity,
      approverDeviceId: approver.deviceId,
      approvalId: proposal.approvalId!,
      plan: proposal.plan,
      context,
      allow: true,
    })).toBe(true);

    const args = { identity, approvalId: proposal.approvalId, plan: proposal.plan, context };
    const outcomes = await Promise.allSettled([flow.execute(args), flow.execute(args)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("spends approval before a denied application policy and never starts the handler", async () => {
    const { identity, approver, handler, flow, context, proposal } = await setup({
      policy: async () => false,
    });
    expect(await flow.answer({
      identity,
      approverDeviceId: approver.deviceId,
      approvalId: proposal.approvalId!,
      plan: proposal.plan,
      context,
      allow: true,
    })).toBe(true);

    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).rejects.toThrow("tool_authorization_denied");
    expect(handler).not.toHaveBeenCalled();

    const row = await db.prepare(
      "SELECT status FROM tool_approvals WHERE approval_id = ?"
    ).bind(proposal.approvalId).first<{ status: string }>();
    expect(row?.status).toBe("consumed");
    await expect(flow.execute({
      identity, approvalId: proposal.approvalId, plan: proposal.plan, context,
    })).rejects.toThrow("tool_approval_required");
  });

  it("blocks direct registry execution without the trusted approval context", async () => {
    const { registry, handler, context } = await setup();
    await expect(registry.execute("profile.update", { action: "update" }, context))
      .rejects.toThrow("tool_approval_required");
    expect(handler).not.toHaveBeenCalled();
  });
});
