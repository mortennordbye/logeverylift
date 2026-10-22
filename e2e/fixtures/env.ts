import path from "node:path";

/**
 * The e2e accounts: one per Playwright worker, so workers run specs side by
 * side without sharing data. Each spec resets only its own worker's account.
 *
 * E2E_WORKERS is set by playwright.config.ts (and passed to the webServer's
 * prepare step, which creates the accounts with scripts/create-e2e-user.ts).
 */
export const E2E_WORKERS = Number(process.env.E2E_WORKERS ?? 1);
const PASSWORD = "e2e-test-password";

export function e2eUser(workerIndex: number): { email: string; password: string } {
  // Worker 0 keeps the original address, so a single-worker run and older
  // notes about "e2e@workout.local" still line up.
  const email = workerIndex === 0 ? "e2e@workout.local" : `e2e+${workerIndex}@workout.local`;
  return { email, password: PASSWORD };
}

/** Where worker `workerIndex`'s logged-in storage state is kept. */
export function authFile(workerIndex: number): string {
  return path.join(__dirname, "..", ".auth", `user-${workerIndex}.json`);
}
