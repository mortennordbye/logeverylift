// Journeys of ride mode in the bike exercise (docs/plans/bike-ride-logger.md, step 3).
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
  intro: "A bike ride run step by step inside the bike exercise: start, the ride screen, the controls with undo, pause, a reload, landscape, the end, and an outdoor ride with no thresholds.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    ride: { email: "steps-ride@demo.local", password: PASSWORD, about: "FTP 180 W and bike LTHR 171, today's ride is the mockup ride" },
    noftp: { email: "steps-noftp@demo.local", password: PASSWORD, about: "the same ride, no thresholds set" },
  },
  journeys: [
    { id: 1, title: "Indoor ride", summary: "Start the ride, change the target, add a minute, skip with undo, pause, reload, landscape, end early, and the bike screen after." },
    { id: 2, title: "Outdoor ride with no thresholds", summary: "Change to Outdoor, start, the effort target and Lap, then end." },
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
          await page.getByTestId("ride-done-line").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(1, 9, "ride-done", "The bike screen after the ride: Ride ended early and Done");
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
          await page.getByTestId("ride-done-line").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(2, 4, "ride-done", "The bike screen after an outdoor ride ended early");
        });
      },
    },
  ],
};

export default set;
