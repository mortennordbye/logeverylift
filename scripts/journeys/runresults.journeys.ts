// Journeys of a run after it is run (docs/plans/run-logger.md, step 4): the results table and the summary.
// Data: the steps demo seed (steps-rundone, steps-runearly, steps-runbrick, for the Garmin fill of step 7 steps-rungarmin, steps-rungarmin-out and steps-runpick, and for the run test of step 8 steps-runtest). Run: pnpm journeys runresults --seed
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
    garmin: { email: "steps-rungarmin@demo.local", password: PASSWORD, about: "admin, the 2 Base treadmill run filled from a synthetic Garmin treadmill run" },
    garminOut: { email: "steps-rungarmin-out@demo.local", password: PASSWORD, about: "admin, Run · Tempo run outdoors and filled from a synthetic Garmin run with GPS" },
    pick: { email: "steps-runpick@demo.local", password: PASSWORD, about: "admin, Run · Tempo outdoors with two synthetic Garmin runs that match it" },
    testReady: { email: "steps-runtest-ready@demo.local", password: PASSWORD, about: "the treadmill run test today, not run" },
    testSick: { email: "steps-runtest-sick@demo.local", password: PASSWORD, about: "the same test, sick until 3 days ago" },
    testChoose: { email: "steps-runtest-choose@demo.local", password: PASSWORD, about: "the test run, the 20 min at HR 186 against LTHR 180" },
    testRetest: { email: "steps-runtest-retest@demo.local", password: PASSWORD, about: "the test run, the 20 min at HR 165 against LTHR 180" },
    testInvalid: { email: "steps-runtest-invalid@demo.local", password: PASSWORD, about: "the test run at effort 7" },
    test: { email: "steps-runtest@demo.local", password: PASSWORD, about: "pace 5:39 and LTHR 180, the treadmill run test run 10 min ago at 10.9 km/h, the 20 min at HR 176, and Run · Tempo in pace" },
  },
  journeys: [
    { id: 1, title: "Treadmill run done", summary: "The summary, the results table with the belt stepper and More numbers, and the summary after a belt is fixed." },
    { id: 2, title: "Outdoor run ended early", summary: "Plan only, the reason chips and Pain, one total distance in the results, and Run again." },
    { id: 3, title: "Brick run", summary: "The summary of a brick run: the ride, T2 and the run." },
    { id: 4, title: "Treadmill run filled from Garmin", summary: "Heart rate and cadence from Garmin, distance from the belt, drift, the chart, time on target and Undo." },
    { id: 5, title: "Outdoor run filled from Garmin", summary: "Distance, pace and GAP from Garmin's GPS run, load from the stream, the chart in pace and the arrows." },
    { id: 6, title: "Two Garmin runs match", summary: "Pick lists both with start, time and distance; picking one fills the run." },
    { id: 8, title: "Run test states", summary: "The start checks, the sick state, and the Choose, Retest and Test may be invalid lines." },
    { id: 7, title: "Run threshold test", summary: "The result line New threshold pace and LTHR with Save, Saved, and a pace run's belts after Save." },
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
          await shot(1, 1, "summary", "Run done: time, 10.3 km from the belt (the steady step at 8.5 km/h), pace, avg HR, load est., effort, zones and plan against done");
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
    {
      name: "garmin",
      account: "garmin",
      journeys: [4],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J4 summary", async () => {
          await openRun(c, /2 Base/);
          await shot(4, 1, "filled-treadmill", "Treadmill run from Garmin: heart rate and drift tiles, the belt chart, zones from the stream");
        });
        await step("J4 undo", async () => {
          await page.getByTestId("summary-garmin").getByRole("button", { name: "Undo" }).click();
          await settle(400);
          await shot(4, 2, "undo-ask", "Undo asks first: Remove the Garmin numbers?");
        });
      },
    },
    {
      name: "garmin-out",
      account: "garminOut",
      journeys: [5],
      async run(c: Ctx) {
        const { step, shot } = c;
        await step("J5 summary", async () => {
          await openRun(c, /Tempo/);
          await shot(5, 1, "filled-outdoor", "Outdoor run from Garmin: distance, pace and GAP, load from the stream, the pace chart, time on target");
        });
      },
    },
    {
      name: "pick",
      account: "pick",
      journeys: [6],
      async run(c: Ctx) {
        const { page, step, shot, settle } = c;
        await step("J6 pick", async () => {
          await openRun(c, /Tempo/);
          await page.getByTestId("summary-garmin-pick").getByRole("button", { name: "Pick" }).click();
          await settle(400);
          await shot(6, 1, "pick", "Two Garmin runs match: Pick lists each with start, time and distance");
        });
      },
    },
    {
      name: "test",
      account: "test",
      journeys: [7],
      async run(c: Ctx) {
        const { page, go, step, shot, settle } = c;
        await step("J7 result", async () => {
          await openRun(c, /30 min run test/);
          await page.getByTestId("summary-threshold").scrollIntoViewIfNeeded();
          await settle(400);
          await shot(7, 1, "result", "Run test done: New threshold pace 5:30 /km · LTHR 176 · Save");
        });
        await step("J7 saved", async () => {
          await page.getByTestId("summary-threshold").getByRole("button", { name: "Save" }).click();
          await page.getByTestId("summary-threshold").getByText("Saved").waitFor();
          await settle(600);
          await shot(7, 2, "saved", "Saved: the test rows are stored");
        });
        await step("J7 belts", async () => {
          await go("/programs");
          await settle(1200);
          const hrefs = await page.locator('a[href^="/programs/"]').evaluateAll((as) => as.map((a) => [a.getAttribute("href") ?? "", a.textContent ?? ""]));
          const href = hrefs.find(([h, t]) => /^\/programs\/\d+$/.test(h) && /Tempo/.test(t))?.[0];
          await go(`${href}/workout`);
          await page.getByRole("link", { name: /^Open / }).first().click();
          await page.getByTestId("run-exercise").filter({ visible: true }).waitFor();
          if ((await page.getByTestId("run-mode").filter({ visible: true }).textContent()) !== "Treadmill") {
            await page.getByRole("button", { name: "Change" }).click();
            await page.getByTestId("run-mode-sheet").getByRole("button", { name: "Treadmill" }).click();
          }
          await settle(800);
          await shot(7, 3, "belts-after", "Run · Tempo on a treadmill after Save: threshold 5:30 /km and the belts from it");
        });
      },
    },
    ...(
      [
        ["testReady", 1, "start", "Run test before the start: No hard session in the last 48 hours and the stop line"],
        ["testSick", 2, "sick", "Sick until 3 days ago: Wait 7 days after being sick, no Start run"],
        ["testChoose", 3, "choose", "HR 186 against LTHR 180: the current and new values side by side to choose"],
        ["testRetest", 4, "retest", "HR 165 against LTHR 180: Run the test again in 4 weeks, Save second"],
        ["testInvalid", 5, "invalid", "Effort 7: Test may be invalid, Save second"],
      ] as const
    ).map(([account, n, slug, title]) => ({
      name: account,
      account,
      journeys: [8],
      async run(c: Ctx) {
        const { page, go, step, shot, settle } = c;
        await step(`J8 ${slug}`, async () => {
          await go("/programs");
          await settle(1200);
          const hrefs = await page.locator('a[href^="/programs/"]').evaluateAll((as) => as.map((a) => [a.getAttribute("href") ?? "", a.textContent ?? ""]));
          const href = hrefs.find(([h, t]) => /^\/programs\/\d+$/.test(h) && /30 min run test/.test(t))?.[0];
          await go(`${href}/workout`);
          await page.getByRole("link", { name: /^Open / }).first().click();
          await page.waitForURL(/\/workout\/exercises\/\d+/);
          const id = n <= 2 ? "run-test-checks" : "summary-threshold";
          await page.getByTestId(id).filter({ visible: true }).waitFor();
          await page.getByTestId(id).filter({ visible: true }).scrollIntoViewIfNeeded();
          await settle(800);
          await shot(8, n, slug, title);
        });
      },
    })),
  ],
};

export default set;
