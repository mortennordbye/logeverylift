import { test, expect } from "@playwright/test";
import {
  openFirstExercise,
  openFirstSetEditor,
  openWorkout,
  tapAndSave,
} from "./helpers";

/**
 * Logging a set that fell short.
 *
 * A short tap on the toggle claims the prescription, which is honest — the
 * lifter tapped it. A long press opens the miss sheet, and what it records has
 * to reach the database as the *achieved* count while the prescription stands.
 * Writing the achieved count into `target_reps` was the trap this covers: the
 * set then logged a perfect hit against a target the lifter had just lowered,
 * and the progression engine never saw a miss.
 *
 * The row is the proxy for both columns. "8 x 60kg" is `target_reps` and does
 * not move; the "· 6/8" beside it is `actual_reps`.
 *
 * Idempotent: the set is un-logged at the end and its achieved count put back
 * to the target, so the row is left as it was found.
 */
test("a long press logs the reps achieved without moving the target", async ({
  page,
}) => {
  await openWorkout(page);
  await openFirstExercise(page);

  const prescription = page.locator("p.text-lg.font-medium").first();
  await expect(prescription).toBeVisible({ timeout: 10_000 });
  const before = (await prescription.innerText()).trim();
  const target = Number(before.match(/^(\d+)\s/)?.[1]);
  if (!Number.isFinite(target) || target < 3) {
    throw new Error(
      `First set of the first exercise is not a rep-based set with room to ` +
        `fall short (read "${before}"). The seed puts Bench Press first — ` +
        "re-run `docker-compose exec app pnpm db:seed-fake --force`.",
    );
  }

  const toggle = page.locator("button.w-7.h-7.rounded-full").first();
  await expect(toggle).toHaveClass(/bg-transparent/);

  // Long press. `click({ delay })` is not enough: the handler runs off
  // pointerdown and a 450ms timer, so the press has to be held open.
  const press = async () => {
    const box = await toggle.boundingBox();
    if (!box) throw new Error("Set toggle has no box to press");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  };

  await press();

  // The sheet, and the press that opened it must not also have logged the set.
  await expect(page.getByText("Reps done")).toBeVisible({ timeout: 5_000 });
  await expect(toggle).toHaveClass(/bg-transparent/);

  const fewer = page.getByRole("button", { name: "One rep fewer" });
  await fewer.click();
  await fewer.click();
  await expect(page.getByText(`2 short of ${target}`)).toBeVisible();

  await tapAndSave(page, page.getByRole("button", { name: "Log set" }), {
    bodyIncludes: '"actualReps":',
  });

  // Logged, short, and the prescription is untouched.
  await expect(toggle).toHaveClass(/bg-primary/);
  await expect(prescription).toContainText(`${target - 2}/${target}`);
  await expect(prescription).toContainText(before);

  // Cleanup: un-log, put the achieved count back to the target, un-log again.
  await toggle.click();
  await expect(toggle).toHaveClass(/bg-transparent/);
  await press();
  const more = page.getByRole("button", { name: "One rep more" });
  await more.click();
  await more.click();
  await tapAndSave(page, page.getByRole("button", { name: "Log set" }), {
    bodyIncludes: '"actualReps":',
  });
  await toggle.click();
  await expect(toggle).toHaveClass(/bg-transparent/);
});

/**
 * The same miss, typed into the set editor instead. Fewer reps than planned
 * keeps the target and shows "6/8"; it must not re-prescribe the set, or the
 * miss reads as a hit and the plan drops a rep. Checked again after a reload,
 * which re-reads `program_sets.target_reps` from the server.
 *
 * Idempotent: the reps are put back to the target, which writes nothing to
 * the program.
 */
test("editing reps below the target records a miss and keeps the target", async ({
  page,
}) => {
  // Two trips through the set editor and a reload: more than the default 30s.
  test.setTimeout(90_000);
  await openWorkout(page);
  await openFirstExercise(page);

  const prescription = page.locator("p.text-lg.font-medium").first();
  await expect(prescription).toBeVisible({ timeout: 10_000 });
  const before = (await prescription.innerText()).trim();
  const target = Number(before.match(/^(\d+)\s/)?.[1]);
  if (!Number.isFinite(target) || target < 3) {
    throw new Error(
      `First set of the first exercise is not a rep-based set with room to ` +
        `fall short (read "${before}").`,
    );
  }

  // Until the slide ends, the outgoing page sits over the incoming one and
  // takes its taps.
  const settled = () => expect(page.locator(".page-layer")).toHaveCount(1);
  const setReps = async (n: number) => {
    await openFirstSetEditor(page);
    await settled();
    await page.getByRole("button", { name: /^Reps done/ }).click();
    // Picking a circle sets the reps and closes the sheet.
    await page.getByRole("button", { name: String(n), exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(prescription).toBeVisible({ timeout: 10_000 });
    await settled();
  };

  await setReps(target - 2);
  await expect(prescription).toContainText(before);
  await expect(prescription).toContainText(`${target - 2}/${target}`);

  await page.reload();
  await expect(prescription).toBeVisible({ timeout: 10_000 });
  await expect(prescription).toContainText(before);

  // Cleanup: back to the target, which is neither a miss nor a re-prescription.
  await setReps(target);
  await expect(prescription).not.toContainText("/");
});
