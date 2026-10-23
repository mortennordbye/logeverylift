import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";

// Deleting the worker's shared e2e account would break every later spec, so
// this one signs up an account of its own.
test.use({ storageState: { cookies: [], origins: [] } });

test("a new user can download their data and delete their account", async ({ page }, testInfo) => {
  const email = `delete-me-${testInfo.parallelIndex}-${Date.now()}@test.local`;
  const password = "correct-horse-battery";

  await page.goto("/signup");
  // Wait for hydration: a tap before it is a native form submit, not the
  // form's own handler.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name").fill("Delete Me");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  // A new account opens on the tutorial; dismiss it the way the e2e accounts are.
  await testDb().update(users).set({ tutorialDismissedAt: new Date() }).where(eq(users.email, email));

  await page.goto("/more/account");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download My Data/ }).click();
  const exported = JSON.parse(await readFile(await (await downloading).path(), "utf8"));
  expect(exported.user.email).toBe(email);

  await page.getByRole("button", { name: "Delete Account" }).click();
  const confirm = page.getByRole("button", { name: "Delete My Account" });
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByLabel('Type "DELETE" to confirm').fill("DELETE");
  await confirm.click();
  await expect(page.getByText(/invalid password/i)).toBeVisible();

  await page.getByLabel("Password").fill(password);
  await confirm.click();
  await page.waitForURL((url) => url.pathname === "/welcome");

  expect(await testDb().select().from(users).where(eq(users.email, email))).toEqual([]);
});
