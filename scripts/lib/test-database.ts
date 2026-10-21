/**
 * Guard for anything that writes to or wipes a database on the tests' behalf.
 *
 * Test code deletes rows freely, so it only accepts a database whose name ends
 * in `_test`. That one check is what stops a DATABASE_URL left pointing at the
 * dev database, or at a tunnel to prod, from being emptied by a test run.
 */
export function assertTestDatabase(raw: string | undefined): URL {
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to use database "${name}": test databases must be named *_test ` +
        "(lowercase letters, digits, underscores).",
    );
  }
  return url;
}
