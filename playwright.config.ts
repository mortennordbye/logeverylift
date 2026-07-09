import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end tests of LogEveryLift.
 *
 * Tests assume the dev server is already running at http://localhost:3000.
 * Start it with `./scripts/dev.sh` before running `pnpm verify:full` or
 * `pnpm exec playwright test`.
 *
 * Auth credentials must be provided via environment variables:
 *   E2E_USER_EMAIL — email of an existing test user
 *   E2E_USER_PASSWORD — that user's password
 *
 * The `setup` project logs in once and stores cookies in
 * `e2e/.auth/user.json`; all other tests reuse that storage state, so we
 * don't pay the login cost in every test.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["iPhone 14 Pro"] },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: {
        ...devices["iPhone 14 Pro"],
        storageState: "e2e/.auth/user.json",
      },
    },
  ],
});
