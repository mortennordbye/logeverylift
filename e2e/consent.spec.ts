import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { CONSENT_VERSION, LEGAL_VERSION } from "../src/lib/constants/legal";
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

test("tells a user once that the policy changed, without asking them to accept again", async ({ page }, testInfo) => {
  const email = e2eUser(testInfo.parallelIndex).email;
  await testDb()
    .update(users)
    .set({ termsVersion: CONSENT_VERSION, policySeenVersion: "2000-01-01" })
    .where(eq(users.email, email));

  await page.goto("/");
  const notice = page.getByText("We updated the privacy policy");
  await expect(notice).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toBeHidden();

  const [row] = await testDb().select().from(users).where(eq(users.email, email));
  expect(row.policySeenVersion).toBe(LEGAL_VERSION);
  expect(row.termsVersion).toBe(CONSENT_VERSION);
  await page.reload();
  await expect(page.getByRole("heading", { name: "LogEveryLift" })).toBeVisible();
  await expect(notice).toBeHidden();
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

// Before React hydrates, a tap on Sign In is a native form submit. Without
// method="post" that is a GET with the password in the URL, where Cloudflare,
// the server log and browser history keep it.
test("the server-rendered login form posts rather than gets", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const html = await (await request.get("/login")).text();
  await request.dispose();
  const forms = html.match(/<form[^>]*>/g) ?? [];
  expect(forms.length).toBeGreaterThan(0);
  for (const form of forms) expect(form).toMatch(/method="post"/);
});
