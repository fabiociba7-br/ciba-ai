import { describe, expect, it } from "vitest";
import {
  AGENT_QUEUE_LIMITS, canRetryAgentQueueJob, isAgentQueueJobClaimable,
  isAgentQueueLeaseExpired,
} from "../src/core/agent-queue";

describe("durable agent queue policy", () => {
  it("keeps parallelism conservative for the free inference budget", () => {
    expect(AGENT_QUEUE_LIMITS.maxConcurrentGlobal).toBe(2);
    expect(AGENT_QUEUE_LIMITS.maxConcurrentPerOwner).toBe(1);
    expect(AGENT_QUEUE_LIMITS.maxAttempts).toBe(3);
  });
  it("reclaims only expired running leases", () => {
    expect(isAgentQueueLeaseExpired({status:"running",attempts:1,maxAttempts:3,expiresAt:"2026-11-20T00:00:00.000Z",leaseExpiresAt:"2026-11-19T10:00:00.000Z",now:"2026-11-19T10:00:01.000Z"})).toBe(true);
    expect(isAgentQueueLeaseExpired({status:"queued",attempts:0,maxAttempts:3,expiresAt:"2026-11-20T00:00:00.000Z",leaseExpiresAt:null,now:"2026-11-19T10:00:01.000Z"})).toBe(false);
  });
  it("allows retry only within attempt and TTL budgets", () => {
    const base={status:"running" as const,attempts:2,maxAttempts:3,expiresAt:"2026-11-20T00:00:00.000Z",leaseExpiresAt:"2026-11-19T10:00:00.000Z",now:"2026-11-19T10:00:01.000Z"};
    expect(canRetryAgentQueueJob(base)).toBe(true);
    expect(canRetryAgentQueueJob({...base,attempts:3})).toBe(false);
    expect(canRetryAgentQueueJob({...base,expiresAt:"2026-11-19T10:00:00.000Z"})).toBe(false);
  });
  it("claims only queued work that is available and not expired", () => {
    const base={status:"queued" as const,availableAt:"2026-11-19T10:00:00.000Z",expiresAt:"2026-11-20T00:00:00.000Z",now:"2026-11-19T10:00:01.000Z"};
    expect(isAgentQueueJobClaimable(base)).toBe(true);
    expect(isAgentQueueJobClaimable({...base,availableAt:"2026-11-19T10:01:00.000Z"})).toBe(false);
    expect(isAgentQueueJobClaimable({...base,expiresAt:base.now})).toBe(false);
  });
});
