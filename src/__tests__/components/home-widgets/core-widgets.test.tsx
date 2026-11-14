// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** C3 for the small core widgets: Title, Cycle progress and Weekly goal at each size. */

vi.mock("@/components/ui/theme-provider", () => ({ useTheme: () => ({ weeklyGoal: 4 }) }));

const { titleWidget } = await import("@/components/features/home/widgets/title/View");
const { cycleWidget } = await import("@/components/features/home/widgets/cycle/View");
const { dateWidget } = await import("@/components/features/home/widgets/date/View");
const { weeklyGoalWidget } = await import("@/components/features/home/widgets/weekly-goal/View");

const cycle = { name: "Block", currentWeek: 2, durationWeeks: 4, progressPct: 25, endFormatted: "Dec 4" };

describe("Title", () => {
  it("M is the heading; L adds the date and the cycle week", () => {
    const m = render(<>{titleWidget.View({ data: { date: "Friday 13 November", cycleWeek: "Week 2 of 4" }, size: "m" })}</>);
    expect(screen.getByRole("heading", { name: "LogEveryLift" })).toBeTruthy();
    expect(screen.queryByText(/Friday/)).toBeNull();
    m.unmount();
    render(<>{titleWidget.View({ data: { date: "Friday 13 November", cycleWeek: "Week 2 of 4" }, size: "l" })}</>);
    expect(screen.getByText("Friday 13 November · Week 2 of 4")).toBeTruthy();
  });
});

describe("Cycle progress", () => {
  it("S shows the week; M the name, bar and end date", () => {
    const s = render(<>{cycleWidget.View({ data: cycle, size: "s" })}</>);
    expect(screen.getByRole("link", { name: "Block, week 2 of 4" }).getAttribute("href")).toBe("/cycles");
    expect(screen.getByText("2")).toBeTruthy();
    s.unmount();
    render(<>{cycleWidget.View({ data: cycle, size: "m" })}</>);
    expect(screen.getByText("Block")).toBeTruthy();
    expect(screen.getByText("ends Dec 4")).toBeTruthy();
  });

  it("empty: no cycle, with a link to set one up", () => {
    render(<>{cycleWidget.Empty({ size: "m" })}</>);
    expect(screen.getByRole("link", { name: "Set up a Cycle →" }).getAttribute("href")).toBe("/cycles");
  });
});

describe("Weekly goal", () => {
  it("shows workouts against the goal at S and M", () => {
    for (const size of ["s", "m"] as const) {
      const r = render(<>{weeklyGoalWidget.View({ data: { thisWeekWorkouts: 3 }, size })}</>);
      expect(screen.getByText("3")).toBeTruthy();
      expect(screen.getByText("of 4")).toBeTruthy();
      expect(screen.getByText("1 more to reach your goal")).toBeTruthy();
      r.unmount();
    }
  });
});

describe("Date (owner decision B)", () => {
  it("shows today's date from the user's zone, built on the server", () => {
    // 2026-11-14 is a Saturday; core.today is already the user's local day.
    const label = dateWidget.select!({ today: new Date(2026, 10, 14), info: null } as never)!;
    expect(label).toEqual({ label: "Saturday, 14 November" });
    render(<>{dateWidget.View({ data: label, size: "m" })}</>);
    expect(screen.getByTestId("date-widget").textContent).toBe("Saturday, 14 November");
  });
});
