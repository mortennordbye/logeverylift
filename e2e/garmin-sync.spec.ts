import { eq } from "drizzle-orm";
import { athleteThresholds, garminConnections, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * "Sync from Garmin" on Account (docs/plans/account-profile.md, 6): a Premium
 * user sees the switch and where a synced threshold came from; any other user
 * sees no Garmin text at all.
 */

async function withSyncedFtp(workerIndex: number, role: "admin" | "user") {
  const db = testDb();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, e2eUser(workerIndex).email));
  await db.update(users).set({ role }).where(eq(users.id, u.id));
  await db.insert(garminConnections).values({ userId: u.id, encryptedKey: "e2e", lastSyncedAt: new Date(), historyDone: true, recentDetailAt: new Date(), syncFromGarmin: true });
  await db.insert(athleteThresholds).values({ userId: u.id, kind: "ftp", value: 262, measuredOn: "2026-11-01", source: "garmin" });
  return u.id;
}

test("a Premium user sees the switch and the From Garmin line", async ({ page, context }, testInfo) => {
  const uid = await withSyncedFtp(testInfo.parallelIndex, "admin");
  // Better Auth caches the session, role included, in a cookie; drop it so the new role is read.
  await context.clearCookies({ name: /session_data/ });

  await page.goto("/more/account/training-numbers");
  await expect(page.getByTestId("account-threshold-ftp")).toContainText("262 W");
  await expect(page.getByTestId("account-threshold-ftp-note")).toContainText("From Garmin · Sun 1 Nov");

  await page.goto("/more/account");
  await expect(page.getByTestId("account-group-training-numbers")).toContainText("FTP 262 W");
  const sync = page.getByRole("switch", { name: /Sync from Garmin/ });
  await expect(sync).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Keeps body weight, max HR, threshold HR, FTP, run pace, availability, time zone and units up to date/)).toBeVisible();

  // Tracked from here: an on-load action the goto above cut off never reports as finished.
  const settle = trackActions(page);
  await sync.click();
  await settle();
  await expect(sync).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () => (await testDb().select({ on: garminConnections.syncFromGarmin }).from(garminConnections).where(eq(garminConnections.userId, uid)))[0].on)
    .toBe(false);
});

test("a user without Premium sees no Garmin text", async ({ page, context }, testInfo) => {
  await withSyncedFtp(testInfo.parallelIndex, "user");
  // A role cached in the session cookie by an earlier spec must not count.
  await context.clearCookies({ name: /session_data/ });

  await page.goto("/more/account");
  await expect(page.getByTestId("account-group-training-numbers")).toContainText("FTP 262 W");
  await expect(page.getByRole("switch", { name: /Sync from Garmin/ })).toHaveCount(0);
  await expect(page.getByText(/Garmin/)).toHaveCount(0);

  await page.goto("/more/account/training-numbers");
  await expect(page.getByTestId("account-threshold-ftp")).toContainText("262 W");
  await expect(page.getByTestId("account-threshold-ftp-note")).toContainText("Sun 1 Nov");
  await expect(page.getByText(/Garmin/)).toHaveCount(0);
});
