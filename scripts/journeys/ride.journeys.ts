// Journeys of ride mode in the bike exercise (docs/plans/bike-ride-logger.md, steps 3 and 4).
// Data: the steps demo seed (steps-ride and steps-noftp). Run: pnpm journeys ride --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "steps-demo-password";

/** Open today's bike exercise from home: Start Today's Workout, Guided (D14 sends it to the bike exercise). */
async function openBike({ page, go, settle }: Ctx) {
  await go("/");
  await page.getByRole("button", { name: /Start Today's Workout/ }).first().click();
  await page.getByTestId("start-choice").getByRole("link", { name: /^Guided/ }).click();
  await page.waitForURL(/\/workout\/exercises\/\d+/);
  await settle(3000);
}

const set: JourneySet = {
  name: "ride",
  title: "Ride mode",
  intro: "A bike ride run step by step inside the bike exercise: start, the ride screen, the controls with undo, pause, a reload, landscape, the end, the results table and the summary, an outdoor ride with no thresholds, and a ride logged by hand.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    ride: { email: "steps-ride@demo.local", password: PASSWORD, about: "FTP 180 W and bike LTHR 171, today's ride is the mockup ride" },
    noftp: { email: "steps-noftp@demo.local", password: PASSWORD, about: "the same ride, no thresholds set" },
    hand: { email: "steps-hand@demo.local", password: PASSWORD, about: "the same ride with FTP 180 W, logged by hand" },
  },
  journeys: [
    { id: 1, title: "Indoor ride", summary: "Start the ride, change the target, add a minute, skip with undo, pause, reload, landscape, end early, type the results and see the summary." },
    { id: 2, title: "Outdoor ride with no thresholds", summary: "Change to Outdoor, start, the effort target and Lap, end, the outdoor results with more numbers, Later, and the plan-only summary." },
    { id: 3, title: "Log by hand", summary: "Log the ride by hand from the bike screen: times, watts, effort, and back to the workout." },
  ],
  flows: [
    {
      name: "ride",
      account: "ride",
      journeys: [1],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J1 bike screen", async () => {
          await openBike(c);
          if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
          await shot(1, 1, "bike-screen", "The bike exercise before the start, indoors");
        });
        await step("J1 start", async () => {
          await page.getByRole("button", { name: "Start ride" }).click();
          await page.getByTestId("ride-screen").waitFor();
          await settle(1500);
          await shot(1, 2, "ride", "Ride mode: step 1 running");
        });
        await step("J1 nudge", async () => {
          await page.getByRole("button", { name: "Target up 5 W" }).click();
          await settle(300);
          await shot(1, 3, "nudge-toast", "+5 W with its undo");
          await page.getByRole("button", { name: "Undo" }).click();
          await page.getByRole("button", { name: "Add 1 min" }).click();
          await settle(300);
          await shot(1, 4, "extend-toast", "+1 min with its undo");
        });
        await step("J1 skip", async () => {
          const hold = page.getByRole("button", { name: /^Hold to skip/ });
          const box = (await hold.boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(800);
          await page.mouse.up();
          await settle(300);
          await shot(1, 5, "skipped", "Step 2 after a skip, with Skipped and Undo");
        });
        await step("J1 pause", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await settle(500);
          await shot(1, 6, "paused", "Paused: Resume, and End ride at the bottom");
          await page.getByRole("button", { name: "Resume" }).click();
          await settle(500);
        });
        await step("J1 reload", async () => {
          await page.reload();
          await page.getByTestId("ride-prompt").waitFor();
          await settle(800);
          await shot(1, 7, "reload-prompt", "Opened again after a reload: Resume or End at the last step");
          await page.getByRole("button", { name: "Resume" }).click();
          await settle(500);
        });
        await step("J1 landscape", async () => {
          await page.setViewportSize({ width: 844, height: 390 });
          await settle(800);
          await shot(1, 8, "landscape", "Landscape on a trainer mount", { raw: true });
          await page.setViewportSize({ width: 390, height: 844 });
          await settle(500);
        });
        await step("J1 end", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await settle(300);
          await page.getByRole("button", { name: "End ride" }).click();
          await page.getByTestId("ride-results").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(1, 9, "results", "The results table after the ride ended early: step 2 ridden, the rest skipped or not ridden");
        });
        await step("J1 results", async () => {
          await page.getByTestId("result-avgPower-2").fill("128");
          await page.getByTestId("result-avgHr-2").fill("142");
          await page.getByTestId("more-numbers").click();
          await page.getByRole("button", { name: "6", exact: true }).click();
          await settle(300);
          await shot(1, 10, "results-typed", "Watts and heart rate typed, more numbers open, effort 6");
          await page.getByTestId("results-done").click();
          await page.getByTestId("ride-summary-screen").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(1, 11, "summary", "The summary: Ended early, the ridden step only, load from effort marked est.");
        });
      },
    },
    {
      name: "noftp",
      account: "noftp",
      journeys: [2],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J2 outdoor", async () => {
          await openBike(c);
          if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) !== "Outdoor") await page.getByRole("button", { name: "Change to Outdoor" }).click();
          await shot(2, 1, "bike-outdoor", "The bike exercise outdoors with no thresholds");
          await page.getByRole("button", { name: "Start ride" }).click();
          await page.getByTestId("ride-screen").waitFor();
          await settle(1500);
          await shot(2, 2, "ride-outdoor", "Outdoor ride mode: the effort target and Lap");
        });
        await step("J2 lap", async () => {
          await page.getByRole("button", { name: "Lap" }).click();
          await settle(500);
          await shot(2, 3, "after-lap", "Step 2 after Lap");
        });
        await step("J2 end", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await settle(300);
          await page.getByRole("button", { name: "End ride" }).click();
          await page.getByTestId("ride-results").waitFor({ timeout: 15_000 });
          await page.getByTestId("more-numbers").click();
          await settle(800);
          await shot(2, 4, "results-outdoor", "Outdoor results with more numbers: max HR, distance, speed, climbing");
        });
        await step("J2 later", async () => {
          const exercise = new URL(page.url()).pathname;
          await page.getByTestId("results-later").click();
          await page.waitForURL((u) => !u.search.includes("results"));
          await c.go(exercise);
          await page.getByTestId("ride-summary-screen").waitFor();
          await settle(800);
          await shot(2, 5, "summary-plan-only", "Later, then the exercise again: the summary with Plan only and Add numbers");
        });
      },
    },
    {
      name: "hand",
      account: "hand",
      journeys: [3],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J3 hand", async () => {
          await openBike(c);
          if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
          await page.getByRole("link", { name: "Log by hand" }).click();
          await page.getByTestId("ride-results").waitFor();
          await settle(800);
          await shot(3, 1, "hand", "Log by hand: each step with the plan's time to change");
          await page.getByTestId("result-time-2").fill("14:30");
          for (const [n, w] of [[1, "124"], [2, "141"], [3, "92"], [4, "131"], [5, "118"]] as const) await page.getByTestId(`result-avgPower-${n}`).fill(w);
          await page.getByRole("button", { name: "6", exact: true }).click();
          await settle(300);
          await shot(3, 2, "hand-typed", "Times and watts typed, effort 6");
          await page.getByTestId("results-done").click();
          await page.waitForURL(/\/workout$/);
          await settle(1500);
          await shot(3, 3, "workout", "Back on the workout after Done");
        });
      },
    },
  ],
};

export default set;
