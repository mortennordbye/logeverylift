// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HomeCore } from "@/lib/home/core";
import type { EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";

/**
 * The Today card on a bike day (docs/plans/bike-sessions.md, 5.1). A day with
 * only a bike workout has a slot with no program, so the hero read "Rest Day".
 */

vi.mock("@/components/features/SkipAutoDayButton", () => ({ SkipAutoDayButton: () => null }));

const { selectToday, todayWidget } = await import("@/components/features/home/widgets/today/View");

const ride: EnduranceTodayRow = {
  id: 41,
  name: "Tempo 2 x 15 min",
  sport: "bike",
  summary: null,
  amount: "65 min",
  done: false,
  priority: "support",
  bike: {
    totals: "65 min · 30 min at 135-144 W",
    blocks: [
      { seconds: 900, pct: 66, zone: 2, fuel: false },
      { seconds: 900, pct: 77.5, zone: 3, fuel: false },
    ],
    lines: [
      { label: "Warm-up", value: "15 min · 108-130 W", sub: "HR under 140" },
      { label: "Main set", value: "2 x 15 min · 135-144 W", sub: "HR 141-160 · 85-95 rpm" },
    ],
    chips: [{ text: "FTP 180 W", warn: false }],
  },
};

/** A weekday cycle whose slot today holds the bike workout and no program. */
const core = {
  info: { cycle: { name: "General: aerobic base + strength" }, currentWeek: 1, todaySlot: { id: 1, program: null } },
  totalWeeks: 8,
  progressPct: 0,
  endFormatted: "Jan 10",
  todayProgram: null,
  todaySessions: [{ plannedSessionId: 41, slot: { program: null, label: null }, done: false, autoSessionId: null }],
  severalToday: false,
  completedToday: false,
  todayAutoSession: null,
  isRestDay: true,
  rotationOverdueDays: 0,
  insight: undefined,
  todayPlan: null,
  upcoming: null,
  endurance: { today: [ride] },
} as unknown as HomeCore;

describe("Today on a bike day", () => {
  it("shows the ride, not Rest Day, at every size", () => {
    for (const size of ["s", "m", "l"] as const) {
      const r = render(<>{todayWidget.View({ data: selectToday(core), size })}</>);
      expect(screen.queryByText("Rest Day")).toBeNull();
      const card = screen.getByTestId("today-card");
      expect(within(card).getByText("Tempo 2 x 15 min")).toBeTruthy();
      expect(within(card).getByRole("link", { name: "Start guided" }).getAttribute("href")).toBe("/planned/41/play");
      expect(within(card).getByRole("link", { name: "Details" }).getAttribute("href")).toBe("/planned/41");
      r.unmount();
    }
  });

  it("a done ride shows Results and can still be started", () => {
    const doneCore = { ...core, endurance: { today: [{ ...ride, done: true }] } } as unknown as HomeCore;
    render(<>{todayWidget.View({ data: selectToday(doneCore), size: "l" })}</>);
    const card = screen.getByTestId("today-card");
    expect(within(card).getByRole("link", { name: "Results" }).getAttribute("href")).toBe("/planned/41");
    expect(within(card).getByRole("link", { name: "Start guided" }).getAttribute("href")).toBe("/planned/41/play");
  });

  it("L shows the totals, the lines and the FTP chip", () => {
    render(<>{todayWidget.View({ data: selectToday(core), size: "l" })}</>);
    const card = screen.getByTestId("today-card");
    expect(within(card).getByText("Today · Bike · Support")).toBeTruthy();
    expect(within(card).getByText("65 min · 30 min at 135-144 W")).toBeTruthy();
    expect(within(card).getByText("2 x 15 min · 135-144 W")).toBeTruthy();
    expect(within(card).getByText("HR 141-160 · 85-95 rpm")).toBeTruthy();
    expect(within(card).getByText("FTP 180 W")).toBeTruthy();
    expect(within(card).getByRole("img", { name: /Workout profile/ })).toBeTruthy();
  });

  it("a day with a program keeps the strength card", () => {
    const withProgram = { ...core, todayProgram: { id: 7, name: "Push" }, isRestDay: false } as unknown as HomeCore;
    render(<>{todayWidget.View({ data: selectToday(withProgram), size: "l" })}</>);
    expect(screen.getByText("Push")).toBeTruthy();
    expect(screen.queryByText("Tempo 2 x 15 min")).toBeNull();
  });

  it("a rest day with no session still reads Rest Day", () => {
    const rest = { ...core, endurance: { today: [] } } as unknown as HomeCore;
    render(<>{todayWidget.View({ data: selectToday(rest), size: "l" })}</>);
    expect(screen.getByText("Rest Day")).toBeTruthy();
  });
});
