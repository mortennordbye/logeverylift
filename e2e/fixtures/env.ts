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

/**
 * A client IP of this test's own, for specs that sign up signed out. Sign-up
 * is limited per IP (src/app/api/auth/[...all]/route.ts); one IP per test,
 * browser and repeat keeps `--repeat-each` under that limit, and clear of the
 * workers' own logins in auth.setup.ts. The shared fixture (fixtures/test.ts)
 * also sends every test's auth calls from it, for Better Auth's own limit.
 */
export function signUpClientIp(testInfo: { testId: string; repeatEachIndex: number }): string {
  let hash = 0;
  for (const c of testInfo.testId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `10.${(hash >>> 8) & 255}.${hash & 255}.${testInfo.repeatEachIndex % 256}`;
}
