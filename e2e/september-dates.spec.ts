import { and, desc, eq } from "drizzle-orm";
import { workoutSessions } from "../src/db/schema";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { dismissReadinessSheet, programWorkoutHrefs } from "./helpers";

/**
 * A September date renders the same on the server and in the browser.
 *
 * Node's ICU writes an en-GB short September as "Sept", WebKit as "Sep". A
 * label made with toLocaleDateString therefore differed between the server
 * HTML and the first client render: React error #418 on every WebKit load,
 * which the shared fixture turns into a failure. The workout screen and the
 * program page both show the last session's date.
 */
test("the last session's September date hydrates on the workout screen and the program page", async ({ page }) => {
  const [href] = await programWorkoutHrefs(page);
  const programId = Number(href.match(/\/programs\/(\d+)\/workout/)![1]);
  const db = testDb();
  const [last] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.programId, programId), eq(workoutSessions.isCompleted, true)))
    .orderBy(desc(workoutSessions.startTime))
    .limit(1);
  // The note makes the card show; the date is the label under test.
  await db.update(workoutSessions).set({ date: "2026-09-03", notes: "September check" }).where(eq(workoutSessions.id, last.id));

  await page.goto(href);
  await dismissReadinessSheet(page);
  await expect(page.getByText("September check")).toBeVisible();
  await expect(page.getByText(/· 3 Sep\b/)).toBeVisible();

  await page.goto(`/programs/${programId}`);
  await expect(page.getByText("September check")).toBeVisible();
  await expect(page.getByText(/· 3 Sep\b/)).toBeVisible();
});
