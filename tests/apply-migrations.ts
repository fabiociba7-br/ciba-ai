import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

type TestBindings = {
  DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

beforeAll(async () => {
  const bindings = env as unknown as TestBindings;
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
