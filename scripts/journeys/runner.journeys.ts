// Journeys of the run exercise screen (docs/plans/run-logger.md, step 2).
// Data: the steps demo seed (steps-run, steps-run-nopace and steps-run-nolthr). Run: pnpm journeys runner --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "steps-demo-password";

/** Today's run from home: Start Today's Workout, Log by hand (the workout), then the run ring. */
async function openRun({ page, go, settle }: Ctx) {
  await go("/");
  await page.getByRole("button", { name: /Start Today's Workout/ }).first().click();
  await page.getByTestId("start-choice").getByRole("link", { name: /^Log by hand/ }).click();
  await page.waitForURL(/\/workout$/);
  await page.getByRole("link", { name: /^Open / }).first().click();
  await page.waitForURL(/\/workout\/exercises\/\d+$/);
  await page.getByTestId("run-exercise").filter({ visible: true }).waitFor();
  await settle(1500);
}

/** The screen's mode: Change, then the mode's option in the sheet, unless it is already on. */
async function mode({ page, settle }: Ctx, name: "Treadmill" | "Outdoor") {
  const screen = page.getByTestId("run-exercise").filter({ visible: true });
  if ((await screen.getByTestId("run-mode").textContent()) === name) return;
  await screen.getByRole("button", { name: "Change" }).click();
  await page.getByTestId("run-mode-sheet").getByRole("button", { name }).click();
  await settle(500);
}

const set: JourneySet = {
  name: "runner",
  title: "Run exercise screen",
  intro: "The run exercise of an endurance user before the run starts: the planned day card on home, the treadmill and outdoor plans, the mode sheet, the surface choice, the empty states and a run already running.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    run: { email: "steps-run@demo.local", password: PASSWORD, about: "threshold pace 5:39 /km and run LTHR 180, today's run is 2 Base · Run" },
    nopace: { email: "steps-run-nopace@demo.local", password: PASSWORD, about: "the same run, run LTHR 180 only" },
    nolthr: { email: "steps-run-nolthr@demo.local", password: PASSWORD, about: "the same run, threshold pace 5:39 /km only" },
  },
  journeys: [
    { id: 1, title: "Treadmill and outdoor", summary: "The planned day card, the treadmill plan, the mode sheet, the outdoor plan with the surface choice, Start run and Resume." },
    { id: 2, title: "No threshold pace", summary: "The treadmill plan with no threshold pace: Set pace, and heart rate steps by feel." },
    { id: 3, title: "No LTHR", summary: "The treadmill plan with no run LTHR: effort targets and no zone bar." },
  ],
  flows: [
    {
      name: "run",
      account: "run",
      journeys: [1],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J1 planned day card", async () => {
          await c.go("/");
          await page.getByTestId("today-card").first().waitFor();
          await settle(800);
          await shot(1, 1, "day-card", "Home: Today says Run · Treadmill · 75 min");
        });
        await step("J1 treadmill", async () => {
          await openRun(c);
          await mode(c, "Treadmill");
          await shot(1, 2, "ready-treadmill", "The run exercise on a treadmill: chart, numbers, belts");
        });
        await step("J1 sheet", async () => {
          await page.getByTestId("run-exercise").filter({ visible: true }).getByRole("button", { name: "Change" }).click();
          await page.getByTestId("run-mode-sheet").waitFor();
          await settle(600);
          await shot(1, 3, "mode-sheet", "Change opens the sheet with Treadmill and Outdoor");
          await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Outdoor" }).click();
          await settle(600);
        });
        await step("J1 outdoor", async () => {
          await shot(1, 4, "ready-outdoor", "Outdoor: Road and Trail or snow, outdoor targets, Step alerts are off");
          await page.getByRole("button", { name: "Trail or snow" }).click();
          await settle(300);
          await shot(1, 5, "trail", "Trail or snow chosen", { small: false });
        });
        await step("J1 start", async () => {
          await page.getByRole("button", { name: "Start run" }).click();
          await page.waitForURL(/\?ride=1$/);
          await page.getByTestId("run-running").filter({ visible: true }).waitFor();
          await settle(1000);
          await shot(1, 6, "running", "After Start run: Run running and Resume");
        });
      },
    },
    {
      name: "nopace",
      account: "nopace",
      journeys: [2],
      async run(c: Ctx) {
        await c.step("J2 no threshold pace", async () => {
          await openRun(c);
          await mode(c, "Treadmill");
          await c.shot(2, 1, "no-pace", "No threshold pace: Set pace, and the steady step by feel");
        });
      },
    },
    {
      name: "nolthr",
      account: "nolthr",
      journeys: [3],
      async run(c: Ctx) {
        await c.step("J3 no LTHR", async () => {
          await openRun(c);
          await mode(c, "Treadmill");
          await c.shot(3, 1, "no-lthr", "No run LTHR: effort targets, no zone bar");
        });
      },
    },
  ],
};

export default set;
