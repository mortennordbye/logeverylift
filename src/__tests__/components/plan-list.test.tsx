// @vitest-environment jsdom
import { CyclesListClient } from "@/components/features/CyclesListClient";
import { deleteManyTrainingCycles } from "@/lib/actions/training-cycles";
import type { PlanListData } from "@/lib/plan-list";
import { seasonCard, weekDays, type HeroView } from "@/lib/utils/plan-list";
import type { PhaseLike } from "@/lib/utils/seasons";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Plan list's states (docs/plans/plan-tab-redesign.md, P1): first open,
 * a gym user's rotation, an endurance user's season, a goal season, and
 * select mode with the season-phase warning.
 */

vi.mock("@/lib/actions/training-cycles", () => ({ deleteManyTrainingCycles: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn(), replace: vi.fn() }) }));

const TODAY = "2026-11-14";
/** Text with the non-breaking spaces that keep dates whole read as plain spaces. */
const plain = (t: string | null) => (t ?? "").replace(/\u00a0/g, " ");

const none: PlanListData = {
  empty: false,
  hero: null,
  seasons: [],
  upNext: [],
  past: [],
  pastSeasons: [],
  select: { current: [], upNext: [], past: [] },
};

const phase = (id: number, name: string, phaseType: PhaseLike["phaseType"], len: { w?: number; d?: number }, extra: Partial<PhaseLike> = {}): PhaseLike => ({
  id,
  name,
  phaseOrder: id,
  phaseType,
  durationWeeks: len.w ?? Math.ceil((len.d ?? 7) / 7),
  durationDays: len.d ?? null,
  status: "draft",
  startDate: null,
  scheduledStartDate: null,
  ...extra,
});

const rotationHero: HeroView = {
  kind: "rotation",
  id: 1,
  name: "Upper / Lower hypertrophy",
  label: "Week 3 of 6 · Rotation",
  ends: "Ends 20 Dec",
  chips: [
    { id: 11, name: "Upper A", rest: false, tag: "Done" },
    { id: 12, name: "Lower A", rest: false, tag: "Next" },
    { id: 13, name: "Rest", rest: true, tag: null },
    { id: 14, name: "Upper B", rest: false, tag: "Skipped" },
    { id: 15, name: "Lower B", rest: false, tag: null },
  ],
  next: "Lower A",
};

const gym: PlanListData = {
  ...none,
  hero: rotationHero,
  upNext: [
    { id: 2, name: "Strength peak", sub: "4 weeks · Same days each week", starts: "Starts 21 Dec", startsAccent: true },
    { id: 6, name: "Deload week", sub: "1 week · Rotation", starts: "Not started", startsAccent: false },
  ],
  past: [
    { id: 3, name: "Strength 5×5", sub: "8 weeks · ended 8 Nov", starts: null, startsAccent: false },
    { id: 4, name: "Intro", sub: "4 weeks · ended 13 Sep", starts: null, startsAccent: false },
  ],
  select: {
    current: [{ id: 1, name: "Upper / Lower hypertrophy", sub: "Week 3 of 6 · Rotation" }],
    upNext: [{ id: 2, name: "Strength peak", sub: "4 weeks · Same days each week · Starts 21 Dec" }],
    past: [
      { id: 3, name: "Strength 5×5", sub: "8 weeks · ended 8 Nov" },
      { id: 4, name: "Intro", sub: "4 weeks · ended 13 Sep" },
    ],
  },
};

const jevnaker = seasonCard(
  { id: 9, name: "Jevnaker Half 2027", startDate: "2026-11-16", endDate: "2027-08-29", replanFlaggedAt: null },
  [
    phase(21, "Aerobic base + strength", "general", { w: 8 }, { scheduledStartDate: "2026-11-16" }),
    phase(22, "Longer ride and run", "base", { w: 12 }),
    phase(23, "Swim, intervals, bricks", "build", { w: 12 }),
    phase(24, "Race pace + open water", "build", { d: 53 }),
    phase(25, "Taper", "taper", { d: 10 }),
  ],
  { name: "Jevnaker Halv Full Distanse", raceDate: "2027-08-29" },
  TODAY,
);

const weekDates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
const s = (date: string, name: string, sport: "bike" | "run" | null, extra: { key?: boolean; brick?: boolean } = {}) => ({
  date,
  name,
  sport,
  sports: sport ? [sport] : [],
  key: extra.key ?? false,
  brick: extra.brick ?? false,
  skipped: false,
  durationSeconds: null,
});

