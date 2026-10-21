import path from "path";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./scripts/lib/local-test-db";

const alias = { "@": path.resolve(__dirname, "./src") };

// Resolving the URL asks Docker for the compose Postgres's port, which fails
// when it isn't running. Keep that from breaking `pnpm test` (unit only): the
// integration global setup reports the stored error instead.
let integrationDbUrl = "";
let integrationDbError = "";
try {
  integrationDbUrl = testDatabaseUrl("logeverylift_int_test", process.env.TEST_DATABASE_URL);
} catch (err) {
  integrationDbError = err instanceof Error ? err.message : String(err);
}

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json"],
      include: ["src/lib/**/*.ts", "src/db/**/*.ts", "src/contexts/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "**/*.config.*"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/__tests__/**/*.test.ts"],
          // Vitest's defaults pick up everything under `e2e/`. Those are
          // Playwright specs run separately via `pnpm test:e2e` and use the
          // Playwright runner, not Vitest.
          exclude: ["**/node_modules/**", "e2e/**", "src/__tests__/integration/**"],
        },
      },
      {
        // Server Actions against a real, migrated Postgres. Mocks only the
        // session (who is calling) and Next's cache invalidation; every query
        // runs for real, which is what catches a wrong WHERE, a missing
        // transaction or an upsert keyed on the wrong columns.
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/__tests__/integration/**/*.test.ts"],
          globalSetup: ["src/__tests__/integration/global-setup.ts"],
          setupFiles: ["src/__tests__/integration/setup.ts"],
          // One database, truncated between tests.
          fileParallelism: false,
          env: {
            DATABASE_URL: integrationDbUrl,
            INTEGRATION_DB_ERROR: integrationDbError,
            BETTER_AUTH_SECRET: "integration-test-secret-not-for-production",
          },
        },
      },
    ],
  },
});
