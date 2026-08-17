import { test, expect, type Locator, type Page } from "@playwright/test";
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

/**
 * Tap a control that saves through a Server Action, and wait for the write.
 *
 * Both settings render optimistically, so the UI reports the new value before
 * the round trip finishes. Reloading on the strength of that alone cancels the
 * in-flight action, and the assertion after the reload then fails as if the
 * write had been rejected. Waiting for the POST makes the persistence claim
 * real rather than a race the test usually wins.
 */
async function tapAndSave(page: Page, control: Locator) {
  // Match on the next-action header rather than "any POST": router.refresh()
  // fires its own traffic, and a looser predicate lets one tap's wait be
  // satisfied by the previous tap's response — which reintroduces exactly the
  // race this helper exists to remove.
  const isAction = (r: { method(): string; headers(): Record<string, string> }) =>
    r.method() === "POST" && Boolean(r.headers()["next-action"]);

  for (let attempt = 0; attempt < 2; attempt++) {
    // Registered before the click, so it can only match a request this click
    // starts — never one already in flight.
    const sent = page.waitForRequest(isAction, { timeout: 8_000 }).catch(() => null);
    await control.click();
    const request = await sent;
    if (!request) continue; // tap dropped mid-refresh; the repo sees this on WebKit
    const response = await request.response();
    expect(response?.status(), "settings write must reach the server").toBeLessThan(400);
    // response() resolves when the headers land, and a Server Action's flight
    // response can start streaming before the action finishes. Reloading on
    // that alone kills the request mid-write.
    await response?.finished();
    return;
  }
  throw new Error("tap never produced a Server Action request");
}

test("progression gate and plan opt-in persist across a reload", async ({ page }) => {
  await openWorkout(page);
  await openFirstExercise(page);

  const openSheet = async () => {
    await page.getByRole("button", { name: "Progression settings" }).click();
    await expect(page.getByText("Progression", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  };
  const gate = () => page.getByRole("group", { name: "Sessions at target" });

  await openSheet();

  // Weight mode: reps stay put, only the load moves. Also the only mode where
  // the gate copy mentions a rep target.
  await tapAndSave(page, page.getByRole("button", { name: /^Weight/ }));

  await expect(gate()).toBeVisible({ timeout: 5_000 });

  // The rule sentence quotes the live gate.
  await expect(page.getByText(/2 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });

  await tapAndSave(page, gate().getByRole("button", { name: "3", exact: true }));
  await expect(page.getByText(/3 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });

  const applyToPlan = page.getByRole("switch");
  await expect(applyToPlan).toHaveAttribute("aria-checked", "false");
  await tapAndSave(page, applyToPlan);
  await expect(applyToPlan).toHaveAttribute("aria-checked", "true");

  // Round-trip through the server: reload drops all client state, so anything
  // still set below came back out of the database.
  await page.reload();
  await openSheet();
  await expect(page.getByText(/3 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");

  // Restore, and prove the restore itself persisted — these settings live on
  // the shared program, so a silent failure here leaks into every later run.
  await tapAndSave(page, page.getByRole("switch"));
  await tapAndSave(page, gate().getByRole("button", { name: "2", exact: true }));
  await page.reload();
  await openSheet();
  await expect(page.getByText(/2 of the last 5 sessions/)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});
