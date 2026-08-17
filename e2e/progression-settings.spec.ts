import { test, expect } from "@playwright/test";
import { openFirstExercise, openWorkout } from "./helpers";

/**
 * Per-exercise progression gate and the plan opt-in.
 *
 * Covers the two settings that only exist server-side: how many sessions at
 * target are needed before a bump is suggested, and whether taking a bump
 * rewrites the planned sets. Both are columns on program_exercises, so this
 * spec also fails loudly if the migration hasn't been applied — a unit test
 * can't catch that, and the symptom in production is a 500 on tapping a pill.
 *
 * The rule sentence is asserted alongside them because it is built from the
 * live settings: if it doesn't move when the gate does, the sheet is lying
 * about what the app will actually do.
 *
 * Restores both settings at the end so re-runs start from the same state.
 */
test("progression gate and plan opt-in persist across a reload", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);

  const openSheet = async () => {
    await page.getByRole("button", { name: "Progression settings" }).click();
    await expect(page.getByText("Progression", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  };

  await openSheet();

  // Weight mode: reps stay put, only the load moves. Also the only mode where
  // the gate copy mentions a rep target.
  await page.getByRole("button", { name: /^Weight/ }).click();

  const gate = page.getByRole("group", { name: "Sessions at target" });
  await expect(gate).toBeVisible({ timeout: 5_000 });

  // The rule sentence quotes the live gate.
  await expect(page.getByText(/2 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });

  await gate.getByRole("button", { name: "3", exact: true }).click();
  await expect(page.getByText(/3 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });

  const applyToPlan = page.getByRole("switch");
  await expect(applyToPlan).toHaveAttribute("aria-checked", "false");
  await applyToPlan.click();
  await expect(applyToPlan).toHaveAttribute("aria-checked", "true");

  // Round-trip through the server: reload drops all client state, so anything
  // still set below came back out of the database.
  await page.reload();
  await openSheet();
  await expect(page.getByText(/3 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");

  // Restore.
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await page
    .getByRole("group", { name: "Sessions at target" })
    .getByRole("button", { name: "2", exact: true })
    .click();
  await expect(page.getByText(/2 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });
});
