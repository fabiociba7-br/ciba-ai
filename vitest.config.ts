import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // The package exports this runtime helper; its subpath types are not exposed in all 1.x releases.
      // @ts-ignore - resolved by Vite from the installed Cloudflare Vitest plugin.
      const { readD1Migrations } = await import("@cloudflare/vitest-plugin/config");
      const migrations = await readD1Migrations("./migrations");
      return {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            ADMIN_TOKEN: "integration-test-admin-token",
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./tests/apply-migrations.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