const endurance: PlanListData = {
  ...none,
  hero: {
    kind: "week",
    id: 21,
    name: "Aerobic base + strength",
    label: "Starts Mon 16 Nov · Week 1 of 8",
    ends: "Ends 10 Jan",
    days: weekDays(
      weekDates,
      [
        s("2026-11-16", "Strength A", null),
        s("2026-11-17", "Bike tempo", "bike"),
        s("2026-11-18", "Run aerobic", "run"),
        s("2026-11-19", "Strength B", null),
        s("2026-11-22", "Long ride", "bike", { key: true }),
        s("2026-11-22", "Run off bike", "run", { brick: true }),
      ],
      TODAY,
      true,
    ),
    summary: "6 sessions · about 7 h",
  },
  seasons: [jevnaker],
  past: [{ id: 5, name: "Intro", sub: "4 weeks · ended 8 Nov", starts: null, startsAccent: false }],
  select: { current: [], upNext: [], past: [{ id: 5, name: "Intro", sub: "4 weeks · ended 8 Nov" }] },
};

const goalSeason = seasonCard(
  { id: 7, name: "Bench 120 kg by February", startDate: "2026-11-09", endDate: "2027-02-07", replanFlaggedAt: null },
  [
    phase(1, "Upper / Lower hypertrophy", "build", { w: 6 }, { status: "active", startDate: "2026-11-09" }),
    phase(2, "Strength peak", "peak", { w: 4 }, { scheduledStartDate: "2026-12-21" }),
    phase(6, "Peak and test", "peak", { w: 3 }),
  ],
  null,
  TODAY,
);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(deleteManyTrainingCycles).mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("the Plan list", () => {
  it("first open: New cycle and New season, no + and no Select", () => {
    render(<CyclesListClient data={{ ...none, empty: true }} deletedCount={0} />);
    expect(screen.getByRole("heading", { name: "Plan", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plan your training" })).toBeTruthy();
    expect(screen.getByText("When you train, in cycles and seasons")).toBeTruthy();
    // One way in per action: the card replaces the + menu while the list is empty.
    expect(screen.queryByRole("button", { name: "New cycle or season" })).toBeNull();
    // The same two choices as the + menu; the new cycle form asks how you train.
    const choices = within(screen.getByRole("navigation", { name: "Start planning" })).getAllByRole("link");
    expect(choices.map((a) => a.getAttribute("href"))).toEqual(["/cycles/new", "/seasons/new"]);
    expect(screen.queryByRole("link", { name: "Training for a race or a goal? Add a season" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByText(/Recently deleted/)).toBeNull();
  });

  it("the + menu offers a cycle and a season, and no triathlon plan", () => {
    render(<CyclesListClient data={gym} deletedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "New cycle or season" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("link", { name: /New cycle/ }).getAttribute("href")).toBe("/cycles/new");
    expect(within(sheet).getByRole("link", { name: /New season/ }).getAttribute("href")).toBe("/seasons/new");
    expect(within(sheet).queryByText(/Triathlon/)).toBeNull();
  });

  it("gym user: the rotation hero, up next, past cycles and recently deleted, with no season tip", () => {
    render(<CyclesListClient data={gym} deletedCount={1} />);
    const hero = screen.getByTestId("plan-hero");
    expect(hero.getAttribute("href")).toBe("/cycles/1");
    expect(within(hero).getByTestId("hero-label").textContent).toBe("Week 3 of 6 · Rotation");
    const chips = within(within(hero).getByRole("list", { name: "Rotation" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["DoneUpper A", "NextLower A", "Rest", "SkippedUpper B", "Lower B"]);
    expect(within(hero).getByText("Ends 20 Dec")).toBeTruthy();
    // The footer has no colon.
    expect(hero.textContent).toContain("Lower A is next");
    expect(hero.textContent).not.toContain(":");
    expect(screen.getByRole("heading", { name: "Up next" })).toBeTruthy();
    const starts = screen.getAllByTestId("scheduled-start");
    expect(starts.map((x) => plain(x.textContent))).toEqual(["Starts 21 Dec", "Not started"]);
    expect(starts[0].className).toContain("text-brand");
    expect(starts[1].className).toContain("text-muted-foreground");
    expect(screen.getByRole("heading", { name: "Past cycles" })).toBeTruthy();
    expect(screen.getByText("8 weeks · ended 8 Nov")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Recently deleted (1)" }).getAttribute("href")).toBe("/cycles/deleted");
    expect(screen.queryByTestId("season-card")).toBeNull();

    // No season tip: the + menu has New season.
    expect(screen.queryByText(/Add a season/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide season tip" })).toBeNull();
  });

  it("endurance user: the week strip with the key day, the season card with phases and the A race", () => {
    render(<CyclesListClient data={endurance} deletedCount={0} />);
    const hero = screen.getByTestId("plan-hero");
    expect(plain(within(hero).getByTestId("hero-label").textContent)).toBe("Starts Mon 16 Nov · Week 1 of 8");
    const days = within(within(hero).getByRole("list", { name: "This week" })).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(days[6].textContent).toContain("Brick");
    expect(days[6].textContent).toContain("key session");
    expect(days[6].className).toContain("ring-brand");
    expect(days[4].textContent).toContain("Rest");
    // A screen reader hears each day once: the day and what it holds, never "Rest Rest".
    const spoken = (el: HTMLElement) =>
      [...el.querySelectorAll("*")]
        .filter((n) => n.children.length === 0 && !n.closest("[aria-hidden='true']"))
        .map((n) => n.textContent)
        .join(" ");
    expect(spoken(days[4])).toBe("Fri, Rest");
    expect(spoken(days[6])).toBe("Sun, Long ride, Run off bike, key session");
    expect(within(hero).getByText("6 sessions · about 7 h")).toBeTruthy();

    const card = screen.getByTestId("season-card");
    expect(within(card).getByText("Jevnaker Half 2027")).toBeTruthy();
    expect(card.textContent).toContain("Race in 288 days");
    expect(within(card).getByRole("img", { name: /Phase bar/ })).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Longer ride and run.*Base · 12 wk · 11\sJan\s– 4\sApr/ }).getAttribute("href")).toBe("/cycles/22");
    expect(within(card).getByText("Starts Mon")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Jevnaker Halv Full Distanse.*A race · 29\sAug/ }).getAttribute("href")).toBe("/seasons/9");
  });

  it("gym user with a goal season: goal date, weeks left, the running phase marked Now", () => {
    render(<CyclesListClient data={{ ...gym, seasons: [goalSeason] }} deletedCount={0} />);
    const card = screen.getByTestId("season-card");
    expect(within(card).getByText("Season · Goal by 7 Feb")).toBeTruthy();
    expect(card.textContent).toContain("12weeks left");
    expect(within(card).getByText("Now").className).toContain("text-brand");
    expect(within(card).getByText("Starts 21 Dec").className).toContain("text-muted-foreground");
    expect(card.textContent).not.toContain("A race");
  });
});

describe("select mode", () => {
  it("locks the season, warns what deleting phases does, and deletes the selected cycles", async () => {
    vi.mocked(deleteManyTrainingCycles).mockResolvedValue({ success: true, data: undefined });
    render(<CyclesListClient data={endurance} deletedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Season cannot be selected here" })).toBeTruthy();
    expect(screen.getByText("Delete a season from its ⋯ menu.")).toBeTruthy();
    expect(screen.queryByTestId("phase-warning")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Longer ride and run" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Swim, intervals, bricks" }));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByTestId("phase-warning").textContent).toBe(
      "Both are phases of Jevnaker Half 2027. The later phases move 168 days earlier, so the taper will end before race day. You will need to re-plan.",
    );
    expect(screen.getByText("You can restore them for 90 days.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 2 cycles" }));
    });
    expect(vi.mocked(deleteManyTrainingCycles).mock.calls[0][0].sort()).toEqual([22, 23]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Plan", level: 1 })).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the selection and shows the error when the delete fails", async () => {
    vi.mocked(deleteManyTrainingCycles).mockResolvedValue({ success: false, error: "Finish the open workout first." });
    render(<CyclesListClient data={gym} deletedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Intro" }));
    expect(screen.queryByTestId("phase-warning")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 1 cycle" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Finish the open workout first.");
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("Select all picks every cycle, and Cancel goes back to the list", () => {
    render(<CyclesListClient data={gym} deletedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("4 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deselect all" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("plan-hero")).toBeTruthy();
  });
});
