import { describe, expect, it } from "vitest";
import { deriveTaskLifecycle } from "../src/core/task-lifecycle";

describe("task lifecycle", () => {
  const expiresAt = "2026-12-01T00:00:00.000Z";
  const now = "2026-11-15T12:00:00.000Z";

  it("distinguishes a queued task from one acknowledged for processing", () => {
    expect(deriveTaskLifecycle({ acknowledgedAt: null, expiresAt, resultStatuses: [], now }).status)
      .toBe("awaiting_delivery");
    expect(deriveTaskLifecycle({ acknowledgedAt: now, expiresAt, resultStatuses: [], now }).status)
      .toBe("processing");
  });

  it("reports completed, partial and failed results without treating acknowledgement as success", () => {
    expect(deriveTaskLifecycle({ acknowledgedAt: now, expiresAt, resultStatuses: ["completed"], now }).status)
      .toBe("completed");
    expect(deriveTaskLifecycle({ acknowledgedAt: now, expiresAt, resultStatuses: ["partial", "completed"], now }).status)
      .toBe("partial");
    expect(deriveTaskLifecycle({ acknowledgedAt: now, expiresAt, resultStatuses: ["failed"], now }).status)
      .toBe("failed");
  });

  it("marks a task expired only when no result exists", () => {
    const input = { acknowledgedAt: null, expiresAt: "2026-11-14T00:00:00.000Z", resultStatuses: [] as Array<"completed" | "partial" | "failed">, now };
    expect(deriveTaskLifecycle(input).status).toBe("expired");
    expect(deriveTaskLifecycle({ ...input, resultStatuses: ["completed"] }).status).toBe("completed");
  });

  it("returns safe aggregate counts", () => {
    expect(deriveTaskLifecycle({ acknowledgedAt: now, expiresAt, resultStatuses: ["completed", "partial", "failed"], now }))
      .toMatchObject({ result_count: 3, completed_results: 1, partial_results: 1, failed_results: 1, acknowledged: true });
  });
});
