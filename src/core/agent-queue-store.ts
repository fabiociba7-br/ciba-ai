import { AGENT_QUEUE_LIMITS, type AgentQueueRole } from "./agent-queue";

export interface AgentQueueCreateInput {
  taskId: string;
  ownerId: string;
  role: AgentQueueRole;
  idempotencyKey: string;
  payloadJson: string;
  now: string;
  expiresAt: string;
  priority?: number;
}

export interface AgentQueueClaim {
  task_id: string;
  owner_id: string;
  agent_role: AgentQueueRole;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  lease_token: string;
  lease_expires_at: string;
}

export async function enqueueAgentJob(db: D1Database, input: AgentQueueCreateInput) {
  if (input.payloadJson.length > AGENT_QUEUE_LIMITS.maxPayloadChars) {
    throw new Error("agent_queue_payload_too_large");
  }
  const priority = Math.max(-10, Math.min(10, Math.trunc(input.priority ?? 0)));
  const result = await db.prepare(`
    INSERT INTO agent_execution_jobs(
      task_id, owner_id, agent_role, status, idempotency_key, payload_json,
      priority, attempts, max_attempts, available_at, created_at, updated_at, expires_at
    )
    SELECT ?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM agent_execution_jobs
      WHERE owner_id = ? AND status = 'queued' AND expires_at > ?
    ) < ?
    ON CONFLICT(owner_id, idempotency_key) DO NOTHING
  `).bind(
    input.taskId, input.ownerId, input.role, input.idempotencyKey, input.payloadJson,
    priority, AGENT_QUEUE_LIMITS.maxAttempts, input.now, input.now, input.now,
    input.expiresAt, input.ownerId, input.now, AGENT_QUEUE_LIMITS.maxQueuedPerOwner
  ).run();

  if (result.meta.changes === 1) return { created: true, duplicate: false };
  const existing = await db.prepare(`
    SELECT task_id, status, created_at, expires_at
    FROM agent_execution_jobs WHERE owner_id = ? AND idempotency_key = ?
  `).bind(input.ownerId, input.idempotencyKey).first<{
    task_id: string; status: string; created_at: string; expires_at: string;
  }>();
  if (existing) return { created: false, duplicate: true, job: existing };
  return { created: false, duplicate: false, queueFull: true };
}

/**
 * Recover expired leases and claim one job in a conditional UPDATE.
 * The claim update itself enforces global and per-owner concurrency caps.
 */
export async function claimAgentJob(db: D1Database, now: string): Promise<AgentQueueClaim | null> {
  const leaseExpiresAt = new Date(Date.parse(now) + AGENT_QUEUE_LIMITS.leaseSeconds * 1000).toISOString();
  await db.prepare(`
    UPDATE agent_execution_jobs
    SET status = CASE
          WHEN attempts >= max_attempts OR expires_at <= ? THEN 'failed'
          ELSE 'queued'
        END,
        available_at = CASE
          WHEN attempts >= max_attempts OR expires_at <= ? THEN available_at
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || MIN(60, (1 << MIN(attempts, 6))) || ' seconds')
        END,
        lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        error_code = CASE
          WHEN attempts >= max_attempts THEN 'lease_expired_max_attempts'
          WHEN expires_at <= ? THEN 'task_expired'
          ELSE 'lease_expired_retry'
        END,
        completed_at = CASE
          WHEN attempts >= max_attempts OR expires_at <= ? THEN ?
          ELSE NULL
        END,
        updated_at = ?
    WHERE status = 'running' AND lease_expires_at <= ?
  `).bind(now, now, now, now, now, now, now, now).run();

  const token = crypto.randomUUID();
  return db.prepare(`
    UPDATE agent_execution_jobs
    SET status = 'running',
        attempts = attempts + 1,
        lease_token = ?,
        error_code = NULL,
        lease_expires_at = ?,
        heartbeat_at = ?,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE task_id = (
      SELECT task_id FROM agent_execution_jobs
      WHERE status = 'queued' AND available_at <= ? AND expires_at > ?
        AND (SELECT COUNT(*) FROM agent_execution_jobs WHERE status = 'running' AND lease_expires_at > ?) < ?
        AND (SELECT COUNT(*) FROM agent_execution_jobs j
             WHERE j.owner_id = agent_execution_jobs.owner_id
               AND j.status = 'running' AND j.lease_expires_at > ?) < ?
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
      AND status = 'queued'
    RETURNING task_id, owner_id, agent_role, payload_json, attempts, max_attempts,
              lease_token, lease_expires_at
  `).bind(
    token, leaseExpiresAt, now, now, now, now, now, now,
    AGENT_QUEUE_LIMITS.maxConcurrentGlobal, now, AGENT_QUEUE_LIMITS.maxConcurrentPerOwner
  ).first<AgentQueueClaim>();
}

