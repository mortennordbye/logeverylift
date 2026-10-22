import path from "node:path";

export { e2eUser } from "../../scripts/lib/e2e-accounts";

/**
 * How many e2e accounts exist, one per Playwright worker
 * (scripts/lib/e2e-accounts.ts). Set by playwright.config.ts, which also
 * passes it to the webServer's prepare step that creates them.
 */
export const E2E_WORKERS = Number(process.env.E2E_WORKERS ?? 1);

/** Where worker `workerIndex`'s logged-in storage state is kept. */
export function authFile(workerIndex: number): string {
  return path.join(__dirname, "..", ".auth", `user-${workerIndex}.json`);
}
