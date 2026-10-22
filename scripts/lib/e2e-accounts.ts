/**
 * The e2e accounts: one per Playwright worker, so workers run specs side by
 * side without sharing data. Created by scripts/e2e-prepare.ts; used by the
 * e2e fixtures (e2e/fixtures/env.ts).
 *
 * Lives under scripts/ rather than e2e/ because the prepare script needs it
 * and e2e/ is not part of the Docker build context.
 */
const PASSWORD = "e2e-test-password";

export function e2eUser(workerIndex: number): { email: string; password: string } {
  // Worker 0 keeps the original address, so a single-worker run and older
  // notes about "e2e@workout.local" still line up.
  const email = workerIndex === 0 ? "e2e@workout.local" : `e2e+${workerIndex}@workout.local`;
  return { email, password: PASSWORD };
}
