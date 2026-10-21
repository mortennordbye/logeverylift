import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";
import { testDatabaseUrl } from "../../../scripts/lib/local-test-db";

/**
 * Create the integration database if needed and bring it to the committed
 * migrations, the same SQL prod runs. A schema change without its migration
 * fails here, before any test.
 */
export default async function setup() {
  const url = new URL(testDatabaseUrl("logeverylift_int_test", process.env.TEST_DATABASE_URL));
  const name = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    // The name passed testDatabaseUrl's *_test check, so it is safe to inline.
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  } finally {
    await pool.end();
  }
}
