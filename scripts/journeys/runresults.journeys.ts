// Journeys of a run after it is run (docs/plans/run-logger.md, step 4): the results table and the summary.
// Data: the steps demo seed (steps-rundone, steps-runearly and steps-runbrick). Run: pnpm journeys runresults --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "steps-demo-password";

/** The run program from the Programs tab: its workout, then the run ring. Home says Done and offers Do Again. */
async function openRun({ page, go, settle }: Ctx, name: RegExp) {
  await go("/programs");
  await settle(1500);
  const hrefs = await page.locator('a[href^="/programs/"]').evaluateAll((as) => as.map((a) => [a.getAttribute("href") ?? "", a.textContent ?? ""]));
  const href = hrefs.find(([h, t]) => /^\/programs\/\d+$/.test(h) && name.test(t))?.[0];
  await go(`${href}/workout`);
  await page.getByRole("link", { name: /^Open / }).first().click();
  await page.waitForURL(/\/workout\/exercises\/\d+/);
  await page.getByTestId("run-summary-screen").filter({ visible: true }).waitFor();
  await settle(1200);
}

const set: JourneySet = {
  name: "runresults",
  title: "Run results and summary",
  intro: "A run after it is run: the summary with distance and pace from the belt, the zone bar and plan against done per step; the results table with the belt stepper, More numbers and the effort; an outdoor run ended early with its reason, plan only, one total distance and Run again; and a brick run with the ride and T2.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    done: { email: "steps-rundone@demo.local", password: PASSWORD, about: "threshold pace 5:39 /km and run LTHR 180, 2 Base · Run run on a treadmill 10 min ago, the steady step at 8.5 km/h" },
    early: { email: "steps-runearly@demo.local", password: PASSWORD, about: "the same thresholds, Run · Tempo run outdoors and ended early in the tempo, no numbers" },
    brick: { email: "steps-runbrick@demo.local", password: PASSWORD, about: "the same thresholds and FTP 200 W, the short brick ridden and its run on a treadmill after it" },
  },
  journeys: [
    { id: 1, title: "Treadmill run done", summary: "The summary, the results table with the belt stepper and More numbers, and the summary after a belt is fixed." },
    { id: 2, title: "Outdoor run ended early", summary: "Plan only, the reason chips and Pain, one total distance in the results, and Run again." },
    { id: 3, title: "Brick run", summary: "The summary of a brick run: the ride, T2 and the run." },
  ],
  flows: [
    {
      name: "done",
      account: "done",
      journeys: [1],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J1 summary", async () => {
          await openRun(c, /2 Base/);
          await shot(1, 1, "summary", "Run done: time, 9.8 km from the belt, pace, avg HR, load est., effort, zones and plan against done");
        });
        await step("J1 results", async () => {
          await page.getByTestId("summary-edit").click();
          await page.getByTestId("run-results").filter({ visible: true }).waitFor();
          await settle(800);
          await shot(1, 2, "results", "Run results: one row per step, the belt stepper on each, strides as one row, effort once");
        });
        await step("J1 more", async () => {
          await page.getByRole("button", { name: "Belt up 0.1 km/h step 2" }).click();
          await page.getByRole("button", { name: "Belt up 0.1 km/h step 2" }).click();
          await page.getByTestId("more-numbers").click();
          await settle(400);
          await shot(1, 3, "results-more", "The steady belt set to 8.7 with plan 8.2 beside it, and More numbers open");
        });
        await step("J1 saved", async () => {
          await page.getByTestId("results-done").click();
          await page.getByTestId("run-summary-screen").filter({ visible: true }).waitFor();
          await settle(1200);
          await shot(1, 4, "summary-after", "The summary after Done: the steady step at 8.7 and the distance from the belt and typed numbers");
        });
      },
    },
    {
      name: "early",
      account: "early",
      journeys: [2],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J2 summary", async () => {
          await openRun(c, /Tempo/);
          await shot(2, 1, "ended-early", "Run ended early outdoors: steps saved, the reason chips, Plan only, Run again");
        });
        await step("J2 pain", async () => {
          await page.getByRole("button", { name: "Pain" }).click();
          await page.getByTestId("log-injury").waitFor();
          await settle(400);
          await shot(2, 2, "pain", "Pain chosen: Log an injury", { small: false });
        });
        await step("J2 results", async () => {
          await page.getByTestId("summary-edit").click();
          await page.getByTestId("run-results").filter({ visible: true }).waitFor();
          await settle(800);
          await shot(2, 3, "results-outdoor", "Outdoor results: avg HR per step and one optional total distance");
        });
        await step("J2 total", async () => {
          await page.getByTestId("result-total-km").fill("4.6");
          await page.getByTestId("result-avgHr-1").fill("138");
          await page.getByTestId("result-avgHr-2").fill("162");
          await page.getByRole("group", { name: "Effort of the run" }).getByRole("button", { name: "7" }).click();
          await page.getByTestId("results-done").click();
          await page.getByTestId("run-summary-screen").filter({ visible: true }).waitFor();
          await settle(1200);
          await shot(2, 4, "summary-typed", "The summary with the typed distance, pace and heart rate");
        });
        await step("J2 again", async () => {
          await page.getByTestId("summary-run-again").click();
          await page.getByTestId("ride-screen").waitFor({ timeout: 15_000 });
          await settle(800);
          await shot(2, 5, "run-again", "Run again: a new run of the tempo on the same workout", { small: false });
        });
      },
    },
    {
      name: "brick",
      account: "brick",
      journeys: [3],
      async run(c: Ctx) {
        const { step, shot } = c;
        await step("J3 summary", async () => {
          await openRun(c, /Brick run/);
          await shot(3, 1, "brick", "A brick run: Brick · ride 7:00 · T2 1:12 · run 30:00 under the done line");
        });
      },
    },
  ],
};

export default set;
