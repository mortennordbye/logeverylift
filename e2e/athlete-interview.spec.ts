import { and, asc, eq } from "drizzle-orm";
import { athleteInjuries, athleteProfiles, athleteThresholds, coachMemory, planRevisions, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";
import { trackActions } from "./helpers";

/**
 * The intake interview (docs/plans/athlete-profile.md, 2.6): a user with the
 * endurance switch on answers each step; each answer is a row and a revision
 * written as the user, all in one change set, and a coach memory entry about
 * an injury moves to the profile and goes out of use.
 */

async function userId(parallelIndex: number) {
  const [user] = await testDb().select({ id: users.id }).from(users).where(eq(users.email, e2eUser(parallelIndex).email));
  return user.id;
}

test("run the intake interview", async ({ page }, testInfo) => {
  const settle = trackActions(page);
  const uid = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, uid));
  const [mem] = await testDb()
    .insert(coachMemory)
    .values({ userId: uid, kind: "observation", text: "Left knee sore after runs over 90 min", entryDate: "2026-10-20" })
    .returning();

  await page.goto("/more");
  await page.getByRole("link", { name: /Athlete profile/ }).click();
  await expect(page).toHaveURL(/\/more\/athlete$/);
  await page.getByRole("link", { name: "Start the interview" }).click();
  await expect(page.getByTestId("interview-progress")).toHaveText("Step 1 of 8");

  // 1. Race: none set yet.
  await expect(page.getByTestId("interview-race")).toContainText("No race set");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 2. Experience.
  await page.getByRole("radio", { name: /Intermediate/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();
  await expect(page.getByTestId("interview-progress")).toHaveText("Step 3 of 8");

  // 3. Availability.
  for (const d of ["Mon", "Tue", "Thu", "Sat", "Sun"]) await page.getByRole("button", { name: `Train on ${d}` }).click();
  await page.getByRole("button", { name: "More: Hours in a normal week" }).click();
  await page.getByRole("button", { name: "Long day Sun" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();

  // 4. Strength goal.
  await page.getByRole("radio", { name: /Get stronger/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await settle();
  await expect(page.getByTestId("interview-progress")).toHaveText("Step 5 of 8");

  // 5. Thresholds: swim CSS from the 400/200 test.
  await page.getByTestId("interview-threshold-swim_css").click();
  await page.getByRole("radio", { name: "400 m and 200 m swim test" }).click();
  await page.getByRole("textbox", { name: "400 m time" }).fill("6:40");
  await page.getByRole("textbox", { name: "200 m time" }).fill("3:10");
  await expect(page.getByTestId("threshold-preview")).toHaveText("Swim CSS: 1:45 /100m");
  await page.getByRole("button", { name: "Save Swim CSS" }).click();
  await settle();
  await expect(page.getByTestId("interview-threshold-swim_css")).toContainText("1:45 /100m");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 6. Injuries.
  await page.getByRole("button", { name: "Add an injury" }).click();
  await page.getByRole("combobox", { name: "Where" }).selectOption("knee");
  await page.getByRole("radio", { name: "Left" }).click();
  await page.getByRole("textbox", { name: "What happens" }).fill("Sore after runs over 90 min");
  await page.getByRole("textbox", { name: "What to avoid" }).fill("No long downhill runs");
  await page.getByRole("radio", { name: "I live with it" }).click();
  await page.getByRole("button", { name: "Save injury" }).click();
  await settle();
  await expect(page.getByTestId("injury-row")).toContainText("Sore after runs over 90 min");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 7. From coach memory: moved.
  await expect(page.getByTestId("interview-memory")).toContainText("Left knee sore");
  await page.getByRole("button", { name: "Moved", exact: true }).click();
  await settle();
  await expect(page.getByTestId("interview-memory")).toContainText("no longer in use");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // 8. Finish.
  await expect(page.getByTestId("interview-progress")).toHaveText("Step 8 of 8");
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await settle();
  await expect(page).toHaveURL(/\/more\/athlete$/);
  await expect(page.getByRole("link", { name: "Run the interview again" })).toBeVisible();

  const db = testDb();
  const [profile] = await db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, uid));
  expect(profile).toMatchObject({
    enduranceLevel: "intermediate",
    availableDays: [1, 2, 4, 6, 7],
    hoursPerWeek: 8.5,
    longDay: 7,
    strengthGoal: "stronger",
  });
  expect(profile.interviewCompletedAt).not.toBeNull();
  const [css] = await db.select().from(athleteThresholds).where(eq(athleteThresholds.userId, uid));
  expect(css).toMatchObject({ kind: "swim_css", source: "test", protocol: "css_400_200", testData: { t400Seconds: 400, t200Seconds: 190 } });
  const [knee] = await db.select().from(athleteInjuries).where(eq(athleteInjuries.userId, uid));
  expect(knee).toMatchObject({ area: "knee", side: "left", status: "managed", avoid: "No long downhill runs" });
  const [memAfter] = await db.select().from(coachMemory).where(eq(coachMemory.id, mem.id));
  expect(memAfter.active).toBe(false);

  const revs = await db
    .select({ type: planRevisions.objectType, action: planRevisions.action, writer: planRevisions.writer, changeSetId: planRevisions.changeSetId })
    .from(planRevisions)
    .where(and(eq(planRevisions.userId, uid)))
    .orderBy(asc(planRevisions.id));
  const interview = revs.filter((r) => r.changeSetId?.startsWith("interview:"));
  expect(new Set(interview.map((r) => r.changeSetId)).size).toBe(1);
  expect(new Set(interview.map((r) => r.type))).toEqual(new Set(["athlete", "threshold", "injury", "memory"]));
  expect(interview.every((r) => r.writer === "user")).toBe(true);
});

test("the triathlon plan sends a user without the interview to it", async ({ page }, testInfo) => {
  const uid = await userId(testInfo.parallelIndex);
  await testDb().update(users).set({ enduranceEnabled: true }).where(eq(users.id, uid));
  await page.goto("/cycles/triathlon");
  await expect(page).toHaveURL(/\/more\/athlete\/interview\?next=%2Fcycles%2Ftriathlon|\/more\/athlete\/interview\?next=\/cycles\/triathlon/);
  await expect(page.getByTestId("interview-progress")).toHaveText("Step 1 of 7");
});
