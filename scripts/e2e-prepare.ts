/**
 * Prepare the e2e database: create it if missing, migrate, seed the exercise
 * library and create one e2e account per Playwright worker.
 *
 * Run by Playwright's webServer before it starts the production build (see
 * playwright.config.ts), so `pnpm test:e2e` needs nothing but a Postgres to
 * point at. Each spec then resets the user's own data (e2e/fixtures/reset.ts).
 *
 * Refuses any database whose name does not end in `_test`. The reset deletes
 * the e2e user's programs and history on every spec, and a DATABASE_URL left
 * pointing at the dev database or a tunnel to prod must fail here rather than
 * be wiped.
 */

import { execFileSync } from "node:child_process";
import pg from "pg";
import { e2eUser } from "./lib/e2e-accounts";
import { assertTestDatabase } from "./lib/test-database";
import { LEGAL_VERSION } from "../src/lib/constants/legal";

async function main() {
  const url = assertTestDatabase(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) {
      // Identifier, not a parameter: CREATE DATABASE takes no bind values. The
      // name already passed assertTestDatabase's character check.
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database ${dbName}`);
    }
  } finally {
    await client.end();
  }

  for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
    execFileSync("pnpm", ["exec", "tsx", script], { stdio: "inherit", env: process.env });
  }
  // One account per Playwright worker (scripts/lib/e2e-accounts.ts).
  const workers = Number(process.env.E2E_WORKERS ?? 1);
  for (let i = 0; i < workers; i++) {
    const { email, password } = e2eUser(i);
    execFileSync("pnpm", ["exec", "tsx", "scripts/create-e2e-user.ts"], {
      stdio: "inherit",
      env: { ...process.env, E2E_USER_EMAIL: email, E2E_USER_PASSWORD: password },
    });
  }

  // Accounts created before the consent columns existed are kept, so record
  // the current terms on all of them; otherwise login lands on /consent.
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const emails = Array.from({ length: workers }, (_, i) => e2eUser(i).email);
    await db.query(
      `UPDATE "user" SET terms_version = $1, policy_seen_version = $1, terms_accepted_at = now(), health_consent_at = now()
       WHERE email = ANY($2)`,
      [LEGAL_VERSION, emails],
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("[e2e-prepare] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
