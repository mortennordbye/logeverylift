/**
 * Create the dedicated e2e test user.
 *
 * Idempotent — running twice with the same email is a no-op (better-auth
 * rejects the duplicate). Used by the local Playwright smoke pass and by
 * `pnpm test:e2e`.
 *
 * Usage:
 *   docker-compose exec app pnpm tsx scripts/create-e2e-user.ts
 *
 * Override defaults via env vars:
 *   E2E_USER_EMAIL    — email for the test account
 *   E2E_USER_PASSWORD — password
 *   E2E_USER_NAME     — display name
 *
 * Do NOT run this against prod. The default credentials are intentionally
 * weak so the test harness can use them — they're useless on a public DB.
 */

import { auth } from "../src/lib/auth";

const EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@workout.local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-test-password";
const NAME = process.env.E2E_USER_NAME ?? "E2E Tester";

async function main() {
  console.log(`Creating e2e user: ${EMAIL}`);

  try {
    const result = await auth.api.signUpEmail({
      body: { name: NAME, email: EMAIL, password: PASSWORD },
    });

    if (!result?.user) {
      throw new Error("Signup returned no user");
    }

    console.log(`✓ Created e2e user: ${EMAIL}`);
    console.log(`  Password: ${PASSWORD}`);
    console.log("");
    console.log("Export these in your shell to run smoke tests:");
    console.log(`  export E2E_USER_EMAIL="${EMAIL}"`);
    console.log(`  export E2E_USER_PASSWORD="${PASSWORD}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.toLowerCase().includes("already") ||
      message.toLowerCase().includes("unique")
    ) {
      console.log(`ℹ  E2E user ${EMAIL} already exists. Skipping.`);
      console.log("");
      console.log("Export these in your shell to run smoke tests:");
      console.log(`  export E2E_USER_EMAIL="${EMAIL}"`);
      console.log(`  export E2E_USER_PASSWORD="${PASSWORD}"`);
    } else {
      console.error("Failed to create e2e user:", message);
      process.exit(1);
    }
  }

  process.exit(0);
}

main();
