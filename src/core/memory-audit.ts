export type MemoryAuditAction = "created" | "updated" | "deleted" | "review_approved" | "review_rejected";

export type MemoryAuditEvent = {
  ownerId: string;
  memoryId?: string | null;
  proposalId?: string | null;
  scope: "app" | "owner";
  sourceAppId: string | null;
  key: string;
  action: MemoryAuditAction;
  actorAppId: string;
  occurredAt: string;
};

export const recordMemoryAudit = async (
  env: { DB: D1Database },
  event: MemoryAuditEvent,
) => env.DB.prepare(`
  INSERT INTO memory_audit_events(
    event_id, owner_id, memory_id, proposal_id, scope, source_app_id,
    memory_key, action, actor_app_id, occurred_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  crypto.randomUUID(), event.ownerId, event.memoryId || null, event.proposalId || null,
  event.scope, event.sourceAppId, event.key, event.action, event.actorAppId, event.occurredAt,
).run();
