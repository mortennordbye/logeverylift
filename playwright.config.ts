import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./scripts/lib/local-test-db";

/**
 * Playwright config for end-to-end tests of LogEveryLift.
 *
 * `pnpm test:e2e` is self-contained: the webServer below prepares a dedicated
 * test database (scripts/e2e-prepare.ts), builds the app and serves the
 * production build on port 3917. Only a Postgres is needed: the compose one
 * locally, the service container in CI, or E2E_DATABASE_URL. The database name
 * must end in `_test`, because every spec resets the e2e user's data
 * (e2e/fixtures/reset.ts).
 *
 * A production build rather than the dev server: it is what ships, it has the
 * service worker, and taps no longer race on-demand compilation, which was
 * behind most of the suite's flakiness.
 *
 * Two engines: WebKit is what iOS ships, Chromium is the Android and desktop
 * PWA. The `setup` project logs in once; the rest reuse its storage state.
 */
// Off the usual dev ports, so nothing else is listening there.
const PORT = Number(process.env.E2E_PORT ?? 3917);
const baseURL = `http://127.0.0.1:${PORT}`;
const databaseUrl = testDatabaseUrl("logeverylift_test", process.env.E2E_DATABASE_URL);

// The reset fixture runs in the test workers and reads DATABASE_URL.
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One worker: every spec shares the e2e user and resets it before running.
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm e2e:serve",
    url: `${baseURL}/login`,
    // Never reuse: a server left running by an interrupted run was built from
    // older code, and the suite then tests that instead of the working tree.
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "pipe",
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      // The standalone server binds to HOSTNAME, which macOS sets to the
      // machine name.
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: "e2e-only-auth-secret-never-used-outside-tests",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["iPhone 14 Pro"] },
    },
    {
      name: "webkit",
      dependencies: ["setup"],
      use: {
        ...devices["iPhone 14 Pro"],
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        storageState: "e2e/.auth/user.json",
      },
    },
  ],
});
