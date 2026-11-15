import type { Page } from "@playwright/test";
import { trainingCycleSlots } from "../src/db/schema";
import { asc, eq } from "drizzle-orm";
import { expect, test } from "./fixtures/test";
import { testDb } from "./fixtures/reset";

/**
 * The plan builder under the AI coach hub (docs/plans/ai-coach-hub.md):
 * building a plan from picks, starting it, and the parts of the AI edit flow
 * that don't need a model.
 *
 * A user's AI edit only reads saved answers; an admin's miss calls free
 * models, which is not driven here: src/__tests__/ai-edit.test.ts covers the
 * action against a mocked model and ai-responses.test.ts replays real model
 * output. These specs cover what only a browser can: the picks, the preview,
 * the import, and restoring an edit that finished after the user left.
 *
 * The import spec deletes the cycle and programs it creates, so the test
 * account doesn't fill up with "Upper A 7" across runs.
 */

async function openAiSetup(page: Page) {
  await page.goto("/more/ai-setup");
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  // Picks are client state: wait for hydration so a tap isn't lost.
  await expect(page.getByRole("radiogroup", { name: "Goal" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** Opens "More options" on the picks, where the rarer picks live. */
async function openMoreOptions(page: Page) {
  const more = page.getByRole("button", { name: /More options/ });
  await expect(async () => {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
  }).toPass({ timeout: 10_000 });
}

/** Taps Build and waits out the "Building your plan" screen. */
async function build(page: Page, ready: ReturnType<Page["getByText"]>) {
  // Assert the outcome and retry the tap, like pick(): a WebKit tap can focus
  // the button without its click handler running (seen once in CI).
  await expect(async () => {
    await page.getByRole("button", { name: "Build my plan" }).click();
    await expect(page.getByText("Building your plan")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(ready).toBeVisible({ timeout: 10_000 });
}

async function pick(page: Page, group: string, name: string) {
  const option = page.getByRole("radiogroup", { name: group }).getByRole("radio", { name, exact: true });
  await expect(async () => {
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
  }).toPass({ timeout: 10_000 });
}

test("builds a plan from picks, previews it, and imports it", async ({ page }) => {
  test.setTimeout(120_000);
  await openAiSetup(page);

  await pick(page, "Goal", "Build muscle");
  await pick(page, "Experience", "Intermediate");
  await pick(page, "Days per week", "2");
  await pick(page, "Equipment", "Dumbbells");
  await openMoreOptions(page);
  await pick(page, "Training days", "Choose days");
  const weekdays = page.getByRole("group", { name: "Weekdays" });
  await weekdays.getByRole("button", { name: "Tue" }).click();
  await weekdays.getByRole("button", { name: "Sat" }).click();
  await expect(weekdays.getByRole("button", { name: "Mon" })).toBeDisabled();
  await pick(page, "Session length", "45 min");
  await pick(page, "Split", "Upper/Lower");
  await pick(page, "Cycle length", "16 wk");
  await page.getByRole("group", { name: "Go easy on" }).getByRole("button", { name: "Knees" }).click();

  await build(page, page.getByText("16-Week Upper/Lower"));

  // The preview: the cycle on the chosen weekdays, every exercise listed.
  await expect(page.getByText(/^Tue Upper A.* · Sat Lower A/)).toBeVisible();
  const body = await page.locator("body").innerText();
  const lines = body.split("\n").map((l) => l.trim());
  expect(lines).toContain("Dumbbell Bench Press");
  // Dumbbells only, and nothing hard on the knees.
  for (const banned of ["Squat", "Bench Press", "Barbell Row", "Leg Press", "Goblet Squat", "Bulgarian Split Squat", "Reverse Lunge"]) {
    expect(lines).not.toContain(banned);
  }
  // Every session estimate fits the 45-minute pick.
  for (const minutes of body.match(/~(\d+) min/g) ?? []) {
    expect(Number(minutes.slice(1, -4))).toBeLessThanOrEqual(45);
  }
  const programNames = (await page.getByTestId("plan-program-name").allInnerTexts()).filter((t) => /^(Upper|Lower) A/.test(t));
  expect(programNames).toHaveLength(2);

  await page.getByRole("button", { name: "Start this plan" }).click();
  await expect(page.getByText("All done!")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Created 2 programs and cycle "16-Week Upper\/Lower"/)).toBeVisible();

  // Clean up: the cycle (newest of that name), then its two programs.
  await page.getByRole("button", { name: "Go to Plan" }).click();
  await page.waitForURL("/cycles");
  const cycleLinks = page.getByRole("link", { name: /16-Week Upper\/Lower/ });
  await expect(cycleLinks.first()).toBeVisible();
  const hrefs = await cycleLinks.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const newest = hrefs.sort((a, b) => Number(b.split("/").pop()) - Number(a.split("/").pop()))[0];
  const slots = await testDb()
    .select({ day: trainingCycleSlots.dayOfWeek })
    .from(trainingCycleSlots)
    .where(eq(trainingCycleSlots.trainingCycleId, Number(newest.split("/").pop())))
    .orderBy(asc(trainingCycleSlots.dayOfWeek));
  expect(slots.map((s) => s.day)).toEqual([2, 6]);
  await page.goto(newest);
  await expect(page.getByRole("button", { name: "Start cycle" })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete cycle" }).click();
  await page.getByRole("button", { name: "Delete cycle" }).last().click();
  await page.waitForURL("/cycles");

  await page.goto("/programs");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  for (const name of programNames) {
    await page.getByRole("button", { name: `Select ${name}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "Delete 2 selected" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  for (const name of programNames) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
});

test("only offers splits and focus muscles the picks allow", async ({ page }) => {
  await openAiSetup(page);
  await openMoreOptions(page);
  const split = page.getByRole("radiogroup", { name: "Split" });

  await pick(page, "Days per week", "3");
  await expect(split.getByRole("radio", { name: "Upper/Lower" })).toBeDisabled();
  await expect(split.getByRole("radio", { name: "Push/Pull/Legs" })).toBeEnabled();
  await pick(page, "Split", "Push/Pull/Legs");

  // A split the new day count can't hold falls back to "Pick for me".
  await pick(page, "Days per week", "4");
  await expect(split.getByRole("radio", { name: "Pick for me" })).toHaveAttribute("aria-checked", "true");
  await expect(split.getByRole("radio", { name: "Push/Pull/Legs" })).toBeDisabled();

  const focus = page.getByRole("group", { name: "Focus muscles" });
  await focus.getByRole("button", { name: "Arms" }).click();
  await focus.getByRole("button", { name: "Glutes" }).click();
  await expect(focus.getByRole("button", { name: "Chest" })).toBeDisabled();
  await focus.getByRole("button", { name: "Arms" }).click();
  await expect(focus.getByRole("button", { name: "Chest" })).toBeEnabled();
});

test("asks for a note before swapping named exercises", async ({ page }) => {
  await openAiSetup(page);
  const edit = page.getByRole("button", { name: "Change my plan" });
  await build(page, edit);
  await expect(edit).toBeDisabled();
  await page.getByRole("group", { name: "Changes" }).getByRole("button", { name: "Swap exercises I name" }).click();
  await expect(edit).toBeDisabled();
  await page.getByPlaceholder(/Which exercises\?/).fill("no lunges");
  await expect(edit).toBeEnabled();
  await expect(page.getByText("9/200")).toBeVisible();
});

test("restores an AI edit that failed after the user left, request intact", async ({ page }) => {
  await openAiSetup(page);
  await page.evaluate(() => {
    localStorage.setItem(
      "ai_pending_error",
      JSON.stringify({
        error: "The free AI models are busy or unavailable right now. Please try again in a few minutes.",
        picks: { goal: "strength", level: "advanced", daysPerWeek: 4, equipment: "full_gym", weeks: 12, sessionMinutes: 60, split: "auto", priorities: [], avoid: [] },
        chips: ["swap_named"],
        text: "no lunges",
      }),
    );
  });
  await page.reload();

  await expect(page.getByText(/Your last AI edit failed: The free AI models are busy/)).toBeVisible();
  await expect(page.getByText("12-Week Upper/Lower")).toBeVisible();
  await expect(page.getByRole("group", { name: "Changes" }).getByRole("button", { name: "Swap exercises I name" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("textarea").first()).toHaveValue("no lunges");
  await expect(page.getByRole("button", { name: "Change my plan" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("ai_pending_error"))).toBeNull();

  // Back to the picks: they are the restored ones.
  await page.getByRole("button", { name: "Change picks" }).click();
  await expect(page.getByRole("radiogroup", { name: "Goal" }).getByRole("radio", { name: "Strength" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "Experience" }).getByRole("radio", { name: "Advanced" })).toHaveAttribute("aria-checked", "true");
});

test("a change with no saved answer sends nothing out and points to the user's own AI", async ({ page }) => {
  await openAiSetup(page);
  const edit = page.getByRole("button", { name: "Change my plan" });
  await build(page, edit);
  await page.getByRole("group", { name: "Changes" }).getByRole("button", { name: "Swap exercises I name" }).click();
  // A request no one made before, so the shared cache has no answer.
  await page.getByPlaceholder(/Which exercises\?/).fill(`no lunges ${Date.now()}`);

  await edit.click();
  // A user never meets the consent sheet: nothing leaves the server.
  await expect(page.getByText("No saved answer for this change yet. Make it with your own AI.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turn on AI editing?" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Connect an assistant" })).toHaveAttribute("href", "/more/ai-coach/connect");
  await expect(page.getByRole("link", { name: "Use your own AI chat" })).toHaveAttribute("href", "/more/ai-coach/own-chat");
});
