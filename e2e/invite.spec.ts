import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { friendships, inviteTokens, users } from "../src/db/schema";
import { LEGAL_VERSION } from "../src/lib/constants/legal";
import { e2eUser } from "./fixtures/env";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";

// The invitee is signed out, on a device of their own: a separate client IP
// keeps their sign-in clear of Better Auth's per-IP limit, which the workers'
// own logins in auth.setup.ts have just used. The token belongs to the
// worker's e2e account.
test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" },
});

test("an invite link opens the front page and keeps the token through sign-up", async ({ page }, testInfo) => {
  const [inviter] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const token = `e2e-${randomUUID()}`;
  const tokenId = randomUUID();
  await testDb().insert(inviteTokens).values({ id: tokenId, token, createdBy: inviter.id, maxUses: 1 });
  const email = `invited-${testInfo.parallelIndex}-${Date.now()}@test.local`;

  try {
    await page.goto(`/welcome?token=${token}`);
    await expect(page.getByRole("heading", { name: /Log every lift/, level: 1 })).toBeVisible();
    // Every way to sign up from here keeps the token, including the sign-in
    // panel's "Create account" link.
    const signupLinks = page.locator('a[href^="/signup"]');
    await expect(signupLinks).toHaveCount(3);
    for (const href of await signupLinks.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      expect(href).toBe(`/signup?token=${token}`);
    }

    // Switching language must not lose the invite.
    await page.getByRole("link", { name: "NO" }).click();
    await page.waitForURL((url) => url.searchParams.get("lang") === "no");
    await page.getByRole("link", { name: "Få tidlig tilgang" }).first().click();
    await page.waitForURL((url) => url.pathname === "/signup");
    expect(new URL(page.url()).searchParams.get("token")).toBe(token);

    // Wait for hydration: a tap before it is a native form submit.
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Name").fill("Invited Friend");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
    await page.getByRole("checkbox", { name: /I consent to LogEveryLift storing/ }).check();
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    const [created] = await testDb().select().from(users).where(eq(users.email, email));
    expect(created.invitedById).toBe(inviter.id);
    expect(created.termsVersion).toBe(LEGAL_VERSION);
    expect(created.healthConsentAt).not.toBeNull();
    const [used] = await testDb().select().from(inviteTokens).where(eq(inviteTokens.id, tokenId));
    expect(used.usedCount).toBe(1);
  } finally {
    await testDb().delete(users).where(eq(users.email, email));
    await testDb().delete(inviteTokens).where(eq(inviteTokens.id, tokenId));
  }
});

test("signing up through a friend's share link sends them a friend request", async ({ page }, testInfo) => {
  const [inviter] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const code = `e2e${testInfo.parallelIndex}${Date.now()}`;
  await testDb().update(users).set({ friendCode: code }).where(eq(users.id, inviter.id));
  const email = `referred-${testInfo.parallelIndex}-${Date.now()}@test.local`;

  try {
    await page.goto(`/welcome?ref=${code}`);
    await page.locator(`a[href="/signup?ref=${code}"]`).first().click();
    await page.waitForURL((url) => url.pathname === "/signup");
    await expect(page.getByText("The person who invited you gets a friend request from you")).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.getByLabel("Name").fill("Referred Friend");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("checkbox", { name: /I accept the terms of use/ }).check();
    await page.getByRole("checkbox", { name: /I consent to LogEveryLift storing/ }).check();
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    const [created] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, email));
    const rows = await testDb().select().from(friendships).where(eq(friendships.requesterId, created.id));
    expect(rows).toEqual([expect.objectContaining({ addresseeId: inviter.id, status: "pending" })]);
  } finally {
    await testDb().delete(users).where(eq(users.email, email));
    await testDb().update(users).set({ friendCode: null }).where(eq(users.id, inviter.id));
  }
});
