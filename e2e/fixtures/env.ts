/**
 * The e2e account. Defaults match scripts/create-e2e-user.ts, which the
 * webServer's prepare step runs against the test database, so a plain
 * `pnpm test:e2e` needs no credentials set.
 */
export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@workout.local";
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-test-password";
