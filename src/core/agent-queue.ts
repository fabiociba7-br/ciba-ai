export const AGENT_QUEUE_LIMITS = Object.freeze({
  maxAttempts: 3,
  leaseSeconds: 90,
  heartbeatSeconds: 30,
  maxConcurrentGlobal: 2,
  maxConcurrentPerOwner: 1,
  maxPayloadChars: 32_000,
  maxResultChars: 16_000,
  maxQueuedPerOwner: 20,
});

export type AgentQueueStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AgentQueueRole = "general" | "reasoning" | "research" | "coding" | "creative" | "verification";

export interface AgentQueueJobSnapshot {
  status: AgentQueueStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  leaseExpiresAt: string | null;
  now?: string;
}

/** Determines whether a worker may reclaim a lease without allowing stale workers to renew it. */
export function isAgentQueueLeaseExpired(input: AgentQueueJobSnapshot): boolean {
  if (input.status !== "running" || !input.leaseExpiresAt) return false;
  const now = input.now ?? new Date().toISOString();
  const lease = Date.parse(input.leaseExpiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(lease) || !Number.isFinite(current)) {
    throw new Error("invalid_agent_queue_timestamp");
  }
  return lease <= current;
}

/** Retry is permitted only for a running job with attempts remaining and unexpired task TTL. */
export function canRetryAgentQueueJob(input: AgentQueueJobSnapshot): boolean {
  const now = input.now ?? new Date().toISOString();
  const current = Date.parse(now);
  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(current) || !Number.isFinite(expires) ||
      !Number.isInteger(input.attempts) || !Number.isInteger(input.maxAttempts) ||
      input.attempts < 0 || input.maxAttempts < 1 || input.maxAttempts > AGENT_QUEUE_LIMITS.maxAttempts) {
    throw new Error("invalid_agent_queue_snapshot");
  }
  return input.status === "running" && input.attempts < input.maxAttempts && expires > current;
}

/** A job is claimable only after its backoff time and before its overall expiry. */
export function isAgentQueueJobClaimable(input: {
  status: AgentQueueStatus;
  availableAt: string;
  expiresAt: string;
  now?: string;
}): boolean {
  const now = input.now ?? new Date().toISOString();
  const current = Date.parse(now);
  const available = Date.parse(input.availableAt);
  const expires = Date.parse(input.expiresAt);
  if (![current, available, expires].every(Number.isFinite)) {
    throw new Error("invalid_agent_queue_timestamp");
  }
  return input.status === "queued" && available <= current && expires > current;
}
