import { eq } from "drizzle-orm";
import { seasons, trainingCycles, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Every Plan form screen pins its primary button to the bottom. The tab bar
 * sits in the same place, so a form screen shows no tab bar (not even
 * hidden behind the bar, where its links still take focus) and nothing
 * covers the pinned button (docs/design/plan-redesign/spec.md).
 */

const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("no Plan form screen shows the tab bar over its pinned button", async ({ page }, testInfo) => {
  const db = testDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const [season] = await db.insert(seasons).values({ userId: user.id, name: "Bar season", startDate: isoDay(7), endDate: isoDay(200) }).returning();
  const [phase] = await db
    .insert(trainingCycles)
    .values({ userId: user.id, name: "Bar phase", durationWeeks: 4, seasonId: season.id, phaseOrder: 1 })
    .returning();
  const [cycle] = await db.insert(trainingCycles).values({ userId: user.id, name: "Bar block", durationWeeks: 4 }).returning();

  const forms: [string, string][] = [
    ["/cycles/new", "Build the week"],
    [`/cycles/${cycle.id}/edit`, "Save"],
    ["/seasons/new", "Create season"],
    [`/seasons/${season.id}/edit`, "Save"],
    [`/seasons/${season.id}/phases/new`, "Build the week"],
    [`/seasons/${season.id}/phases/${phase.id}/week`, "Add phase"],
  ];
  for (const [path, label] of forms) {
    await page.goto(path);
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button, path).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll("/", "_")}.png`) });
    await expect(page.getByRole("link", { name: "Programs" }), `${path} shows the tab bar`).toBeHidden();
    // The pinned button is the top element at its own centre: nothing covers it.
    const onTop = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit != null && el.contains(hit);
    });
    expect(onTop, `${path}: the pinned button is covered`).toBe(true);
  }
});
