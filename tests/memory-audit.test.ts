import { describe, expect, it, vi } from "vitest";
import { recordMemoryAudit } from "../src/core/memory-audit";

describe("memory audit store", () => {
  it("inserts audit events with generated IDs and nullable references", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as unknown as { DB: D1Database };

    await recordMemoryAudit(env, {
      ownerId: "owner-1",
      scope: "app",
      sourceAppId: "com.ciba.garcia",
      key: "preference",
      action: "review_approved",
      actorAppId: "com.ciba.garcia",
      occurredAt: "2026-11-20T12:00:00.000Z",
    });

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO memory_audit_events"));
    expect(bind).toHaveBeenCalledOnce();
    const values = bind.mock.calls[0];
    expect(values).toHaveLength(10);
    expect(values[0]).toEqual(expect.any(String));
    expect(values.slice(1)).toEqual([
      "owner-1", null, null, "app", "com.ciba.garcia",
      "preference", "review_approved", "com.ciba.garcia", "2026-11-20T12:00:00.000Z",
    ]);
    expect(run).toHaveBeenCalledOnce();
  });

  it("preserves supplied memory and proposal references", async () => {
    const bind = vi.fn().mockReturnValue({ run: vi.fn() });
    const env = { DB: { prepare: () => ({ bind }) } } as unknown as { DB: D1Database };
    await recordMemoryAudit(env, {
      ownerId: "owner-2",
      memoryId: "memory-1",
      proposalId: "proposal-1",
      scope: "owner",
      sourceAppId: null,
      key: "topic",
      action: "updated",
      actorAppId: "com.ciba.garcia",
      occurredAt: "2026-11-20T13:00:00.000Z",
    });
    expect(bind.mock.calls[0].slice(1, 4)).toEqual(["owner-2", "memory-1", "proposal-1"]);
  });
});
