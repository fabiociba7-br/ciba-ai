import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelAgentJob, claimAgentJob, completeAgentJob, enqueueAgentJob,
  getAgentJob, heartbeatAgentJob,
} from "../src/core/agent-queue-store";

const db = (env as unknown as { DB: D1Database }).DB;
const makeOwner = async () => {
  const ownerId = crypto.randomUUID();
  await db.prepare("INSERT INTO owners(owner_id, status, created_at) VALUES(?, 'active', ?)")
    .bind(ownerId, new Date().toISOString()).run();
  return ownerId;
};
const createJob = async (ownerId: string, key: string = crypto.randomUUID()) => {
  const now = new Date().toISOString();
  const taskId = crypto.randomUUID();
  const result = await enqueueAgentJob(db, {
    taskId, ownerId, role: "general", idempotencyKey: key,
    payloadJson: JSON.stringify({ prompt: "test" }), now,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    priority: 10,
  });
  expect(result.created).toBe(true);
  return taskId;
};

describe("durable agent queue storage", () => {
  it("enqueues idempotently and scopes status to the owner", async () => {
    const ownerId = await makeOwner();
    const taskId = await createJob(ownerId, "same-request");
    const duplicate = await enqueueAgentJob(db, {
      taskId: crypto.randomUUID(), ownerId, role: "general",
      idempotencyKey: "same-request", payloadJson: "{}", now: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(duplicate.duplicate).toBe(true);
    expect((await getAgentJob(db, ownerId, taskId))?.status).toBe("queued");
    expect(await getAgentJob(db, crypto.randomUUID(), taskId)).toBeNull();
  });

  it("claims with a lease, renews it, and completes only with the current token", async () => {
    const ownerId = await makeOwner();
    const taskId = await createJob(ownerId);
    const claim = await claimAgentJob(db, new Date().toISOString());
    expect(claim?.task_id).toBe(taskId);
    expect(claim?.attempts).toBe(1);
    expect(await heartbeatAgentJob(db, taskId, "stale-token", new Date().toISOString())).toBe(false);
    expect(await heartbeatAgentJob(db, taskId, claim!.lease_token, new Date().toISOString())).toBe(true);
    expect(await completeAgentJob(db, taskId, "stale-token", JSON.stringify({ ok: true }), new Date().toISOString())).toBe(false);
    expect(await completeAgentJob(db, taskId, claim!.lease_token, JSON.stringify({ ok: true }), new Date().toISOString())).toBe(true);
    expect((await getAgentJob(db, ownerId, taskId))?.status).toBe("completed");
  });

  it("cancels only jobs owned by the authenticated owner", async () => {
    const ownerId = await makeOwner();
    const taskId = await createJob(ownerId);
    expect(await cancelAgentJob(db, crypto.randomUUID(), taskId, new Date().toISOString())).toBe(false);
    expect(await cancelAgentJob(db, ownerId, taskId, new Date().toISOString())).toBe(true);
    expect((await getAgentJob(db, ownerId, taskId))?.status).toBe("cancelled");
  });
});
