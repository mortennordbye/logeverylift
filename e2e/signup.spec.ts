import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { inviteTokens, users } from "../src/db/schema";
import { LEGAL_VERSION } from "../src/lib/constants/legal";
import { e2eUser, signUpClientIp } from "./fixtures/env";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";

// Signed out, with a client IP of its own (signUpClientIp).
test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    await provide({ "x-forwarded-for": signUpClientIp(testInfo) });
  },
});

/**
 * Fail every Server Action sent once the new account is signed in, as a
 * dropped request or a navigation that cuts one off does. The consent the
 * user just gave must not depend on any of them.
 */
async function failActionsAfterSignIn(page: Page) {
  // Set before the page sees the sign-in answer, so every action it sends
  // after that is failed. (WebKit hides the cookie from route handlers.)
  let signedIn = false;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && /\/api\/auth\/sign-(up|in)\/email$/.test(req.url())) {
      const response = await route.fetch();
      if (response.ok()) signedIn = true;
      await route.fulfill({ response }).catch(() => {});
      return;
    }
    if (signedIn && req.method() === "POST" && req.headers()["next-action"]) {
      await route.abort("failed").catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });
}

async function fillAndSubmit(page: Page, email: string) {
  // Wait for hydration: a tap before it is a native form submit.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name").fill("New Lifter");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
  await page.getByRole("checkbox", { name: /I consent to LogEveryLift storing/ }).check();
  await page.getByRole("button", { name: "Create Account" }).click();
  // Not waitForURL: Next can restart the navigation to / when the redirect
  // cancels its own RSC fetch, and waitForURL fails on "Frame load interrupted".
  await expect(page).toHaveURL((url) => url.pathname === "/");
}

/** The consent is on the account, and home opens without asking for it again. */
async function expectConsentStored(page: Page, email: string) {
  const [row] = await testDb().select().from(users).where(eq(users.email, email));
  expect(row.termsVersion).toBe(LEGAL_VERSION);
  expect(row.policySeenVersion).toBe(LEGAL_VERSION);
  expect(row.termsAcceptedAt).not.toBeNull();
  expect(row.healthConsentAt).not.toBeNull();
  // Asked of the server directly: in the browser, home streams its redirect
  // to /consent after the URL already reads "/".
  const home = await page.request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(200);
  expect(await home.text()).not.toContain("NEXT_REDIRECT");
}

test("open sign-up stores the consent with the account, not in a later request", async ({ page }, testInfo) => {
  const email = `signup-${testInfo.parallelIndex}-${randomUUID()}@test.local`;
  try {
    await failActionsAfterSignIn(page);
    await page.goto("/signup");
    await fillAndSubmit(page, email);
    await expectConsentStored(page, email);
  } finally {
    await testDb().delete(users).where(eq(users.email, email));
  }
});

test("invite-token sign-up stores the consent with the account, not in a later request", async ({ page }, testInfo) => {
  const [inviter] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const token = `e2e-${randomUUID()}`;
  const tokenId = randomUUID();
  await testDb().insert(inviteTokens).values({ id: tokenId, token, createdBy: inviter.id, maxUses: 1 });
  const email = `signup-token-${testInfo.parallelIndex}-${randomUUID()}@test.local`;
  try {
    await failActionsAfterSignIn(page);
    await page.goto(`/signup?token=${token}`);
    await fillAndSubmit(page, email);
    await expectConsentStored(page, email);
  } finally {
    await testDb().delete(users).where(eq(users.email, email));
    await testDb().delete(inviteTokens).where(eq(inviteTokens.id, tokenId));
  }
});
