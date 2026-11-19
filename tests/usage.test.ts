import { describe, expect, it, vi } from "vitest";
import { usageFor } from "../src/core/usage";

describe("usage store", () => {
  it("loads global, app and device usage buckets for the current UTC day", async () => {
    const buckets = [
      { scope_key: "global", requests: 12, request_limit: 100 },
      { scope_key: "app:com.ciba.garcia", requests: 4, request_limit: 50 },
      { scope_key: "device:device-123", requests: 2, request_limit: 20 },
    ];
    const all = vi.fn().mockResolvedValue({ results: buckets });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as unknown as { DB: D1Database };

    const result = await usageFor(env, "com.ciba.garcia", "device-123");

    expect(result.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.buckets).toEqual(buckets);
    expect(prepare).toHaveBeenCalledWith(
      "SELECT scope_key, requests, request_limit FROM daily_usage WHERE day = ? AND scope_key IN ('global', ?, ?)"
    );
    expect(bind).toHaveBeenCalledWith(result.day, "app:com.ciba.garcia", "device:device-123");
    expect(all).toHaveBeenCalledOnce();
  });

  it("returns an empty bucket list when D1 has no results", async () => {
    const all = vi.fn().mockResolvedValue({ results: undefined });
    const env = { DB: { prepare: () => ({ bind: () => ({ all }) }) } } as unknown as { DB: D1Database };
    const result = await usageFor(env, "app.test", "device-test");
    expect(result.buckets).toEqual([]);
  });
});
