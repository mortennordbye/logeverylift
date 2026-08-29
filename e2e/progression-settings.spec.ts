import { test, expect } from "@playwright/test";
import { openFirstExercise, openWorkout, tapAndSave } from "./helpers";

/**
 * The progression sheet's three layers, end to end.
 *
 * Covers the settings that only exist server-side — the preset's axis values,
 * the gate, and whether taking a bump rewrites the planned sets — so this spec
 * also fails loudly if a migration hasn't been applied. A unit test can't catch
 * that, and the symptom in production is a 500 on tapping a pill.
 *
 * The rule sentence is asserted alongside them because it is generated from the
 * live axis values: if it doesn't move when a control does, the sheet is lying
 * about what the app will actually do, which is the one thing layer 2 exists to
 * prevent.
 *
 * Restores the exercise to Load, confirmed with the plan opt-in off at the end,
 * so re-runs start from the same state. These settings live on a shared program.
 */
test("preset, gate and plan opt-in persist across a reload", async ({ page }) => {
  // Several settings writes, each waited out to completion, plus two reloads
  // and the sheet reopening after each — more than the default 30s budget.
  test.setTimeout(120_000);
  await openWorkout(page);
  await openFirstExercise(page);

  const openSheet = async () => {
    await page.getByRole("button", { name: "Progression settings" }).click();
    await expect(page.getByText("Progression", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  };
  const openAdvanced = async () => {
    const toggle = page.getByRole("button", { name: "Advanced" });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
  };
  const gate = () => page.getByRole("group", { name: "Sessions at target" });

  await openSheet();

  // ── Layer 1: the preset writes every axis in one tap ──────────────────────
  // Load, confirmed is fixed reps, gate 2, back off 10% after 3.
  await tapAndSave(page, page.getByRole("button", { name: /^Load, confirmed/ }), {
    bodyIncludes: '"advance":"load"',
  });

  // ── Layer 2: the sentence quotes the axes it just wrote ───────────────────
  await expect(page.getByText(/2 sessions in a row/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/Back off 10% after 3 workouts/)).toBeVisible({
    timeout: 5_000,
  });

  // ── Layer 3: an individual axis, and the relabel to Custom ────────────────
  await openAdvanced();
  await expect(gate()).toBeVisible({ timeout: 5_000 });
  await tapAndSave(page, gate().getByRole("button", { name: "3", exact: true }), {
    bodyIncludes: '"requiredHits":3',
  });
  await expect(page.getByText(/3 sessions in a row/)).toBeVisible({
    timeout: 5_000,
  });
  // A gate of 3 matches no preset, so the badge says so. This is the whole
  // point of deriving the label rather than storing it.
  await expect(page.getByText("Custom", { exact: true }).first()).toBeVisible({
    timeout: 5_000,
  });

  // Scope, which had no control at all until this phase.
  const scope = () => page.getByRole("group", { name: "Which sets have to clear" });
  await tapAndSave(page, scope().getByRole("button", { name: "First set" }), {
    bodyIncludes: '"scope":"first"',
  });
  await expect(page.getByText(/the first set/)).toBeVisible({ timeout: 5_000 });

  const applyToPlan = page.getByRole("switch");
  await expect(applyToPlan).toHaveAttribute("aria-checked", "false");
  await tapAndSave(page, applyToPlan, { bodyIncludes: '"applyToPlan":true' });
  await expect(applyToPlan).toHaveAttribute("aria-checked", "true");

  // Round-trip through the server: reload drops all client state, so anything
  // still set below came back out of the database.
  await page.reload();
  await openSheet();
  await expect(page.getByText(/3 sessions in a row/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/the first set/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");

  // Restore, and prove the restore itself persisted — a silent failure here
  // leaks into every later run.
  await tapAndSave(page, page.getByRole("switch"), {
    bodyIncludes: '"applyToPlan":false',
  });
  await tapAndSave(page, page.getByRole("button", { name: /^Load, confirmed/ }), {
    bodyIncludes: '"advance":"load"',
  });
  await page.reload();
  await openSheet();
  await expect(page.getByText(/2 sessions in a row/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/every set/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});
