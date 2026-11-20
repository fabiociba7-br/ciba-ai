import { describe, expect, it, vi } from "vitest";
import {
  handleOwnerFacebookData,
  handleOwnerFacebookLink,
  handleOwnerFacebookStatus,
  type FacebookOwnerEnv,
} from "../src/http/owner-facebook";

const token = "device-token-0123456789-abcdefghijklmnop";
const ownerId = "owner-123";
const device = { device_id: "device-123", app_id: "com.ciba.garcia", owner_id: ownerId };

const createEnv = (options: { appSecret?: string; link?: Record<string, unknown> | null } = {}) => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => {
        if (sql.includes("FROM devices")) return device;
        if (sql.includes("FROM owners")) return { owner_id: ownerId };
        if (sql.includes("FROM owner_facebook_links")) return options.link ?? null;
        return null;
      }),
    })),
  }));
  const env = {
    DB: { prepare } as unknown as D1Database,
    FACEBOOK_APP_SECRET: options.appSecret,
  } satisfies FacebookOwnerEnv;
  return { env, prepare };
};

const authenticatedRequest = (path: string, method = "GET") =>
  new Request(`https://garcia.test${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });

describe("Facebook owner handlers", () => {
  it("rejects Facebook status requests without device authentication", async () => {
    const { env, prepare } = createEnv();
    const response = await handleOwnerFacebookStatus(
      new Request("https://garcia.test/v1/owner/facebook/status"),
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns the stored Facebook link and derived capabilities", async () => {
    const { env } = createEnv({
      link: {
        facebook_user_id: "123456789",
        linked_at: "2026-11-20T09:00:00.000Z",
        token_expires_at: null,
        permissions_json: JSON.stringify(["public_profile", "user_posts"]),
        profile_json: JSON.stringify({ id: "123456789", name: "Test User" }),
        token_ciphertext: "encrypted-token",
      },
    });
    const response = await handleOwnerFacebookStatus(
      authenticatedRequest("/v1/owner/facebook/status"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      linked: true,
      token_stored: true,
      linked_at: "2026-11-20T09:00:00.000Z",
      permissions: ["public_profile", "user_posts"],
      capabilities: {
        profile: true,
        personal_posts: true,
        personal_photos: true,
      },
      profile: { id: "123456789", name: "Test User" },
      requires_reconnect: false,
    });
  });

  it("requires the server-side Meta secret before linking an account", async () => {
    const { env } = createEnv();
    const response = await handleOwnerFacebookLink(
      authenticatedRequest("/v1/owner/facebook/link", "POST"),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "facebook_server_not_configured" });
  });

  it("requires the server-side Meta secret before reading Facebook data", async () => {
    const { env } = createEnv();
    const response = await handleOwnerFacebookData(
      authenticatedRequest("/v1/owner/facebook/profile"),
      env,
      new URL("https://garcia.test/v1/owner/facebook/profile"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "facebook_server_not_configured" });
  });
});