export async function heartbeatAgentJob(
  db: D1Database, taskId: string, leaseToken: string, now: string
): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.parse(now) + AGENT_QUEUE_LIMITS.leaseSeconds * 1000).toISOString();
  const result = await db.prepare(`
    UPDATE agent_execution_jobs
    SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
    WHERE task_id = ? AND status = 'running' AND lease_token = ?
      AND lease_expires_at > ? AND expires_at > ?
  `).bind(now, leaseExpiresAt, now, taskId, leaseToken, now, now).run();
  return result.meta.changes === 1;
}

export async function completeAgentJob(
  db: D1Database, taskId: string, leaseToken: string,
  resultJson: string, now: string
): Promise<boolean> {
  if (resultJson.length > AGENT_QUEUE_LIMITS.maxResultChars) {
    throw new Error("agent_queue_result_too_large");
  }
  const result = await db.prepare(`
    UPDATE agent_execution_jobs
    SET status = 'completed', result_json = ?, error_code = NULL,
        lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        completed_at = ?, updated_at = ?
    WHERE task_id = ? AND status = 'running' AND lease_token = ?
      AND lease_expires_at > ? AND expires_at > ?
  `).bind(resultJson, now, now, taskId, leaseToken, now, now).run();
  return result.meta.changes === 1;
}

export async function failAgentJob(
  db: D1Database, taskId: string, leaseToken: string, errorCode: string, now: string
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT attempts, max_attempts, expires_at FROM agent_execution_jobs
    WHERE task_id = ? AND status = 'running' AND lease_token = ?
  `).bind(taskId, leaseToken).first<{ attempts: number; max_attempts: number; expires_at: string }>();
  if (!row) return false;
  const retry = row.attempts < row.max_attempts && row.expires_at > now;
  const availableAt = new Date(Date.parse(now) + Math.min(60, 2 ** Math.min(row.attempts, 6)) * 1000).toISOString();
  const result = await db.prepare(`
    UPDATE agent_execution_jobs
    SET status = ?, available_at = ?, error_code = ?,
        lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        completed_at = ?, updated_at = ?
    WHERE task_id = ? AND status = 'running' AND lease_token = ?
  `).bind(
    retry ? "queued" : "failed", retry ? availableAt : now,
    errorCode.slice(0, 100), retry ? null : now, now, taskId, leaseToken
  ).run();
  return result.meta.changes === 1;
}

export async function cancelAgentJob(
  db: D1Database, ownerId: string, taskId: string, now: string
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE agent_execution_jobs
    SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
        heartbeat_at = NULL, completed_at = ?, updated_at = ?
    WHERE owner_id = ? AND task_id = ? AND status IN ('queued', 'running')
  `).bind(now, now, ownerId, taskId).run();
  return result.meta.changes === 1;
}

export async function getAgentJob(
  db: D1Database, ownerId: string, taskId: string
) {
  return db.prepare(`
    SELECT task_id, agent_role, status, attempts, max_attempts,
      error_code, result_json, created_at, updated_at, started_at,
      completed_at, expires_at
    FROM agent_execution_jobs WHERE owner_id = ? AND task_id = ?
  `).bind(ownerId, taskId).first<{
    task_id: string; agent_role: string; status: string; attempts: number;
    max_attempts: number; error_code: string | null; result_json: string | null;
    created_at: string; updated_at: string; started_at: string | null;
    completed_at: string | null; expires_at: string;
  }>();
}
