// Journeys of the Plan tab (docs/plans/plan-tab-redesign.md). Data: pnpm db:seed-plan-demo.
// Run: pnpm journeys plan --seed
import { execFileSync } from "node:child_process";
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "plan-demo-password";
const account = (name: string, about: string) => ({ email: `plan-${name}@demo.local`, password: PASSWORD, about });

/** Runs SQL on the local dev database and returns the first value. */
const sqlValue = (sql: string) =>
  execFileSync("docker", ["exec", "logeverylift-postgres", "psql", "-U", "postgres", "-d", "logeverylift_db", "-Atc", sql])
    .toString()
    .trim()
    .split("\n")[0];

/** Caches a lookup that needs the page, so it runs inside the first step that needs it. */
const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
};

const set: JourneySet = {
  name: "plan",
  title: "Plan tab",
  intro:
    "Screens from the real app, taken with demo accounts full of edge cases. Each step shows the phone at 390 px and, where it matters, a small phone at 320 px.",
  homePath: "/cycles",
  seed: ["docker", "exec", "logeverylift-app", "pnpm", "db:seed-plan-demo"],
  accounts: {
    empty: account("empty", "has no plan"),
    gym: account("gym", "runs a rotation"),
    edge2: account("edge2", "holds a rotation with a skip and a swap"),
    goal: account("goal", "has a goal season"),
    race: account("race", "has a triathlon season"),
    edge: account("edge", "holds long names, three sessions a day, a moved race and a paused season"),
  },
  journeys: [
    { id: 1, title: "First open", summary: "A new user opens Plan and starts a cycle or a season." },
    { id: 2, title: "Gym user sets up a rotation cycle", summary: "No season, no race. Name the block, put the sessions in order, create it." },
    { id: 3, title: "Gym user trains the block", summary: "See what is next, start it, skip or swap, finish the block." },
    { id: 4, title: "Endurance user plans a season", summary: "A race in August. Make the season, fix phases and races, react to a moved race date." },
    { id: 5, title: "Endurance user trains the week", summary: "Dated sessions. Move, swap, label, skip, and answer for past days." },
    { id: 6, title: "Gym user with a goal season", summary: "A season with a goal and no race." },
    { id: 7, title: "Clean up", summary: "Select, delete with the season warning, restore, deleted pages." },
    { id: 8, title: "Edge cases and other screens", summary: "Long names, drafts, history, the template page, loading and light theme." },
  ],
  flows: [
    {
      name: "empty",
      account: "empty",
      journeys: [1],
      async run({ step, go, shot }: Ctx) {
        await step("J1 empty", async () => {
          await go("/cycles");
          await shot(1, 1, "empty-plan", "First open, an empty Plan");
        });
      },
    },
    {
      name: "gym",
      account: "gym",
      journeys: [1, 2, 3, 7, 8],
      async run({ page, step, go, shot, settle, sheet, closeSheet, linkByText }: Ctx) {
        const rotation = once(async () => {
          await go("/cycles");
          return (await linkByText(/Upper \/ Lower hypertrophy/))!;
        });
        await step("J1 add menu", async () => {
          await go("/cycles");
          await page.getByRole("button", { name: "New cycle or season" }).click();
          await shot(1, 2, "add-menu", "The + menu: New cycle, New season");
          await closeSheet();
        });
        await step("J3 plan list", async () => {
          await go("/cycles");
          await shot(3, 1, "plan-list-gym", "Plan list, gym user with a running rotation");
        });
        await step("J3 rotation detail", async () => {
          await go(await rotation());
          await shot(3, 2, "rotation-detail", "Rotation detail with order and next session");
        });
        await step("J3 today sheet", async () => {
          await go(await rotation());
          await page.getByRole("button", { name: /Lower A/ }).first().click();
          await shot(3, 3, "today-session-sheet", "Today's session sheet on the rotation");
          await closeSheet();
        });
        await step("J3 cycle complete", async () => {
          await go("/cycles");
          await go((await linkByText(/Strength 5×5/))!);
          await shot(3, 7, "cycle-complete", "Completed cycle with the next cycle named");
        });
        await step("J3 start confirm", async () => {
          await go("/cycles");
          await go((await linkByText(/Strength peak/))!);
          await shot(3, 8, "draft-scheduled", "Scheduled draft Strength peak before start", { small: false });
          await page.getByRole("button", { name: /Start today instead|^Start/ }).first().click();
          await shot(3, 9, "start-confirm", "Start confirm that names the running cycle");
          await closeSheet();
        });
        // J2 needs the running cycle and the scheduled draft of this account.
        await step("J2 step1", async () => {
          const weeks = () => page.getByRole("spinbutton", { name: "Length in weeks" });
          await go("/cycles/new");
          await shot(2, 1, "new-cycle-step1", "New cycle step 1, defaults");
          await page.getByRole("button", { name: "Custom" }).click();
          await weeks().fill("7");
          await shot(2, 2, "custom-length-7", "Custom length field with 7 weeks");
          await weeks().fill("60");
          await weeks().blur();
          await shot(2, 3, "custom-length-60", "Custom length 60, out of range", { small: false });
          await weeks().fill("6");
          await page.getByRole("button", { name: "Pick a date" }).click();
          await shot(2, 4, "pick-a-date", "Pick a date open");
          await page.getByRole("textbox", { name: "Start day" }).fill("2026-12-07");
          await shot(2, 5, "replaces-draft-start", "A picked date that replaces another draft's start", { small: false });
          await page.getByRole("button", { name: "After current cycle" }).click();
          await shot(2, 6, "after-current-cycle", "After current cycle chosen", { small: false });
        });
        await step("J2 step2 rotation", async () => {
          const addProgram = async (name: string) => {
            await page.getByRole("button", { name: "+ Add session" }).click();
            await sheet().getByRole("searchbox", { name: "Search programs" }).fill("");
            await sheet().getByRole("button", { name: new RegExp(name) }).first().click();
            await settle();
          };
          await go("/cycles/new");
          await page.getByLabel("Name").fill("Push / Pull rotation");
          await page.getByText("Rotation", { exact: true }).click();
          await page.getByRole("button", { name: "After current cycle" }).click();
          await page.getByRole("button", { name: "Put the sessions in order" }).click();
          await settle();
          await shot(2, 7, "rotation-builder-empty", "Step 2, empty rotation order");
          await page.getByRole("button", { name: "+ Add session" }).click();
          await shot(2, 8, "program-picker", "Program picker sheet");
          await page.getByRole("searchbox", { name: "Search programs" }).fill("upper");
          await shot(2, 9, "program-picker-search", "Program picker with search typed", { small: false });
          await sheet().getByRole("button", { name: /Upper A/ }).first().click();
          await settle();
          await addProgram("Lower A");
          await page.getByRole("button", { name: "+ Add rest day" }).click();
          await settle();
          await addProgram("Upper B");
          await addProgram("Lower B");
          await shot(2, 10, "rotation-builder-filled", "Step 2, rotation order with five positions");
          await page.getByRole("button", { name: /Options for/ }).first().click();
          await shot(2, 11, "row-options-sheet", "Options sheet of one rotation row");
          await closeSheet();
          await page.getByRole("button", { name: "Cancel" }).click();
          await shot(2, 12, "discard-sheet", "Discard this cycle sheet");
          await page.getByRole("button", { name: "Keep building" }).click();
          await page.getByRole("button", { name: "Create cycle" }).click();
          await page.waitForURL((u) => !u.pathname.startsWith("/cycles/new"), { timeout: 20000 }).catch(() => {});
          await settle();
          await shot(2, 13, "created-cycle", "Right after Create cycle", { small: false });
          await go("/cycles");
          await shot(2, 14, "plan-after-create", "Plan list with the new cycle under Up next", { small: false });
        });
        await step("J7 select gym", async () => {
          await go("/cycles");
          await page.getByRole("button", { name: "Select" }).click();
          await shot(7, 1, "select-mode-gym", "Select mode, gym user", { small: false });
          await page.getByRole("button", { name: "Cancel" }).or(page.getByRole("button", { name: "Done" })).first().click().catch(() => {});
        });
        await step("J8 light", async () => {
          // The app keeps its own theme (Settings, localStorage "theme"), not the phone's.
          await page.evaluate(() => localStorage.setItem("theme", "light"));
          await go("/cycles");
          await shot(8, 20, "light-plan-list", "Plan list with the app theme set to light", { small: false });
          await go(await rotation());
          await shot(8, 21, "light-rotation-detail", "Rotation detail with the app theme set to light", { small: false });
          await page.getByRole("button", { name: /Lower A/ }).first().click();
          await shot(8, 22, "light-session-sheet", "Session sheet with the app theme set to light", { small: false });
          await page.evaluate(() => localStorage.setItem("theme", "dark"));
        });
      },
    },
    {
      name: "edge2",
      account: "edge2",
      journeys: [3],
      async run({ page, step, go, shot, closeSheet, hrefOf }: Ctx) {
        await step("J3 edge2 list", async () => {
          await go("/cycles");
          await shot(3, 5, "hero-skip-swap", "Hero rotation chips after a skip and a swap");
        });
        await step("J3 edge2 detail", async () => {
          await go("/cycles");
          await go((await hrefOf(/^\/cycles\/\d+$/))!);
          await shot(3, 4, "rotation-skip-swap", "Rotation detail with a skipped and a swapped position");
          await page.getByRole("button", { name: /Upper B/ }).first().click();
          await shot(3, 6, "rotation-skipped-sheet", "Sheet of the skipped rotation session", { small: false });
          await closeSheet();
          await page.getByRole("button", { name: /Full body express/ }).first().click();
          await shot(3, 10, "rotation-swapped-sheet", "Sheet of the swapped rotation session", { small: false });
          await closeSheet();
        });
      },
    },
    {
      name: "goal",
      account: "goal",
      journeys: [6],
      async run({ step, go, shot, hrefOf }: Ctx) {
        await step("J6 goal season", async () => {
          await go("/cycles");
          await shot(6, 1, "plan-list-goal", "Plan list with a goal season");
          await go((await hrefOf(/^\/seasons\/\d+$/))!);
          await shot(6, 2, "goal-season-detail", "Goal season detail without a race");
        });
      },
    },
    {
      name: "race",
      account: "race",
      journeys: [4, 5],
      async run({ page, step, go, shot, settle, sheet, closeSheet, dialogOpen, hrefOf }: Ctx) {
        const season = once(async () => {
          await go("/cycles");
          return (await hrefOf(/^\/seasons\/\d+$/))!;
        });
        const fillNewSeason = async () => {
          await page.getByRole("textbox", { name: "Name", exact: true }).fill("Oslo half 2027");
          await page.getByRole("textbox", { name: "Race name" }).fill("Oslo Half Distance");
          await page.getByRole("textbox", { name: "Race date" }).fill("2027-09-05");
        };
        await step("J4 race hero", async () => {
          await go("/cycles");
          await shot(4, 20, "plan-list-race", "Plan list with a race season and the week hero");
        });
        await step("J5 race detail", async () => {
          await go("/cycles");
          await go((await hrefOf(/^\/cycles\/\d+$/))!);
          await shot(5, 20, "race-cycle-week", "Race account cycle detail, this week with the brick", { small: false });
        });
        await step("J4 new season", async () => {
          await go("/seasons/new");
          await shot(4, 1, "new-season-empty", "New season, empty");
          await fillNewSeason();
          await page.getByRole("textbox", { name: "Goal", exact: true }).fill("Finish under 5 h 30");
          await shot(4, 2, "new-season-race", "New season with the race filled", { small: false });
          await page.getByText("Make a triathlon plan", { exact: true }).click();
          await shot(4, 3, "triathlon-preview", "Make a triathlon plan with the phase preview");
        });
        await step("J4 season detail", async () => {
          const unit = (name: string) =>
            sheet().getByRole("button", { name, exact: true }).or(sheet().getByRole("radio", { name })).first();
          await go(await season());
          await shot(4, 4, "season-detail", "Season detail of the triathlon plan");
          await page.getByRole("button", { name: /^Longer ride and run/ }).click();
          await shot(4, 5, "phase-sheet", "Phase sheet with type and length in weeks");
          await unit("Days").click();
          await shot(4, 6, "phase-sheet-days", "Phase sheet with length in days", { small: false });
          await sheet().getByLabel("Length", { exact: true }).fill("10");
          await unit("Weeks").click();
          await shot(4, 25, "phase-sheet-days-to-weeks", "Phase sheet, 10 days switched to Weeks");
          await closeSheet();
          await page.getByRole("button", { name: /^A race/ }).click();
          await shot(4, 7, "race-sheet", "Race sheet");
          await sheet().getByLabel("Date").fill("2026-11-01");
          await sheet().getByRole("button", { name: "Save race" }).click();
          await settle();
          await shot(4, 8, "race-date-refused", "Race date in the past is refused", { small: false });
          await closeSheet();
          await page.getByRole("button", { name: "More actions" }).click();
          await shot(4, 15, "season-menu", "Season ⋯ menu", { small: false });
          await page.getByRole("button", { name: "Delete season" }).click();
          await shot(4, 16, "season-delete-confirm", "Delete season confirm");
          await closeSheet();
        });
        await step("J4 add phase", async () => {
          await go(`${await season()}/phases/new`);
          await shot(4, 9, "add-phase-step1", "Add a phase, step 1");
          await page.getByRole("textbox").first().fill("Recovery block");
          await page.getByRole("button", { name: /Next|Continue|Build the week|Add phase/ }).last().click();
          await page.waitForURL(/\/week/, { timeout: 20000 }).catch(() => {});
          await settle();
          await shot(4, 10, "add-phase-step2", "Add a phase, step 2, the week");
          await page.getByRole("button", { name: "Cancel" }).first().click();
          await shot(4, 23, "add-phase-remove-confirm", "Add a phase step 2, Cancel offers Remove this phase");
          await sheet().getByRole("button", { name: "Remove phase" }).click();
          await page.waitForURL(/\/seasons\/\d+$/, { timeout: 20000 });
          await settle();
          await shot(4, 24, "after-remove-phase", "Season after the new phase was removed", { small: false });
        });
        await step("J4 create season", async () => {
          await go("/seasons/new");
          await fillNewSeason();
          await page.getByText("Make a triathlon plan", { exact: true }).click();
          await page.getByRole("button", { name: "Create season" }).click();
          await settle();
          if (await dialogOpen()) {
            await shot(4, 22, "create-season-confirm", "Confirm before the new season takes the start");
            await sheet().getByRole("button", { name: "Create season" }).click();
          }
          await page.waitForURL(/\/seasons\/\d+$/, { timeout: 30000 });
          await settle();
          await shot(4, 17, "created-season", "The season just made with Make a triathlon plan");
        });
      },
    },
    {
      name: "race2",
      account: "race",
      journeys: [4, 8],
      async run({ page, base, step, go, shot, settle, hrefOf }: Ctx) {
        await step("J4 after second season", async () => {
          await go("/cycles");
          await shot(4, 18, "plan-after-second-season", "Race Plan list after a second triathlon season was made", { small: false });
        });
        await step("J8 skeleton direct", async () => {
          await go("/cycles");
          const s = await hrefOf(/^\/seasons\/\d+$/);
          for (const [i, wait] of [[11, 150], [12, 400]] as const) {
            await page.goto(`${base}${s}`, { waitUntil: "commit" });
            await page.waitForTimeout(wait);
            await shot(8, i, `loading-direct-${wait}ms`, `Season page ${wait} ms after the request`, { raw: true });
            await settle();
          }
        });
      },
    },
    {
      name: "edge",
      account: "edge",
      journeys: [4, 5, 7, 8],
      async run({ page, step, go, shot, settle, sheet, closeSheet, dialogOpen, hrefOf, linkByText }: Ctx) {
        const lookups = once(async () => {
          await go("/cycles");
          const running = (await hrefOf(/^\/cycles\/\d+$/))!;
          const seasons = await page
            .locator("a[href^='/seasons/']")
            .evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
          const paused = (await page
            .getByRole("region", { name: "Winter run base" })
            .locator("a[href^='/seasons/']")
            .first()
            .getAttribute("href"))!;
          const replan = seasons.find((s) => s !== paused)!;
          return { running, paused, replan };
        });
        const nextWeek = async () => {
          await go((await lookups()).running);
          await page.getByRole("button", { name: "Next week" }).click();
          await settle();
        };
        const moreActions = async () => {
          await go((await lookups()).running);
          await page.getByRole("button", { name: "More actions" }).click();
        };
        await step("J8 edge list", async () => {
          await go("/cycles");
          await shot(8, 1, "plan-list-edge", "Plan list with long names, two seasons and drafts");
        });
        await step("J4 replan", async () => {
          await go((await lookups()).replan);
          await shot(4, 11, "replan-banner", "Re-plan banner and taper that does not end on race day");
        });
        await step("J4 paused", async () => {
          await go((await lookups()).paused);
          await shot(4, 13, "paused-resume", "Paused season chain with Resume");
        });
        await step("J5 week", async () => {
          await go((await lookups()).running);
          await shot(5, 1, "cycle-week-current", "Cycle detail, this week, three sessions on Wednesday");
          await page.getByRole("button", { name: "Next week" }).click();
          await settle();
          await shot(5, 2, "cycle-week-next", "Cycle detail, next week with skipped, moved and changed days");
        });
        await step("J5 future sheet", async () => {
          const monday = () => page.getByRole("button", { name: /^Mon \d+ \w+:/ }).first();
          await nextWeek();
          await monday().click();
          await shot(5, 3, "future-session-sheet", "Future session sheet");
          await sheet().getByRole("button", { name: /Move to another day/ }).click();
          await shot(5, 4, "future-move-open", "Move to another day open", { small: false });
          await sheet().getByRole("button", { name: /Move to another day/ }).click();
          await sheet().getByRole("button", { name: /Swap program/ }).click();
          await shot(5, 5, "swap-program-list", "Swap program list", { small: false });
          await closeSheet();
          await monday().click();
          await sheet().getByRole("button", { name: /Label and note/ }).click();
          await shot(5, 6, "label-and-note", "Label and note form", { small: false });
          await closeSheet();
        });
        await step("J5 changed", async () => {
          await nextWeek();
          await page.getByRole("button", { name: /Hill repeats/ }).first().click();
          await shot(5, 7, "changed-back-to-template", "Changed session with Back to the template", { small: false });
          await closeSheet();
        });
        await step("J5 skipped", async () => {
          await nextWeek();
          await page.getByRole("button", { name: /Bike intervals/ }).first().click();
          await shot(5, 8, "skipped-plan-again", "Skipped session with Plan again", { small: false });
          await closeSheet();
        });
        await step("J5 did you do it", async () => {
          await go((await lookups()).running);
          await page.getByRole("button", { name: /Swim technique, Did you do it/ }).click();
          await shot(5, 9, "did-you-do-it", "Did you do it? sheet");
          await sheet().getByRole("button", { name: /^Yes, I did/ }).click();
          await shot(5, 10, "did-you-do-it-yes", "Yes form with time, distance, effort");
          await closeSheet();
          await page.getByRole("button", { name: "Previous week" }).click();
          await settle();
          await shot(5, 11, "last-week", "Last week with an unconfirmed ride", { small: false });
          await page.getByRole("button", { name: /Did you do it/ }).first().click();
          await sheet().getByRole("button", { name: "Missed", exact: true }).click();
          await shot(5, 12, "did-you-do-it-missed", "Did you do it? with Missed chosen", { small: false });
          const save = sheet().getByRole("button", { name: /^Save/ });
          if (await save.count()) await save.first().click();
          await settle();
          await shot(5, 16, "after-missed", "Last week after answering Missed", { small: false });
        });
        await step("J5 missed key", async () => {
          await go((await lookups()).running);
          await page.getByRole("button", { name: /Bike intervals.*Missed/ }).click();
          await shot(5, 13, "missed-key-move", "Missed key session with Move to suggestion");
          await sheet().getByRole("button", { name: /^Move to (?!another)/ }).click();
          await settle();
          await shot(5, 14, "after-move", "This week after the move", { small: false });
          await page.getByRole("button", { name: /Run tempo.*Missed/ }).click();
          await shot(5, 15, "missed-key-no-free-day", "Missed key session with no free day left");
          await closeSheet();
        });
        await step("J8 cycle menu", async () => {
          const { running } = await lookups();
          await moreActions();
          await shot(8, 2, "cycle-menu", "Cycle ⋯ menu");
          await sheet().getByRole("link", { name: "Edit details" }).click();
          await page.waitForURL(/edit/, { timeout: 15000 });
          await settle();
          await shot(8, 3, "edit-details", "Edit details form");
          await moreActions();
          await sheet().getByRole("link", { name: "Change history" }).click();
          await page.waitForURL(/history/, { timeout: 15000 });
          await settle();
          await shot(8, 4, "change-history", "Change history", { small: false });
          await go(`${running}/template`);
          await shot(8, 5, "template", "Weekly template page");
          await moreActions();
          await sheet().getByRole("button", { name: /Delete/ }).click();
          await shot(8, 6, "cycle-delete-confirm", "Delete cycle confirm", { small: false });
          await closeSheet();
        });
        await step("J8 drafts", async () => {
          const open = async (name: RegExp) => {
            await go("/cycles");
            await go((await linkByText(name))!);
          };
          await open(/Strength upkeep/);
          await shot(8, 7, "draft-scheduled", "Scheduled draft, Starts and Start today instead");
          await open(/Hill strength/);
          await shot(8, 8, "draft-not-started", "Draft that is not started, long name");
          await open(/^Aerobic base/);
          await shot(8, 9, "completed-phase-next", "Completed phase with the next cycle scheduled");
        });
        await step("J7 select", async () => {
          await go("/cycles");
          await page.getByRole("button", { name: "Select" }).click();
          await settle();
          await shot(7, 2, "select-mode", "Select mode");
          await page.getByText("Run build", { exact: true }).first().click();
          await page.getByText("Spring run block", { exact: true }).first().click();
          await shot(7, 3, "select-season-phase-warning", "A season phase selected, with the warning");
        });
        await step("J7 deleted pages", async () => {
          const owner = `join "user" u on u.id = t.user_id where u.email = 'plan-edge@demo.local' and t.deleted_at is not null limit 1`;
          await go(`/cycles/${sqlValue(`select t.id from training_cycles t ${owner}`)}`);
          await shot(7, 7, "deleted-cycle-page", "Opening a deleted cycle");
          await go(`/seasons/${sqlValue(`select t.id from seasons t ${owner}`)}`);
          await shot(7, 8, "deleted-season-page", "Opening a deleted season", { small: false });
        });
        await step("J7 deleted", async () => {
          await go("/cycles/deleted");
          await shot(7, 4, "recently-deleted", "Recently deleted list");
          await page.getByRole("button", { name: /Restore/ }).first().click();
          await settle();
          await shot(7, 5, "after-restore", "Recently deleted after a restore", { small: false });
          await go("/cycles");
          await shot(7, 6, "plan-after-restore", "Plan list after the restore", { small: false });
        });
        await step("J4 fit taper", async () => {
          await go((await lookups()).replan);
          await page.getByRole("button", { name: "Fit the taper" }).click();
          await settle(1200);
          await shot(4, 12, "after-fit-taper", "Season after Fit the taper", { small: false });
        });
        await step("J4 resume", async () => {
          await go((await lookups()).paused);
          await page.getByRole("button", { name: "Resume" }).click();
          await settle();
          if (await dialogOpen()) {
            await shot(4, 21, "resume-confirm", "Confirm before Resume takes the start");
            await sheet().getByRole("button", { name: "Resume season" }).click();
          }
          await settle(1200);
          await shot(4, 14, "after-resume", "Season after Resume", { small: false });
        });
        await step("J8 skeleton", async () => {
          // Slow network, so the loading skeleton stays on screen long enough to capture.
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 2500, downloadThroughput: 50000, uploadThroughput: 50000 });
          await go("/cycles");
          await page.getByRole("link", { name: /Winter run base/ }).first().click();
          // The skeleton itself, not the old page dimmed while the request starts.
          await page.getByTestId("season-skeleton").waitFor({ state: "visible", timeout: 15_000 });
          await shot(8, 10, "loading-skeleton", "Loading skeleton while a season opens", { raw: true });
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        });
      },
    },
  ],
};

export default set;
