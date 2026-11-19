export type GarciaStorageDestination = "turso" | "neon" | "r2";

export interface StorageOutboxEvent {
  id: string;
  destination: GarciaStorageDestination;
  entityType: string;
  entityId: string;
  payloadJson: string;
  payloadSha256: string;
  status: "pending" | "processing" | "delivered" | "dead";
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export interface StorageOutboxInput {
  id: string;
  destination: GarciaStorageDestination;
  entityType: string;
  entityId: string;
  payloadJson: string;
  payloadSha256: string;
  now?: string;
}

const MAX_PAYLOAD_BYTES = 256 * 1024;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function validIso(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Durable, idempotent queue stored in the existing D1 database. */
export function createD1StorageOutbox(db: D1Database) {
  return {
    async enqueue(input: StorageOutboxInput): Promise<void> {
      const now = input?.now ?? new Date().toISOString();
      if (!input || !ID_PATTERN.test(input.id) ||
          !["turso", "neon", "r2"].includes(input.destination) ||
          !ID_PATTERN.test(input.entityType) || !ID_PATTERN.test(input.entityId) ||
          typeof input.payloadJson !== "string" ||
          new TextEncoder().encode(input.payloadJson).byteLength > MAX_PAYLOAD_BYTES ||
          !HASH_PATTERN.test(input.payloadSha256) || !validIso(now)) {
        throw new Error("invalid_storage_outbox_event");
      }
      try {
        JSON.parse(input.payloadJson);
      } catch {
        throw new Error("invalid_storage_outbox_payload");
      }
      await db.prepare(`
        INSERT OR IGNORE INTO garcia_storage_outbox (
          id, destination, entity_type, entity_id, payload_json, payload_sha256,
          status, attempts, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      `).bind(
        input.id, input.destination, input.entityType, input.entityId,
        input.payloadJson, input.payloadSha256, now, now, now,
      ).run();
    },

    async claimNext(now = new Date().toISOString()): Promise<StorageOutboxEvent | null> {
      if (!validIso(now)) throw new Error("invalid_storage_outbox_time");
      const row = await db.prepare(`
        UPDATE garcia_storage_outbox
        SET status = 'processing', updated_at = ?
        WHERE id = (
          SELECT id FROM garcia_storage_outbox
          WHERE status = 'pending' AND next_attempt_at <= ?
          ORDER BY created_at ASC
          LIMIT 1
        )
        AND status = 'pending'
        RETURNING *
      `).bind(now, now).first<Record<string, unknown>>();
      if (!row) return null;
      return {
        id: String(row.id),
        destination: row.destination as GarciaStorageDestination,
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        payloadJson: String(row.payload_json),
        payloadSha256: String(row.payload_sha256),
        status: row.status as StorageOutboxEvent["status"],
        attempts: Number(row.attempts),
        nextAttemptAt: String(row.next_attempt_at),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        deliveredAt: typeof row.delivered_at === "string" ? row.delivered_at : null,
      };
    },

    async markDelivered(id: string, now = new Date().toISOString()): Promise<void> {
      if (!ID_PATTERN.test(id) || !validIso(now)) throw new Error("invalid_storage_outbox_update");
      await db.prepare(`
        UPDATE garcia_storage_outbox
        SET status = 'delivered', delivered_at = ?, updated_at = ?, last_error_code = NULL
        WHERE id = ? AND status = 'processing'
      `).bind(now, now, id).run();
    },

    async scheduleRetry(id: string, errorCode: string, nextAttemptAt: string, now = new Date().toISOString()): Promise<void> {
      if (!ID_PATTERN.test(id) || !/^[a-z0-9_:-]{1,80}$/i.test(errorCode) ||
          !validIso(nextAttemptAt) || !validIso(now)) {
        throw new Error("invalid_storage_outbox_update");
      }
      await db.prepare(`
        UPDATE garcia_storage_outbox
        SET status = CASE WHEN attempts + 1 >= 8 THEN 'dead' ELSE 'pending' END,
            attempts = attempts + 1,
            next_attempt_at = ?,
            last_error_code = ?,
            updated_at = ?
        WHERE id = ? AND status = 'processing'
      `).bind(nextAttemptAt, errorCode, now, id).run();
    },
  };
}
