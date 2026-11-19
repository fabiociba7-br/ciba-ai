import { describe, expect, it } from "vitest";
import { createD1StorageOutbox } from "../src/core/storage-outbox";

function mockDb() {
  const rows: Record<string, unknown>[] = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) { values = args; return this; },
        async run() {
          if (sql.includes("lease_expires_at <= ?")) {
            for (const row of rows) {
              if (row.status === "processing" && typeof row.lease_expires_at === "string" && row.lease_expires_at <= String(values[3])) {
                row.attempts = Number(row.attempts) + 1;
                row.status = Number(row.attempts) >= Number(values[0]) ? "dead" : "pending";
                row.lease_expires_at = null;
                row.next_attempt_at = values[1];
              }
            }
          } else if (sql.includes("INSERT OR IGNORE")) {
            if (!rows.some((row) => row.id === values[0])) rows.push({
              id: values[0], destination: values[1], entity_type: values[2], entity_id: values[3],
              payload_json: values[4], payload_sha256: values[5], status: "pending", attempts: 0,
              next_attempt_at: values[6], created_at: values[7], updated_at: values[8],
              delivered_at: null, lease_expires_at: null,
            });
          } else if (sql.includes("SET status = 'delivered'")) {
            const row = rows.find((item) => item.id === values[2] && item.status === "processing");
            if (row) Object.assign(row, { status: "delivered", delivered_at: values[0], updated_at: values[1], lease_expires_at: null });
          } else if (sql.includes("SET status = CASE")) {
            const row = rows.find((item) => item.id === values[4] && item.status === "processing");
            if (row) Object.assign(row, {
              status: Number(row.attempts) + 1 >= Number(values[0]) ? "dead" : "pending",
              attempts: Number(row.attempts) + 1, next_attempt_at: values[1],
              last_error_code: values[2], updated_at: values[3], lease_expires_at: null,
            });
          }
          return { success: true };
        },
        async first<T>() {
          if (!sql.includes("RETURNING *")) return null;
          const row = rows.filter((item) => item.status === "pending" && String(item.next_attempt_at) <= String(values[2]))
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
          if (!row) return null;
          Object.assign(row, { status: "processing", updated_at: values[0], lease_expires_at: values[1] });
          return row as T;
        },
      };
    },
  };
  return { db: db as unknown as D1Database, rows };
}

const event = {
  id: "evt-1", destination: "turso" as const, entityType: "research",
  entityId: "research-1", payloadJson: JSON.stringify({ summary: "distilled finding" }),
  payloadSha256: "a".repeat(64), now: "2026-11-18T20:00:00.000Z",
};

describe("D1 storage outbox", () => {
  it("stores events idempotently and claims them once", async () => {
    const { db, rows } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await outbox.enqueue(event);
    await outbox.enqueue(event);
    expect(rows).toHaveLength(1);
    const claimed = await outbox.claimNext(event.now);
    expect(claimed).toMatchObject({ id: "evt-1", status: "processing", destination: "turso" });
    expect(rows[0].lease_expires_at).toBe("2026-11-18T20:05:00.000Z");
    expect(await outbox.claimNext(event.now)).toBeNull();
  });

  it("marks a delivered event and retries transient failures", async () => {
    const { db, rows } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await outbox.enqueue(event);
    await outbox.claimNext(event.now);
    await outbox.scheduleRetry("evt-1", "provider_timeout", "2026-11-18T20:01:00.000Z", event.now);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, last_error_code: "provider_timeout", lease_expires_at: null });
    await outbox.claimNext("2026-11-18T20:02:00.000Z");
    await outbox.markDelivered("evt-1", "2026-11-18T20:03:00.000Z");
    expect(rows[0]).toMatchObject({ status: "delivered", delivered_at: "2026-11-18T20:03:00.000Z", lease_expires_at: null });
  });

  it("recovers an expired worker lease and bounds repeated crashes", async () => {
    const { db, rows } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await outbox.enqueue(event);
    await outbox.claimNext(event.now);
    rows[0].lease_expires_at = "2026-11-18T20:01:00.000Z";
    const recovered = await outbox.claimNext("2026-11-18T20:02:00.000Z");
    expect(recovered).toMatchObject({ id: "evt-1", status: "processing", attempts: 1 });
    expect(rows[0].lease_expires_at).toBe("2026-11-18T20:07:00.000Z");
    rows[0].lease_expires_at = "2026-11-18T20:03:00.000Z";
    rows[0].attempts = 7;
    expect(await outbox.claimNext("2026-11-18T20:04:00.000Z")).toBeNull();
    expect(rows[0]).toMatchObject({ status: "dead", attempts: 8, lease_expires_at: null });
  });

  it("rejects malformed payloads and invalid identifiers", async () => {
    const { db } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await expect(outbox.enqueue({ ...event, payloadJson: "not-json" })).rejects.toThrow("invalid_storage_outbox_payload");
    await expect(outbox.enqueue({ ...event, id: "bad id" })).rejects.toThrow("invalid_storage_outbox_event");
  });
});
