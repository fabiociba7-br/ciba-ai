import { describe, expect, it, vi } from "vitest";
import { requireCibaGenioAccess } from "../src/core/cibagenio-access";

describe("requireCibaGenioAccess", () => {
  const makeEnv = (control: { enabled: number; scope: string } | null) => {
    const first = vi.fn().mockResolvedValue(control);
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    return { env: { DB: { prepare } as unknown as D1Database }, prepare, bind, first };
  };

  it("allows an enabled app or global control without returning a response", async () => {
    for (const control of [{ enabled: 1, scope: "app" }, { enabled: 1, scope: "global" }]) {
      const { env } = makeEnv(control);
      await expect(requireCibaGenioAccess(env, "chat", "app.example")).resolves.toBeNull();
    }
  });

  it("returns the established 403 response when the control is disabled", async () => {
    const { env, prepare, bind } = makeEnv({ enabled: 0, scope: "app" });
    const response = await requireCibaGenioAccess(env, "chat", "app.example");
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "resource_locked_by_cibagenio",
      resource_id: "chat",
      scope: "app",
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("FROM cibagenio_controls"));
    expect(bind).toHaveBeenCalledWith("chat", "app.example");
  });

  it("fails closed when no control is configured", async () => {
    const { env } = makeEnv(null);
    const response = await requireCibaGenioAccess(env, "external_tools");
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: "resource_locked_by_cibagenio",
      resource_id: "external_tools",
      scope: "global",
    });
  });
});
