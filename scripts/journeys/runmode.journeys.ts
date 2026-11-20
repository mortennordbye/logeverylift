// Journeys of run mode (docs/plans/run-logger.md, step 3).
// Data: the steps demo seed (steps-runmode, steps-runout, steps-brick and steps-brick-live). Run: pnpm journeys runmode --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "steps-demo-password";

/** Today's planned sessions from home, in their order: where each one's workout opens. */
async function todayHrefs({ page, go, settle }: Ctx): Promise<string[]> {
  await go("/");
  await settle(1500);
  const hrefs = await page.locator('a[href*="/workout?planned="]').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return [...new Set(hrefs)];
}

/** Open a workout's first endurance exercise from the workout list. */
async function openExercise({ page, go, settle }: Ctx, workoutHref: string) {
  await go(workoutHref);
  await page.getByRole("link", { name: /^Open / }).first().click();
  await page.waitForURL(/\/workout\/exercises\/\d+/);
  await settle(1500);
}

/** Today's run from home: Start Today's Workout, Log by hand (the workout), then the run ring. */
async function openRun(c: Ctx) {
  const { page, go, settle } = c;
  await go("/");
  await page.getByRole("button", { name: /Start Today's Workout/ }).first().click();
  await page.getByTestId("start-choice").getByRole("link", { name: /^Log by hand/ }).click();
  await page.waitForURL(/\/workout$/);
  await page.getByRole("link", { name: /^Open / }).first().click();
  await page.waitForURL(/\/workout\/exercises\/\d+$/);
  await page.getByTestId("run-exercise").filter({ visible: true }).waitFor();
  await settle(1500);
}

async function mode({ page, settle }: Ctx, name: "Treadmill" | "Outdoor") {
  const screen = page.getByTestId("run-exercise").filter({ visible: true });
  if ((await screen.getByTestId("run-mode").textContent()) === name) return;
  await screen.getByRole("button", { name: "Change" }).click();
  await page.getByTestId("run-mode-sheet").getByRole("button", { name }).click();
  await settle(500);
}

async function hold({ page }: Ctx, name: RegExp) {
  const button = page.getByRole("button", { name });
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
}

const set: JourneySet = {
  name: "runmode",
  title: "Run mode",
  intro: "A run run step by step inside the run exercise: the treadmill count, the belt and incline with undo, the belt cue, the strides block, pause, landscape, a reload, offline, the end with its reason; outdoors the target, the controls lock and Lap; and the brick hand-off from a ride to its run.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    mode: { email: "steps-runmode@demo.local", password: PASSWORD, about: "threshold pace 5:39 /km and run LTHR 180, today's run is a 5:25 treadmill run with 2 strides" },
    out: { email: "steps-runout@demo.local", password: PASSWORD, about: "the same thresholds, today's run is a 400 m rep and 1 min easy" },
    brick: { email: "steps-brick@demo.local", password: PASSWORD, about: "the same thresholds and FTP 200 W, today a ride and then its run as a brick" },
    live: { email: "steps-brick-live@demo.local", password: PASSWORD, about: "the same brick, the run started while the ride runs" },
  },
  journeys: [
    { id: 1, title: "Treadmill run", summary: "Start with the 5 s count, belt taps with undo, the cue before the strides, the strides block and its skip, pause, landscape, a reload, offline, and end early with a reason." },
    { id: 2, title: "Outdoor run", summary: "The outdoor target and the 400 m estimate, the controls lock, Lap, and Run done." },
    { id: 3, title: "Brick after the ride", summary: "The ride ends early, its done screen offers Start run, the run screen shows T2, and the run starts with short quick steps." },
    { id: 4, title: "End ride and start run", summary: "The run screen while the ride still runs: End ride and start run in one tap." },
  ],
  flows: [
    {
      name: "mode",
      account: "mode",
      journeys: [1],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J1 ready", async () => {
          await openRun(c);
          await mode(c, "Treadmill");
          await shot(1, 1, "ready", "The run exercise on a treadmill before the start");
        });
        await step("J1 count", async () => {
          await page.getByRole("button", { name: "Start run" }).click();
          await page.getByTestId("run-count").waitFor();
          await settle(700);
          await shot(1, 2, "count", "The 5 s count: Step on · Set belt 7.5 km/h", { small: false });
        });
        await step("J1 warm-up", async () => {
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(1, 3, "warm-up", "Warm-up on the treadmill: belt 7.5 km/h, incline 1%, heart rate and pace");
        });
        await step("J1 belt", async () => {
          await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
          await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
          await settle(300);
          await shot(1, 4, "belt-toast", "Two taps: Belt 8.5 km/h with Undo, and Plan 7.5 under it");
        });
        await step("J1 cue", async () => {
          await page.getByTestId("run-cue").waitFor({ timeout: 70_000 });
          await settle(300);
          await shot(1, 5, "cue", "10 s before the strides: Speed up to 13.0 km/h");
        });
        await step("J1 stride", async () => {
          await page.getByTestId("ride-step-title").getByText("Stride 1 of 2").waitFor({ timeout: 20_000 });
          await settle(500);
          await shot(1, 6, "stride", "Stride 1 of 2 with its dots, belt 13.0 km/h");
        });
        await step("J1 easy", async () => {
          await page.getByTestId("ride-step-title").getByText("Easy").waitFor({ timeout: 20_000 });
          await settle(500);
          await shot(1, 7, "stride-easy", "The easy part of the block: belt 7.0 km/h from the plan");
        });
        await step("J1 skip block", async () => {
          await hold(c, /^Hold to skip/);
          await settle(300);
          await shot(1, 8, "strides-skipped", "Hold to skip in the block: Strides skipped · Undo, the steady step runs");
        });
        await step("J1 pause", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await page.getByTestId("ride-paused").waitFor();
          await settle(400);
          await shot(1, 9, "paused", "Paused: Set belt before Resume, End run at the bottom with the saved steps");
          await page.getByRole("button", { name: "Resume" }).click();
          await settle(400);
        });
        await step("J1 landscape", async () => {
          await page.setViewportSize({ width: 844, height: 390 });
          await settle(800);
          await shot(1, 10, "landscape", "Landscape on a treadmill console", { raw: true });
          await page.setViewportSize({ width: 390, height: 844 });
          await settle(500);
        });
        await step("J1 reload", async () => {
          await page.reload();
          await page.getByTestId("ride-prompt").waitFor();
          await settle(800);
          await shot(1, 11, "reload-prompt", "Opened again after a reload: Run running, Resume or End at the last step");
          await page.getByRole("button", { name: "Resume" }).click();
          await settle(500);
        });
        await step("J1 offline", async () => {
          await page.context().setOffline(true);
          await page.getByRole("button", { name: "Belt up 0.5 km/h" }).click();
          await page.getByTestId("ride-offline").waitFor({ timeout: 10_000 });
          await settle(300);
          await shot(1, 12, "offline", "Offline: Saved on this phone in the header");
          await page.context().setOffline(false);
          await page.getByTestId("ride-total").waitFor({ timeout: 40_000 });
        });
        await step("J1 end early", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await page.getByRole("button", { name: "End run" }).click();
          await page.getByTestId("run-results").filter({ visible: true }).waitFor({ timeout: 20_000 });
          await page.getByTestId("results-done").click();
          await page.getByTestId("run-summary-screen").filter({ visible: true }).waitFor({ timeout: 20_000 });
          await settle(800);
          await shot(1, 13, "ended-early", "Run ended early: after the results table, the summary with the steps saved and the reason chips");
        });
        await step("J1 pain", async () => {
          await page.getByRole("button", { name: "Pain" }).click();
          await page.getByTestId("log-injury").waitFor();
          await settle(400);
          await shot(1, 14, "pain", "Pain chosen: Log an injury");
        });
      },
    },
    {
      name: "out",
      account: "out",
      journeys: [2],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J2 ready", async () => {
          await openRun(c);
          await mode(c, "Outdoor");
          await shot(2, 1, "ready-outdoor", "The run exercise outdoors: Road, the 400 m rep, Step alerts are off");
        });
        await step("J2 run", async () => {
          await page.getByRole("button", { name: "Start run" }).click();
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(1000);
          await shot(2, 2, "rep", "Outdoor run mode: Hard, 400 m · about 2:16, Lap");
        });
        await step("J2 lock", async () => {
          await page.getByTestId("run-lock").waitFor({ timeout: 20_000 });
          await settle(300);
          await shot(2, 3, "locked", "10 s after the last tap: Controls locked · Hold to unlock");
        });
        await step("J2 lap", async () => {
          await hold(c, /^Hold to unlock/);
          await page.getByRole("button", { name: "Lap" }).click();
          await page.getByTestId("ride-step-title").getByText("Easy").waitFor();
          await settle(500);
          await shot(2, 4, "after-lap", "After Lap: the easy minute");
        });
        await step("J2 done", async () => {
          await page.getByRole("button", { name: "Pause" }).click();
          await page.getByRole("button", { name: "End run" }).click();
          await page.getByTestId("run-results").filter({ visible: true }).waitFor({ timeout: 20_000 });
          await settle(800);
          await shot(2, 5, "done", "After the run: the results table, no Start run");
        });
      },
    },
    {
      name: "brick",
      account: "brick",
      journeys: [3],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J3 ride", async () => {
          const [ride] = await todayHrefs(c);
          await openExercise(c, ride);
          if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
          await page.getByRole("button", { name: "Start ride" }).click();
          await page.getByTestId("ride-screen").waitFor();
          await settle(3000);
          await page.getByRole("button", { name: "Pause" }).click();
          await page.getByRole("button", { name: "End ride" }).click();
          await page.getByTestId("brick-ride-done").filter({ visible: true }).waitFor({ timeout: 20_000 });
          await settle(800);
          await shot(3, 1, "ride-done", "The ride of a brick ended early: Start run, and Ride numbers later");
        });
        await step("J3 t2", async () => {
          await page.getByRole("link", { name: "Start run" }).click();
          await page.getByTestId("run-exercise").filter({ visible: true }).waitFor();
          await page.getByTestId("run-t2").filter({ visible: true }).waitFor();
          await mode(c, "Treadmill");
          await settle(1500);
          await shot(3, 2, "t2", "The run screen with T2 counting since the ride");
        });
        await step("J3 run", async () => {
          await page.getByRole("button", { name: "Start run" }).click();
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(3, 3, "brick-run", "The brick run: Short quick steps for the first 10 min");
        });
      },
    },
    {
      name: "live",
      account: "live",
      journeys: [4],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J4 end and start", async () => {
          const [ride, run] = await todayHrefs(c);
          await openExercise(c, ride);
          if ((await page.getByTestId("ride-mode").filter({ visible: true }).textContent()) === "Outdoor") await page.getByRole("button", { name: "Change to Indoor trainer" }).click();
          await page.getByRole("button", { name: "Start ride" }).click();
          await page.getByTestId("ride-screen").waitFor();
          await settle(1500);
          await openExercise(c, run);
          await page.getByTestId("run-exercise").filter({ visible: true }).waitFor();
          await mode(c, "Outdoor");
          await settle(800);
          await shot(4, 1, "ride-running", "The run screen while the ride runs: End ride and start run, Back to the ride");
          await page.getByRole("button", { name: "End ride and start run" }).click();
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(1000);
          await shot(4, 2, "run-started", "The ride ended and the run runs, outdoors on effort with short quick steps");
        });
      },
    },
  ],
};

export default set;
