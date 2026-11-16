import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createD1ToolApprovalStore } from "../src/core/tools/durable-consent";

const db = env.DB;
const createdOwners: string[] = [];

async function identity(ownerId = crypto.randomUUID()) {
  const appId = "com.ciba.test";
  const deviceId = crypto.randomUUID();
  createdOwners.push(ownerId);
  await db.prepare("INSERT INTO owners(owner_id, status, created_at) VALUES(?, 'active', ?)")
    .bind(ownerId, new Date().toISOString()).run();
  await db.prepare(`
    INSERT INTO devices(device_id, app_id, token_hash, created_at, last_seen_at, owner_id)
    VALUES(?, ?, ?, ?, ?, ?)
  `).bind(deviceId, appId, crypto.randomUUID(), new Date().toISOString(),
    new Date().toISOString(), ownerId).run();
  return { ownerId, appId, deviceId };
}

const request = {
  conversationId: "conversation-test",
  invocationId: crypto.randomUUID(),
  toolId: "profile.update",
  risk: "write" as const,
  input: { profile: "main", changes: { city: "Curitiba", enabled: true } }
};

afterEach(async () => {
  for (const ownerId of createdOwners.splice(0)) {
    await db.prepare("DELETE FROM tool_approvals WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM devices WHERE owner_id = ?").bind(ownerId).run();
    await db.prepare("DELETE FROM owners WHERE owner_id = ?").bind(ownerId).run();
  }
});

describe("D1 durable tool approval store", () => {
  it("persists an immutable request and rejects invocation rebinding", async () => {
    const caller = await identity();
    const store = createD1ToolApprovalStore(db);
    const first = await store.request(caller, request);
    const repeated = await store.request(caller, request);
    expect(first).toEqual({ approvalId: first.approvalId, status: "approval_required" });
    expect(repeated).toEqual(first);

    await expect(store.request(caller, {
      ...request,
      input: { profile: "admin", changes: { enabled: false } }
    })).rejects.toThrow("tool_approval_invocation_conflict");

    const row = await db.prepare(
      "SELECT status, input_json, input_sha256 FROM tool_approvals WHERE approval_id = ?"
    ).bind(first.approvalId).first<{ status: string; input_json: string; input_sha256: string }>();
    expect(row?.status).toBe("pending");
    expect(row?.input_json).toContain('"city":"Curitiba"');
    expect(row?.input_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds approval to the same owner/app and atomically consumes it once", async () => {
    const caller = await identity();
    const approver = await identity(caller.ownerId);
    const foreignOwner = await identity();
    const foreignApprover = foreignOwner.deviceId;
    const store = createD1ToolApprovalStore(db);
    const approval = await store.request(caller, request);

    expect(await store.answer({
      approvalId: approval.approvalId,
      identity: caller,
      request,
      approverDeviceId: foreignApprover,
      allow: true
    })).toBe(false);

    expect(await store.answer({
      approvalId: approval.approvalId,
      identity: caller,
      request,
      approverDeviceId: approver.deviceId,
      allow: true
    })).toBe(true);

    expect(await store.consume({
      approvalId: approval.approvalId,
      identity: caller,
      request: { ...request, input: { ...request.input, tampered: true } }
    })).toBe(false);

    const consumeArgs = { approvalId: approval.approvalId, identity: caller, request };
    const outcomes = await Promise.all([
      store.consume(consumeArgs),
      store.consume(consumeArgs)
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const row = await db.prepare(
      "SELECT status, consumed_at, closed_at FROM tool_approvals WHERE approval_id = ?"
    ).bind(approval.approvalId).first<{ status: string; consumed_at: string; closed_at: string }>();
    expect(row?.status).toBe("consumed");
    expect(row?.consumed_at).toBeTruthy();
    expect(row?.closed_at).toBeTruthy();
  });

  it("expires pending approvals and supports explicit cancellation", async () => {
    const caller = await identity();
    let clock = Date.now();
    const store = createD1ToolApprovalStore(db, { ttlMs: 1_000, now: () => clock });
    const expiring = await store.request(caller, request);
    clock += 1_001;

    expect(await store.answer({
      approvalId: expiring.approvalId,
      identity: caller,
      request,
      approverDeviceId: caller.deviceId,
      allow: true
    })).toBe(false);
    const expired = await db.prepare(
      "SELECT status FROM tool_approvals WHERE approval_id = ?"
    ).bind(expiring.approvalId).first<{ status: string }>();
    expect(expired?.status).toBe("expired");

    const cancellable = await store.request(caller, { ...request, invocationId: crypto.randomUUID() });
    expect(await store.cancel(cancellable.approvalId, caller)).toBe(true);
    expect(await store.cancel(cancellable.approvalId, caller)).toBe(false);
  });
});
