import { describe, expect, it, vi } from "vitest";
import { allowedApps, isAppAllowed } from "../src/core/apps/access";

describe("app access policy", () => {
  it("parses configured app IDs, trimming whitespace and ignoring empty entries", () => {
    expect([...allowedApps({ ALLOWED_APP_IDS: " com.ciba.garcia, ,com.example.app ,, " })])
      .toEqual(["com.ciba.garcia", "com.example.app"]);
  });

  it("uses the enabled registry row when an app is registered", async () => {
    const first = vi.fn().mockResolvedValue({ enabled: 1 });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare }, ALLOWED_APP_IDS: "com.other.app" } as unknown as Parameters<typeof isAppAllowed>[0];

    await expect(isAppAllowed(env, "com.ciba.garcia")).resolves.toBe(true);
    expect(prepare).toHaveBeenCalledWith("SELECT enabled FROM app_registry WHERE app_id = ?");
    expect(bind).toHaveBeenCalledWith("com.ciba.garcia");
  });

  it("denies a registered app when its registry row is disabled", async () => {
    const first = vi.fn().mockResolvedValue({ enabled: 0 });
    const env = { DB: { prepare: () => ({ bind: () => ({ first }) }) }, ALLOWED_APP_IDS: "com.ciba.garcia" } as unknown as Parameters<typeof isAppAllowed>[0];
    await expect(isAppAllowed(env, "com.ciba.garcia")).resolves.toBe(false);
  });

  it("falls back to ALLOWED_APP_IDS only when no registry row exists", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const env = { DB: { prepare: () => ({ bind: () => ({ first }) }) }, ALLOWED_APP_IDS: "com.ciba.garcia,com.example.app" } as unknown as Parameters<typeof isAppAllowed>[0];
    await expect(isAppAllowed(env, "com.ciba.garcia")).resolves.toBe(true);
    await expect(isAppAllowed(env, "com.unknown.app")).resolves.toBe(false);
  });
});
