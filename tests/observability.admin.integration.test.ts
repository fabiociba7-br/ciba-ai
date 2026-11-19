import { env } from "cloudflare:workers";
import workerModule, { type Env } from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";

const worker = {
  fetch: (request: Request) => workerModule.fetch(request, env as unknown as Env),
};
const adminToken = "integration-test-admin-token-0123456789abcdef";
const today = new Date().toISOString().slice(0, 10);

const request = (token?: string) =>
  worker.fetch(new Request("https://ciba-ai.test/v1/admin/observability", {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));

describe("private operational observability API", () => {
  beforeEach(async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare("DELETE FROM daily_usage WHERE day = ?").bind(today).run();
  });

  it("requires administrator authentication", async () => {
    const response = await request();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns aggregated usage without exposing device identifiers or conversation content", async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.batch([
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, 'global', 7, 50, ?)").bind(today, new Date().toISOString()),
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, 'app:com.ciba.garcia', 7, 25, ?)").bind(today, new Date().toISOString()),
      db.prepare("INSERT INTO daily_usage(day, scope_key, requests, request_limit, updated_at) VALUES(?, 'device:private-device-id', 7, 10, ?)").bind(today, new Date().toISOString()),
    ]);

    const response = await request(adminToken);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      request_metrics: { daily: Array<{ day: string; global_requests: number; app_bucket_requests: number; device_bucket_requests: number }> };
      privacy: { prompts_recorded: boolean; responses_recorded: boolean; device_identifiers_exposed: boolean; aggregation_only: boolean };
    };

    expect(body.request_metrics.daily[0]).toMatchObject({
      day: today,
      global_requests: 7,
      app_bucket_requests: 7,
      device_bucket_requests: 7,
    });
    expect(body.privacy).toEqual({
      prompts_recorded: false,
      responses_recorded: false,
      device_identifiers_exposed: false,
      aggregation_only: true,
    });
    expect(JSON.stringify(body)).not.toContain("private-device-id");
  });
});
