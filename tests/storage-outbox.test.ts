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
          if (sql.includes("INSERT OR IGNORE")) {
            if (!rows.some((row) => row.id === values[0])) rows.push({
              id: values[0], destination: values[1], entity_type: values[2], entity_id: values[3],
              payload_json: values[4], payload_sha256: values[5], status: "pending", attempts: 0,
              next_attempt_at: values[6], created_at: values[7], updated_at: values[8], delivered_at: null,
            });
          } else if (sql.includes("SET status = 'delivered'")) {
            const row = rows.find((item) => item.id === values[2] && item.status === "processing");
            if (row) Object.assign(row, { status: "delivered", delivered_at: values[0], updated_at: values[1] });
          } else if (sql.includes("SET status = CASE")) {
            const row = rows.find((item) => item.id === values[3] && item.status === "processing");
            if (row) Object.assign(row, {
              status: Number(row.attempts) + 1 >= 8 ? "dead" : "pending",
              attempts: Number(row.attempts) + 1, next_attempt_at: values[0],
              last_error_code: values[1], updated_at: values[2],
            });
          }
          return { success: true };
        },
        async first<T>() {
          if (!sql.includes("RETURNING *")) return null;
          const row = rows.filter((item) => item.status === "pending" && String(item.next_attempt_at) <= String(values[1]))
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
          if (!row) return null;
          Object.assign(row, { status: "processing", updated_at: values[0] });
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
    expect(await outbox.claimNext(event.now)).toBeNull();
  });

  it("marks a delivered event and retries transient failures", async () => {
    const { db, rows } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await outbox.enqueue(event);
    await outbox.claimNext(event.now);
    await outbox.scheduleRetry("evt-1", "provider_timeout", "2026-11-18T20:01:00.000Z", event.now);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, last_error_code: "provider_timeout" });
    await outbox.claimNext("2026-11-18T20:02:00.000Z");
    await outbox.markDelivered("evt-1", "2026-11-18T20:03:00.000Z");
    expect(rows[0]).toMatchObject({ status: "delivered", delivered_at: "2026-11-18T20:03:00.000Z" });
  });

  it("rejects malformed payloads and invalid identifiers", async () => {
    const { db } = mockDb();
    const outbox = createD1StorageOutbox(db);
    await expect(outbox.enqueue({ ...event, payloadJson: "not-json" })).rejects.toThrow("invalid_storage_outbox_payload");
    await expect(outbox.enqueue({ ...event, id: "bad id" })).rejects.toThrow("invalid_storage_outbox_event");
  });
});
