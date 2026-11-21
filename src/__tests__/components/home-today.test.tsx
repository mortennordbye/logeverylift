// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * C1 in docs/home-widgets-audit.md, section 7: every size of Today keeps every
 * action. For each state the set of links and buttons at S, with its "More"
 * sheet open, equals the set at L. The error states keep a start link.
 */

vi.mock("@/components/features/SkipAutoDayButton", () => ({
  SkipAutoDayButton: ({ sessionId }: { sessionId: number }) => <button data-skip={sessionId}>I skipped it</button>,
}));
vi.mock("@/components/features/WorkoutInsightBanner", () => ({ WorkoutInsightBanner: () => null }));

const { todayWidget, TodayError } = await import("@/components/features/home/widgets/today/View");
const { enduranceTodayWidget } = await import("@/components/features/home/widgets/endurance-today/View");
type TodayData = Parameters<typeof todayWidget.View>[0]["data"];

const cycle = { name: "Block", currentWeek: 2, durationWeeks: 4, progressPct: 25, endFormatted: "Dec 4" };
const base: TodayData = {
  cycle,
  todayProgram: null,
  todaySessions: [],
  severalToday: false,
  completedToday: false,
  todayAutoSession: null,
  isRestDay: false,
  rotationOverdueDays: 0,
  insight: undefined,
  plan: null,
  upcoming: null,
};
const upcoming = { id: 29, name: "General: aerobic base + strength", startsOn: "2026-11-16", seasonName: "Jevnaker Half 2027" };
const prog = { id: 7, name: "Push" };
const session = (id: number, programId: number | null, done: boolean, autoSessionId: number | null = null) =>
  ({ plannedSessionId: id, slot: { program: programId ? { id: programId, name: `P${programId}` } : null, label: null }, done, autoSessionId }) as unknown as TodayData["todaySessions"][number];

const STATES: Record<string, TodayData> = {
  "one program, not done": { ...base, todayProgram: prog },
  "done manually": { ...base, todayProgram: prog, completedToday: true },
  "done automatically": { ...base, todayProgram: prog, completedToday: true, todayAutoSession: { id: 99 } },
  "several sessions": {
    ...base,
    severalToday: true,
    todaySessions: [session(1, 7, true, 50), session(2, 8, false), session(3, 9, false)],
  },
  "rest day": { ...base, isRestDay: true },
  "no program": { ...base },
  "done, no program": { ...base, completedToday: true },
  "no cycle": { ...base, cycle: null },
  "no cycle, one scheduled": { ...base, cycle: null, upcoming },
};

/** Every action on screen: link hrefs and skip buttons. */
function actions(root: HTMLElement): string[] {
  const links = within(root).queryAllByRole("link").map((a) => `link ${a.getAttribute("href")}`);
  const skips = Array.from(root.querySelectorAll("[data-skip]")).map((b) => `skip ${b.getAttribute("data-skip")}`);
  return [...new Set([...links, ...skips])].sort();
}

describe("Today keeps every action at every size (C1)", () => {
  for (const [state, data] of Object.entries(STATES)) {
    it(state, () => {
      const large = render(<>{todayWidget.View({ data, size: "l" })}</>);
      const atL = actions(large.container);
      large.unmount();

      const medium = render(<>{todayWidget.View({ data, size: "m" })}</>);
      expect(actions(medium.container)).toEqual(atL);
      medium.unmount();

      render(<>{todayWidget.View({ data, size: "s" })}</>);
      const more = screen.queryByRole("button", { name: "More actions" });
      if (more) fireEvent.click(more);
      expect(actions(document.body)).toEqual(atL);
      expect(atL.length).toBeGreaterThan(0);
    });
  }

  it("S shows the start button itself, not behind More", () => {
    render(<>{todayWidget.View({ data: STATES["one program, not done"], size: "s" })}</>);
    expect(screen.getByRole("link", { name: "Start Today's Workout" }).getAttribute("href")).toBe("/programs/7/workout");
  });

  it("no cycle: the set-up link's name has no arrow, at S and L", () => {
    for (const size of ["s", "l"] as const) {
      const r = render(<>{todayWidget.View({ data: STATES["no cycle"], size })}</>);
      expect(screen.getByRole("link", { name: "Set up a Cycle" }).getAttribute("href")).toBe("/cycles");
      r.unmount();
    }
  });

  it("no active cycle but one scheduled: names it, its start and its season, at every size", () => {
    for (const size of ["s", "m", "l"] as const) {
      const r = render(<>{todayWidget.View({ data: STATES["no cycle, one scheduled"], size })}</>);
      expect(screen.getByTestId("cycle-upcoming")).toBeTruthy();
      expect(screen.getByText("General: aerobic base + strength")).toBeTruthy();
      expect(screen.getByText(/Starts Mon, Nov 16/)).toBeTruthy();
      expect(screen.getByRole("link", { name: /See the plan/ }).getAttribute("href")).toBe("/cycles/29");
      expect(screen.queryByText("Plan your first block")).toBeNull();
      if (size !== "s") expect(screen.getByText("Jevnaker Half 2027")).toBeTruthy();
      r.unmount();
    }
  });

  it("S with several sessions starts the first open one", () => {
    render(<>{todayWidget.View({ data: STATES["several sessions"], size: "s" })}</>);
    expect(screen.getByText("3 sessions today")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start P8" }).getAttribute("href")).toBe("/programs/8/workout?planned=2");
  });
});

describe("error states keep a way to start (C1)", () => {
  it("Today's error links to /new-workout", () => {
    render(<TodayError />);
    expect(screen.getByText("Couldn't load this.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a Workout" }).getAttribute("href")).toBe("/new-workout");
  });

  it("Endurance today's error links to /new-workout", () => {
    render(<>{enduranceTodayWidget.Error!({ size: "m" })}</>);
    expect(screen.getByRole("link", { name: "Start a Workout" }).getAttribute("href")).toBe("/new-workout");
  });
});

