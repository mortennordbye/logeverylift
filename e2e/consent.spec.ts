import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { LEGAL_VERSION } from "../src/lib/constants/legal";
import { e2eUser } from "./fixtures/env";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";

test("asks a user behind on the terms to accept them before home", async ({ page }, testInfo) => {
  const email = e2eUser(testInfo.parallelIndex).email;
  await testDb().update(users).set({ termsVersion: "2000-01-01" }).where(eq(users.email, email));

  await page.goto("/");
  await page.waitForURL((url) => url.pathname === "/consent");
  await expect(page.getByRole("heading", { name: "Updated terms" })).toBeVisible();
  const accept = page.getByRole("button", { name: "Continue" });
  await expect(accept).toBeDisabled();

  await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
  await page.getByRole("checkbox", { name: /I consent to LogEveryLift storing/ }).check();
  await accept.click();
  await page.waitForURL((url) => url.pathname === "/");

  const [row] = await testDb().select().from(users).where(eq(users.email, email));
  expect(row.termsVersion).toBe(LEGAL_VERSION);
});

test("the privacy policy and terms are readable signed out", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  for (const [path, heading] of [["/privacy", "Privacy policy"], ["/terms", "Terms of use"]]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText("LogEveryLift is in early access")).toBeVisible();
  }
  await context.close();
});
