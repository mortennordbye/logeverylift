import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "./test-database";

/**
 * The URL of a test database, for the test runners' configs.
 *
 * `override` wins (E2E_DATABASE_URL / TEST_DATABASE_URL). CI gets the Postgres
 * service on localhost:5432. Locally there is deliberately no localhost:5432
 * default: on a laptop that port can be a tunnel to a remote database, and the
 * prepare steps create a database on whatever server they reach. Instead ask
 * Docker which host port the compose Postgres is published on.
 */
export function testDatabaseUrl(name: string, override: string | undefined): string {
  if (override) return assertTestDatabase(override).toString();
  if (process.env.CI) return `postgresql://postgres:postgres@localhost:5432/${name}`;

  let mapped = "";
  try {
    mapped = execFileSync("docker", ["compose", "-f", "docker-compose.yml", "port", "postgres", "5432"], {
      cwd: `${__dirname}/../..`,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Reported below.
  }
  const port = mapped.split(":").pop();
  if (!port) {
    throw new Error(
      "No test database: the compose Postgres is not running. Start it with `make dev`, " +
        "or set the URL of a *_test database explicitly.",
    );
  }
  return `postgresql://postgres:postgres@localhost:${port}/${name}`;
}