describe("today's plan (owner decision A)", () => {
  const plan = {
    exerciseCount: 6,
    setCount: 24,
    minutes: 55,
    exercises: [
      { name: "Bench Press", sets: "4 × 6–8 · 80 kg" },
      { name: "Barbell Row", sets: "4 × 8 · 70 kg" },
      { name: "Overhead Press", sets: "3 × 8 · 47.5 kg" },
    ],
    more: ["Pull-up", "Lateral Raise", "Triceps Pushdown"],
  };
  const data = { ...STATES["one program, not done"], plan };

  it("L: the counts, the first three exercises and the rest by name", () => {
    render(<>{todayWidget.View({ data, size: "l" })}</>);
    expect(screen.getByText("6 exercises · 24 sets · about 55 min")).toBeTruthy();
    expect(screen.getByText("4 × 6–8 · 80 kg")).toBeTruthy();
    expect(screen.getByText("+ 3 more: Pull-up, Lateral Raise, Triceps Pushdown")).toBeTruthy();
  });

  it("M: the counts only; S: exercises and minutes", () => {
    const m = render(<>{todayWidget.View({ data, size: "m" })}</>);
    expect(screen.getByText("6 exercises · 24 sets · about 55 min")).toBeTruthy();
    expect(screen.queryByTestId("today-plan")).toBeNull();
    m.unmount();
    render(<>{todayWidget.View({ data, size: "s" })}</>);
    expect(screen.getByText("6 exercises · 55 min")).toBeTruthy();
  });
});


describe("the insight as the hero's tip", () => {
  it("shows the headline on one pill", () => {
    const insight = { type: "stagnating", headline: "Holding the same weights" } as TodayData["insight"];
    render(<>{todayWidget.View({ data: { ...STATES["one program, not done"], insight }, size: "l" })}</>);
    expect(screen.getByTestId("today-tip").textContent).toBe("Holding the same weights");
  });
});

describe("Start on a day with steps (docs/plans/one-program-model.md, home merge)", () => {
  it("asks guided or by hand for a step program, and starts at once on any other day", () => {
    const steps = { ...STATES["one program, not done"], guided: { href: "/planned/7/play", kind: "guided" as const } };
    const first = render(<>{todayWidget.View({ data: steps, size: "l" })}</>);
    fireEvent.click(screen.getByRole("button", { name: /Start Today's Workout/ }));
    const sheet = screen.getByTestId("start-choice");
    expect(within(sheet).getByRole("link", { name: /^Guided/ }).getAttribute("href")).toBe("/planned/7/play");
    expect(within(sheet).getByRole("link", { name: /^Log by hand/ }).getAttribute("href")).toMatch(/\/programs\/\d+\/workout$/);
    first.unmount();

    const swim = { ...STATES["one program, not done"], guided: { href: "/planned/8/pool", kind: "pool" as const } };
    const second = render(<>{todayWidget.View({ data: swim, size: "m" })}</>);
    fireEvent.click(screen.getByRole("button", { name: /Start Today's Workout/ }));
    expect(within(screen.getByTestId("start-choice")).getByRole("link", { name: /^Pool view/ }).getAttribute("href")).toBe("/planned/8/pool");
    second.unmount();

    render(<>{todayWidget.View({ data: STATES["one program, not done"], size: "l" })}</>);
    expect(screen.getByRole("link", { name: /Start Today's Workout/ }).getAttribute("href")).toMatch(/\/programs\/\d+\/workout$/);
    expect(screen.queryByRole("button", { name: /Start Today's Workout/ })).toBeNull();
  });
});


describe("Today on a run day (docs/plans/run-logger.md, planned day card)", () => {
  const plan = { exerciseCount: 1, setCount: 4, stepsOnly: true, minutes: 75, exercises: [{ name: "Run", sets: "10 min warm-up" }], more: [], runExerciseId: 3 };
  it("says the sport, the mode the run opens in and the time, at every size", () => {
    for (const size of ["l", "m", "s"] as const) {
      const r = render(<>{todayWidget.View({ data: { ...base, todayProgram: prog, plan: { ...plan, runMode: "indoor" } }, size })}</>);
      expect(r.container.textContent).toContain("Run · Treadmill · 75 min");
      r.unmount();
    }
  });
  it("keeps the counts when the mode is not read (no endurance features)", () => {
    render(<>{todayWidget.View({ data: { ...base, todayProgram: prog, plan }, size: "l" })}</>);
    expect(screen.getByText("1 exercise · 4 steps · about 75 min")).toBeTruthy();
  });
});
