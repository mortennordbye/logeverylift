import { eq } from "drizzle-orm";
import { exerciseNotes, programExercises, programs, users } from "../src/db/schema";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The exercise detail screen grew an illustration and a muscle map, which made
 * it taller than a phone. Scrolled all the way down, its last row must clear
 * the bottom nav; it used to end under it, so the bottom of the page could not
 * be reached.
 */
test("the exercise detail scrolls its last row clear of the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/exercises");
  // Text typed before hydration lands in the input without filtering the
  // list, so type until the result row shows up.
  const search = page.getByRole("textbox", { name: "Search" });
  const row = page.getByRole("button", { name: /^Barbell Curl/ }).first();
  await expect(async () => {
    await search.fill("");
    await search.fill("Barbell Curl");
    await expect(row).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await row.click();
  await expect(page.getByRole("img", { name: /Barbell Curl, front view/ })).toBeVisible();

  const lastRow = page.getByText("Movement", { exact: true });
  await expect
    .poll(async () => {
      // Scroll the page's scroller to its end (mobile WebKit has no wheel
      // events). Inside the poll, so late layout (fonts, the drawing) can't
      // leave the measurement short of the real end.
      await lastRow.evaluate((el) => {
        const scroller = el.closest(".overflow-y-auto");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      const row = await lastRow.locator("..").boundingBox();
      const nav = await page.getByRole("navigation").boundingBox();
      return row && nav ? nav.y - (row.y + row.height) : -1;
    })
    .toBeGreaterThanOrEqual(8);
});

/**
 * The library links each exercise to its own page: progress, records,
 * history, and a note the lifter keeps on it.
 */
test("the library opens an exercise page whose note saves", async ({ page }, testInfo) => {
  await page.goto("/exercises");
  const search = page.getByRole("textbox", { name: "Search" });
  const row = page.getByRole("button", { name: /^Barbell Curl/ }).first();
  await expect(async () => {
    await search.fill("");
    await search.fill("Barbell Curl");
    await expect(row).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await row.click();
  await page.getByRole("link", { name: "History, records and notes" }).click();

  await expect(page).toHaveURL(/\/exercises\/\d+$/);
  // Scoped to the new page: for a moment the library's own "Barbell Curl"
  // heading is still sliding out underneath.
  await expect(page.getByRole("main").getByRole("heading", { name: "Barbell Curl", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Records" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

  const note = page.getByRole("textbox", { name: "Your note" });
  await note.fill("Elbows pinned");
  await note.blur();

  const [user] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  await expect
    .poll(async () => {
      const rows = await testDb()
        .select({ note: exerciseNotes.note })
        .from(exerciseNotes)
        .where(eq(exerciseNotes.userId, user.id));
      return rows.map((r) => r.note);
    })
    .toEqual(["Elbows pinned"]);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Your note" })).toHaveValue("Elbows pinned");
});

/**
 * The exercise title on the workout's sets screen opens the exercise page,
 * and Back returns to the workout.
 */
test("the workout's exercise title opens its page and Back returns", async ({ page }, testInfo) => {
  const [user] = await testDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, e2eUser(testInfo.parallelIndex).email));
  const [slot] = await testDb()
    .select({ id: programExercises.id, programId: programExercises.programId, exerciseId: programExercises.exerciseId })
    .from(programExercises)
    .innerJoin(programs, eq(programs.id, programExercises.programId))
    .where(eq(programs.userId, user.id))
    .limit(1);
  const workoutUrl = `/programs/${slot.programId}/workout/exercises/${slot.id}`;

  await page.goto(workoutUrl);
  await page.getByRole("heading", { level: 1 }).getByRole("link").click();

  await expect(page).toHaveURL(new RegExp(`/exercises/${slot.exerciseId}$`));
  await expect(page.getByRole("main").getByRole("heading", { name: "Records" })).toBeVisible();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${workoutUrl}$`));
});
