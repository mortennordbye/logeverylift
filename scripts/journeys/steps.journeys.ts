// Journeys of structured endurance steps in programs (docs/plans/one-program-model.md).
// Data: pnpm db:seed-steps-demo. Run: pnpm journeys steps --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "steps-demo-password";
const account = (name: string, about: string) => ({ email: `steps-${name}@demo.local`, password: PASSWORD, about });

const set: JourneySet = {
  name: "steps",
  title: "Steps in programs",
  intro:
    "Swim, bike and run sessions planned as steps inside programs: the home screen, the workout screen, the guided run, the pool view, the step editor, and a lifter's screens, which must look as before.",
  homePath: "/",
  seed: ["pnpm", "exec", "tsx", "scripts/seed-steps-demo.ts"],
  accounts: {
    tri: account("tri", "trains for a triathlon, with run, swim, bike and brick programs as steps"),
    lift: account("lift", "lifts only"),
  },
  journeys: [
    { id: 1, title: "Today", summary: "Home and the week show today's run with its steps." },
    { id: 2, title: "Run the steps", summary: "Open today's workout, see the steps, start guided, finish and save the results." },
    { id: 3, title: "Swim and brick", summary: "Tomorrow's swim in the pool view, and a ride and run in one program." },
    { id: 4, title: "Edit steps", summary: "Open a run in the program editor, change a step, add a repeat block, save." },
    { id: 5, title: "Plain sets to steps", summary: "A run made before steps: Edit as steps, check, save." },
    { id: 6, title: "Lifter", summary: "A strength day, which must look as before." },
  ],
  flows: [
    {
      name: "tri",
      account: "tri",
      journeys: [1, 2, 3, 4, 5],
      async run({ page, step, go, shot, settle, sheet, closeSheet, linkByText }: Ctx) {
        await step("J1 home", async () => {
          await go("/");
          await shot(1, 1, "home", "Home: today's run with its steps and Endurance today");
        });
        await step("J1 week", async () => {
          await go("/week");
          await shot(1, 2, "week", "The week: planned time, distance and load per sport");
        });

        await step("J2 workout", async () => {
          await go("/");
          await page.getByRole("link", { name: /Start Today's Workout/ }).click();
          await page.waitForURL(/\/workout/);
          await settle(4500);
          await shot(2, 1, "workout", "Workout screen: totals, Start guided, the run's steps in one line");
        });
        await step("J2 sets", async () => {
          await page.getByRole("link", { name: /^Run/ }).first().click();
          await settle();
          await shot(2, 2, "sets", "The run's steps: kind, round and target");
          await page.goBack();
          await settle();
        });
        await step("J2 player", async () => {
          await page.getByRole("link", { name: "Start guided" }).click();
          await page.waitForURL(/\/play$/);
          await settle();
          await shot(2, 3, "player-ready", "The guided player before the start");
          await page.getByRole("button", { name: "Start", exact: true }).click();
          await settle();
          await shot(2, 4, "player-step", "The first step running");
          for (let i = 0; i < 12; i++) {
            const skip = page.getByRole("button", { name: /^(Skip|Lap)$/ }).first();
            if (!(await skip.isVisible().catch(() => false))) break;
            await skip.click();
            await settle(300);
          }
          await page.waitForURL(/\/results/);
          await settle();
          await shot(2, 5, "results-form", "Results after the run, before saving");
          await page.getByRole("button", { name: "7", exact: true }).click();
          await page.getByRole("button", { name: "Save" }).click();
          await page.waitForURL(/\/planned\/\d+$/);
          await settle();
          await shot(2, 6, "session-done", "The session page after saving");
        });
        await step("J2 results", async () => {
          await page.getByRole("link", { name: /Step results/ }).click();
          await settle();
          await shot(2, 7, "results-saved", "The saved results, planned against done per step");
        });

        await step("J3 swim", async () => {
          await go("/week");
          await page.getByTestId("week-session").filter({ hasText: "Swim" }).first().click();
          await settle();
          await shot(3, 1, "swim-session", "Tomorrow's swim: steps, send-off, CSS pace");
          await page.getByRole("link", { name: "Pool view" }).click();
          await settle();
          await shot(3, 2, "pool-view", "Pool view, block 1");
          await page.getByTestId("pool-block").click();
          await settle();
          await shot(3, 3, "pool-view-2", "Pool view, the 10 × 100 block");
        });
        await step("J3 brick", async () => {
          await go("/week");
          await page.getByTestId("week-session").filter({ hasText: "Brick" }).first().click();
          await settle();
          await shot(3, 4, "brick", "A ride and run in one program");
        });

        await step("J4 editor", async () => {
          await go("/programs");
          await go((await linkByText(/Run · Threshold/))!);
          await shot(4, 8, "program", "A step program: each exercise's steps in one line");
          await page.getByRole("link", { name: /^Run/ }).first().click();
          await settle();
          await shot(4, 1, "editor", "The step editor: warm-up, a 4 × block, cool-down");
          await page.getByTestId("step-block").getByTestId("step-row").first().click();
          await settle();
          await shot(4, 2, "step-sheet", "A step's sheet: kind, end, target in your own numbers");
          await sheet().getByLabel("Target from").fill("100");
          await sheet().getByLabel("Target to").fill("104");
          await shot(4, 3, "step-sheet-edited", "The target changed, with its pace", { small: false });
          await sheet().getByRole("button", { name: "Done" }).click();
          await settle();
          await page.getByRole("button", { name: "Add repeat block" }).click();
          await settle();
          await shot(4, 4, "block-added", "A second block added, not saved yet");
          await page.getByRole("button", { name: "Save steps" }).click();
          await settle(1500);
          await shot(4, 5, "saved", "Saved");
        });
        await step("J4 swim editor", async () => {
          await go("/programs");
          await go((await linkByText(/Swim · CSS/))!);
          await page.getByRole("link", { name: /^Swim/ }).first().click();
          await settle();
          await shot(4, 6, "swim-editor", "The swim editor: pool, strokes, send-off");
          await page.getByTestId("step-block").first().getByTestId("step-row").first().click();
          await settle();
          await shot(4, 7, "swim-step-sheet", "A swim step's sheet");
          await closeSheet();
        });

        await step("J5 plain", async () => {
          await go("/programs");
          await go((await linkByText(/Long Sunday run/))!);
          await shot(5, 1, "plain-program", "A program with a long name and plain run sets");
          await page.getByRole("link", { name: /^Run/ }).first().click();
          await settle();
          await shot(5, 2, "plain-sets", "Plain sets, with Edit as steps");
          await page.getByTestId("edit-as-steps").click();
          await settle();
          await shot(5, 3, "converted", "The plain sets as steps, not saved yet");
          await page.getByRole("button", { name: "Save steps" }).click();
          await settle(1500);
          await shot(5, 4, "converted-saved", "Saved as steps");
        });
      },
    },
    {
      name: "lift",
      account: "lift",
      journeys: [6],
      async run({ page, step, go, shot, settle, linkByText }: Ctx) {
        await step("J6 home", async () => {
          await go("/");
          await shot(6, 1, "home", "A lifter's home");
        });
        await step("J6 workout", async () => {
          await page.getByRole("link", { name: /Start Today's Workout/ }).click();
          await page.waitForURL(/\/workout/);
          await settle(4500);
          await shot(6, 2, "workout", "A strength workout screen");
          await page.getByRole("link", { name: /^Bench Press/ }).first().click();
          await settle();
          await shot(6, 3, "sets", "A strength set list");
        });
        await step("J6 editor", async () => {
          await go("/programs");
          await go((await linkByText(/Upper A/))!);
          await shot(6, 4, "program", "A strength program");
          await page.getByRole("link", { name: /^Bench Press/ }).first().click();
          await settle();
          await shot(6, 5, "program-sets", "A strength exercise in the program editor");
        });
      },
    },
  ],
};

export default set;
