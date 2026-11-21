// Journeys of ride mode in the bike exercise (docs/plans/bike-ride-logger.md, steps 3, 4 and 7).
// Data: the steps demo seed (steps-ride, steps-noftp, steps-hand, steps-garmin and steps-ftp). Run: pnpm journeys ride --seed
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
    garmin: { email: "steps-garmin@demo.local", password: PASSWORD, about: "the same ride, ridden 10 min ago and filled from a synthetic Garmin activity" },
    ftp: { email: "steps-ftp@demo.local", password: PASSWORD, about: "FTP 180 W, the 20 min FTP test ridden 10 min ago with the all-out step typed at 196 W" },
  },
  journeys: [
    { id: 1, title: "Indoor ride", summary: "Start the ride, change the target, add a minute, skip with undo, pause, reload, landscape, end early, type the results and see the summary, ride again, and end it offline with Later." },
    { id: 2, title: "Outdoor ride with no thresholds", summary: "Change to Outdoor, start, the effort target and Lap, end, the outdoor results with more numbers, Later, and the plan-only summary." },
    { id: 3, title: "Log by hand", summary: "Log the ride by hand from the bike screen: times, watts, effort, and back to the workout." },
    { id: 4, title: "Filled from Garmin", summary: "The summary of a ride Garmin filled: NP, IF, the plan-against-done chart, zones, time on target, drift, then Undo with its question, and Fill from Garmin." },
    { id: 5, title: "FTP test result", summary: "The summary of a 20 min FTP test: New FTP 186 W · Save, then Saved, and the bike screen in the new watts." },
  ],
  flows: [
    {
      name: "ftp",
      account: "ftp",
      journeys: [5],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J5 summary", async () => {
          await c.go("/");
          await page.getByRole("link", { name: "Do Again" }).click();
          const guided = page.getByTestId("start-choice").getByRole("link", { name: /^Guided/ });
          if (await guided.isVisible().catch(() => false)) await guided.click();
          await page.waitForURL(/\/workout/);
          if (!/\/exercises\//.test(page.url())) await page.getByRole("link", { name: /Bike/ }).first().click();
          await page.waitForURL(/\/workout\/exercises\/\d+/);
          await settle(2000);
          await page.getByTestId("summary-ftp").waitFor();
          await shot(5, 1, "summary-ftp", "The test summary with New FTP 186 W · Save");
        });
        await step("J5 save", async () => {
          await page.getByTestId("summary-ftp").getByRole("button", { name: "Save" }).click();
          await page.getByTestId("summary-ftp").getByText("Saved").waitFor();
          await settle(500);
          await shot(5, 2, "summary-ftp-saved", "After Save: New FTP 186 W · Saved");
        });
      },
    },
    {
      name: "garmin",
      account: "garmin",
      journeys: [4],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J4 summary", async () => {
          // Today's session is done by the ride, so home offers Do Again; the bike exercise then shows the ride's summary.
          await c.go("/");
          await page.getByRole("link", { name: "Do Again" }).click();
          const guided = page.getByTestId("start-choice").getByRole("link", { name: /^Guided/ });
          if (await guided.isVisible().catch(() => false)) await guided.click();
          await page.waitForURL(/\/workout/);
          if (!/\/exercises\//.test(page.url())) await page.getByRole("link", { name: /Bike/ }).first().click();
          await page.waitForURL(/\/workout\/exercises\/\d+/);
          await settle(2000);
          await page.getByTestId("ride-summary-screen").waitFor();
          await shot(4, 1, "summary", "The summary filled from Garmin: tiles, chart, zones");
        });
        await step("J4 steps", async () => {
          await page.getByTestId("summary-garmin").scrollIntoViewIfNeeded();
          await settle(300);
          await shot(4, 2, "summary-steps", "Plan against done per step with time on target, and Steps filled from Garmin · Undo");
        });
        await step("J4 undo", async () => {
          await page.getByTestId("summary-garmin").getByRole("button", { name: "Undo" }).click();
          await settle(300);
          await shot(4, 3, "undo-confirm", "Undo asks first: Remove the Garmin numbers? Keep or Remove");
          await page.getByTestId("summary-garmin").getByRole("button", { name: "Remove" }).click();
          await page.getByTestId("summary-garmin-refill").waitFor();
          await settle(800);
          await shot(4, 4, "after-undo", "After Undo: the step averages are gone, no stream numbers, and Fill from Garmin");
        });
        await step("J4 refill", async () => {
          await page.getByTestId("summary-garmin-refill").getByRole("button", { name: "Fill from Garmin" }).click();
          await page.getByTestId("summary-garmin").waitFor();
          await settle(800);
          await shot(4, 5, "refilled", "Fill from Garmin: the stream numbers are back");
        });
      },
    },
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
          await shot(1, 11, "summary", "The summary: Ended early, the ridden step only, No load as the ride is too short, and Ride again");
        });
        await step("J1 ride again", async () => {
          await page.getByRole("button", { name: "Ride again" }).click();
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(1500);
          await shot(1, 12, "ride-again", "Ride again: a new ride from step 1 on the same workout");
        });
        await step("J1 offline end", async () => {
          await page.context().setOffline(true);
          await page.getByRole("button", { name: "Pause" }).click();
          await settle(300);
          await page.getByRole("button", { name: "End ride" }).click();
          await page.getByTestId("ride-done").waitFor();
          await settle(500);
          await shot(1, 13, "done-offline", "Ended while offline: Saved on this phone, and Later");
          // Back online, the queued taps send and the ride goes on to its results table.
          await page.context().setOffline(false);
          await page.getByTestId("ride-results").waitFor({ timeout: 40_000 });
          await settle(800);
          await shot(1, 14, "online-results", "Back online: the taps sent, and the results table of the second ride");
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
