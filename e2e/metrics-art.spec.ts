import { exercisePrs, exercises, users } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { e2eUser } from "./fixtures/env";
import { testDb } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * Progress shows each exercise's drawing next to its records. A custom
 * exercise whose name slugifies onto a drawn one ("Bench Press!") is not the
 * movement that was drawn, so it must keep the plain trophy.
 */
test("records show the exercise drawing for built-ins only", async ({ page }, testInfo) => {
  const db = testDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, e2eUser(testInfo.parallelIndex).email) });
  const [bench] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.name, "Bench Press"), eq(exercises.isCustom, false)));
  // Trailing punctuation keeps the slug "bench-press"; one "!" per worker keeps the name unique.
  const customName = `Bench Press${"!".repeat(testInfo.parallelIndex + 1)}`;
  const [custom] = await db
    .insert(exercises)
    .values({ name: customName, category: "strength", isCustom: true, userId: user!.id, muscleGroup: "chest" })
    .returning({ id: exercises.id });
  const now = Date.now();
  await db.insert(exercisePrs).values([
    { userId: user!.id, exerciseId: bench.id, prType: "weight", value: "100", achievedAt: new Date(now - 60_000) },
    { userId: user!.id, exerciseId: custom.id, prType: "weight", value: "90", achievedAt: new Date(now) },
  ]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/more/metrics?tab=records");

  // Newest first: the custom PR is the spotlight, so no drawing there.
  const latest = page.getByRole("region", { name: "Latest PR" });
  await expect(latest.getByText(customName, { exact: true })).toBeVisible();
  await expect(latest.getByRole("img")).toHaveCount(0);

  const rows = page.getByRole("listitem");
  await expect(rows.filter({ hasText: "100 kg" }).getByRole("img", { name: "Bench Press", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: customName }).getByRole("img")).toHaveCount(0);
});
