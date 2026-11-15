// Journeys of the AI coach hub (docs/plans/ai-coach-hub.md). Data: pnpm db:seed-coach-demo.
// Run: pnpm journeys coach --seed
import type { Ctx, JourneySet } from "./types";

const PASSWORD = "coach-demo-password";
const account = (name: string, about: string) => ({ email: `coach-${name}@demo.local`, password: PASSWORD, about });

const set: JourneySet = {
  name: "coach",
  title: "AI coach hub",
  intro:
    "Screens from the real app, taken with demo accounts. A normal user without a plan, a normal user with a plan, and a power user with two connected assistants. Each step shows the phone at 390 px and a small phone at 320 px.",
  homePath: "/more",
  // Runs on the host: DATABASE_URL must point at the database the server uses.
  seed: ["npx", "tsx", "scripts/seed-coach-demo.ts"],
  accounts: {
    new: account("new", "has no plan, no notes and no assistant"),
    plan: account("plan", "has a plan from the builder, a due check-in and two notes"),
    power: account("power", "has a plan, Claude and a second assistant connected, changes and notes"),
  },
  journeys: [
    { id: 1, title: "A new user gets a plan", summary: "More, the hub, the builder picks, the building moment, the preview, and a change with no saved answer." },
    { id: 2, title: "A normal user with a plan", summary: "The hub with the check-in, notes for their own AI, and the two ways to their own AI." },
    { id: 3, title: "A power user with assistants", summary: "The assistant card, Connection, Changes with undo, and Memory." },
  ],
  flows: [
    {
      name: "new",
      account: "new",
      journeys: [1],
      async run({ page, step, go, shot, settle }: Ctx) {
        await step("J1 more", async () => {
          await go("/more");
          await shot(1, 1, "more", "More, with one AI row");
        });
        await step("J1 hub", async () => {
          await go("/more/ai-coach");
          await shot(1, 2, "hub-new", "The hub for a new user, one button");
          await page.getByRole("button", { name: /More options/ }).click();
          await shot(1, 3, "hub-more-options", "More options, open");
        });
        await step("J1 picks", async () => {
          await page.getByRole("link", { name: "Get a plan" }).click();
          await page.getByRole("radiogroup", { name: "Goal" }).waitFor();
          await settle();
          await shot(1, 4, "picks", "Your plan, the four main picks");
          await page.getByRole("button", { name: /More options/ }).click();
          await shot(1, 5, "picks-more", "Your plan, More options open");
        });
        await step("J1 building", async () => {
          await page.getByRole("button", { name: "Build my plan" }).click();
          await page.getByText("Building your plan").waitFor();
          await page.waitForTimeout(1_400);
          await shot(1, 6, "building", "Building your plan", { raw: true });
        });
        await step("J1 preview", async () => {
          await page.getByRole("button", { name: "Start this plan" }).waitFor({ timeout: 10_000 });
          await settle();
          await shot(1, 7, "preview", "The preview with Start this plan and Ask your coach");
        });
        await step("J1 no saved answer", async () => {
          await page.getByRole("group", { name: "Changes" }).getByRole("button", { name: "Swap exercises I name" }).click();
          await page.getByPlaceholder(/Which exercises\?/).fill("no lunges, my knee hurts");
          await page.getByRole("button", { name: "Change my plan" }).click();
          await page.getByText("No saved answer for this change yet").waitFor();
          await page.getByText("No saved answer for this change yet").scrollIntoViewIfNeeded();
          await shot(1, 8, "own-ai-needed", "A change with no saved answer points to the user's own AI");
        });
      },
    },
    {
      name: "plan",
      account: "plan",
      journeys: [2],
      async run({ page, step, go, shot, closeSheet }: Ctx) {
        await step("J2 hub", async () => {
          await go("/more/ai-coach");
          await shot(2, 1, "hub-plan", "The hub with a plan, the check-in and notes");
        });
        await step("J2 memory", async () => {
          await page.getByRole("link", { name: /What your coach knows/ }).click();
          await page.getByRole("heading", { name: "Memory" }).waitFor();
          await shot(2, 2, "memory-normal", "Memory for a normal user");
          await page.getByRole("button", { name: "Add an entry", exact: true }).click();
          await shot(2, 3, "memory-add", "Add a note");
          await closeSheet();
        });
        await step("J2 own chat", async () => {
          await go("/more/ai-coach/own-chat");
          await shot(2, 4, "own-chat", "Use your own AI chat");
        });
        await step("J2 connect", async () => {
          await go("/more/ai-coach/connect");
          await shot(2, 5, "connect", "Connect an assistant");
        });
      },
    },
    {
      name: "power",
      account: "power",
      journeys: [3],
      async run({ page, step, go, shot, closeSheet }: Ctx) {
        await step("J3 hub", async () => {
          await go("/more/ai-coach");
          await shot(3, 1, "hub-power", "The hub with the assistant card");
        });
        await step("J3 connection", async () => {
          await go("/more/assistants");
          await shot(3, 2, "connection", "Connection, two assistants");
          await page.getByRole("button", { name: "Disconnect" }).first().click();
          await shot(3, 3, "disconnect", "Disconnect sheet");
          await closeSheet();
        });
        await step("J3 changes", async () => {
          await go("/more/assistants/changes");
          await shot(3, 4, "changes", "Changes by conversation");
          await page.getByRole("button", { name: "Undo these changes" }).first().click();
          await shot(3, 5, "undo", "Undo sheet");
          await closeSheet();
        });
        await step("J3 memory", async () => {
          await go("/more/coach-memory");
          await shot(3, 6, "memory-power", "Memory with notes from Claude and the user");
        });
      },
    },
  ],
};

export default set;
