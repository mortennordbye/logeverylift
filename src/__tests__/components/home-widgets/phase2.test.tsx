// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * C3 for the phase 2 widgets (docs/home-widgets-audit.md, 6.6): each View at
 * each size, its empty state, its link, and a failing loader.
 */

const loads = vi.hoisted(() => ({ streak: vi.fn(), weight: vi.fn(), load: vi.fn(), sets: vi.fn(), race: vi.fn() }));
vi.mock("@/components/features/home/widgets/streak/load", () => ({ loadStreak: (...a: unknown[]) => loads.streak(...a) }));
vi.mock("@/components/features/home/widgets/body-weight/load", () => ({ loadBodyWeight: (...a: unknown[]) => loads.weight(...a) }));
vi.mock("@/components/features/home/widgets/training-load/load", () => ({ loadTrainingLoad: (...a: unknown[]) => loads.load(...a) }));
vi.mock("@/components/features/home/widgets/weekly-sets/load", () => ({ loadWeeklySets: (...a: unknown[]) => loads.sets(...a) }));
vi.mock("@/components/features/home/widgets/race-countdown/load", () => ({ loadRaceCountdown: (...a: unknown[]) => loads.race(...a) }));

const { streakWidget } = await import("@/components/features/home/widgets/streak/View");
const { bodyWeightWidget } = await import("@/components/features/home/widgets/body-weight/View");
const { trainingLoadWidget } = await import("@/components/features/home/widgets/training-load/View");
const { weeklySetsWidget } = await import("@/components/features/home/widgets/weekly-sets/View");
const { raceCountdownWidget } = await import("@/components/features/home/widgets/race-countdown/View");
const { streamedContent } = await import("@/components/features/home/render-widget");

const ctx = { userId: "u1", role: "user", today: "2026-11-14" };
const href = () => screen.getByRole("link").getAttribute("href");

describe("Streak", () => {
  const data = { weeks: 9, perWeek: [3, 4, 4, 3, 4, 5, 4, 2] };
  it("S: the weeks in a row; M adds the last 8 weeks", () => {
    const s = render(<>{streakWidget.View({ data, size: "s" })}</>);
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("weeks in a row")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /last 8 weeks/ })).toBeNull();
    expect(href()).toBe("/more/metrics");
    s.unmount();
    render(<>{streakWidget.View({ data, size: "m" })}</>);
    expect(screen.getByRole("img", { name: "Sessions per week, last 8 weeks: 3, 4, 4, 3, 4, 5, 4, 2" })).toBeTruthy();
  });
  it("S: asks to train only when this week has no workout yet", () => {
    const s = render(<>{streakWidget.View({ data, size: "s" })}</>);
    expect(screen.getByText("Keep it lit.")).toBeTruthy();
    expect(screen.queryByText("Train this week to keep it.")).toBeNull();
    s.unmount();
    render(<>{streakWidget.View({ data: { weeks: 9, perWeek: [3, 4, 4, 3, 4, 5, 4, 0] }, size: "s" })}</>);
    expect(screen.getByText("Train this week to keep it.")).toBeTruthy();
  });
  it("empty", () => {
    render(<>{streakWidget.Empty({ size: "s" })}</>);
    expect(screen.getByText("No streak yet. Train this week to start one.")).toBeTruthy();
  });
});

describe("Body weight", () => {
  const data = { latestKg: 82.4, changeKg: -0.7, lowKg: 82.3, highKg: 83.1, series: [83.1, 82.3, 82.4] };
  it("S: the latest weight, the change and a sparkline; M adds low and high", () => {
    const s = render(<>{bodyWeightWidget.View({ data, size: "s" })}</>);
    expect(screen.getByText("82.4")).toBeTruthy();
    expect(screen.getByText("↓ 0.7 kg in 30 days")).toBeTruthy();
    expect(s.container.querySelectorAll("svg.home-reveal path")).toHaveLength(2);
    expect(screen.queryByText(/Low/)).toBeNull();
    expect(href()).toBe("/more/metrics");
    s.unmount();
    render(<>{bodyWeightWidget.View({ data, size: "m" })}</>);
    expect(screen.getByText("Low 82.3 · High 83.1")).toBeTruthy();
  });
  it("one entry: no sparkline, says so", () => {
    const r = render(<>{bodyWeightWidget.View({ data: { ...data, changeKg: null, series: [82.4] }, size: "s" })}</>);
    expect(screen.getByText("No other entry in 30 days")).toBeTruthy();
    expect(r.container.querySelectorAll("svg.home-reveal path")).toHaveLength(0);
  });
  it("empty", () => {
    render(<>{bodyWeightWidget.Empty({ size: "s" })}</>);
    expect(screen.getByText(/No weight logged yet/)).toBeTruthy();
  });
});

describe("Training load", () => {
  const data = { loads: [0, 40, 0, 60], fatigue: [0, 10, 9, 20], form: 6, formLabel: "Fresh", weekLoad: 100, ramp: "normal" as const };
  it("M: form, band, week load and the chart; L adds the legend", () => {
    const m = render(<>{trainingLoadWidget.View({ data, size: "m" })}</>);
    expect(screen.getByText("+6")).toBeTruthy();
    expect(screen.getByText("Form · Fresh")).toBeTruthy();
    expect(screen.getByText("Load 100 this week")).toBeTruthy();
    expect(screen.getByText("Steady build")).toBeTruthy();
    expect(m.container.querySelectorAll("rect")).toHaveLength(2);
    expect(screen.queryByText("7-day trend")).toBeNull();
    expect(href()).toBe("/week");
    m.unmount();
    render(<>{trainingLoadWidget.View({ data, size: "l" })}</>);
    expect(screen.getByText("7-day trend")).toBeTruthy();
  });
  it("empty", () => {
    render(<>{trainingLoadWidget.Empty({ size: "m" })}</>);
    expect(screen.getByText("No training load in the last 4 weeks.")).toBeTruthy();
  });
});

describe("Weekly sets", () => {
  it("S: total sets and the top muscles against their target", () => {
    render(<>{weeklySetsWidget.View({ data: { total: 38, muscles: [{ name: "chest", sets: 10, target: 10 }, { name: "back", sets: 5, target: 10 }] }, size: "s" })}</>);
    expect(screen.getByText("38")).toBeTruthy();
    expect(screen.getByLabelText("Chest: 10 of 10 sets")).toBeTruthy();
    expect(screen.getByLabelText("Back: 5 of 10 sets")).toBeTruthy();
    expect(href()).toBe("/more/metrics");
  });
  it("empty", () => {
    render(<>{weeklySetsWidget.Empty({ size: "s" })}</>);
    expect(screen.getByText("No sets yet this week.")).toBeTruthy();
  });
});

describe("Race countdown", () => {
  it("S: days to go, the race and its date, linking to its season", () => {
    render(<>{raceCountdownWidget.View({ data: { name: "Oslo Half", dateLabel: "6 Dec", days: 22, seasonId: 5 }, size: "s" })}</>);
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("days to go")).toBeTruthy();
    expect(screen.getByText("Oslo Half · 6 Dec")).toBeTruthy();
    expect(href()).toBe("/seasons/5");
  });
  it("race day", () => {
    render(<>{raceCountdownWidget.View({ data: { name: "Oslo Half", dateLabel: "14 Nov", days: 0, seasonId: 5 }, size: "s" })}</>);
    expect(screen.getByText("race day")).toBeTruthy();
  });
  it("empty", () => {
    render(<>{raceCountdownWidget.Empty({ size: "s" })}</>);
    expect(screen.getByText("No race planned. Add one to a season.")).toBeTruthy();
  });
});

describe("a failing loader shows \"Couldn't load this.\", null shows the empty state", () => {
  const cases = [
    ["streak", streakWidget, loads.streak, /No streak yet/],
    ["bodyWeight", bodyWeightWidget, loads.weight, /No weight logged yet/],
    ["trainingLoad", trainingLoadWidget, loads.load, /No training load/],
    ["weeklySets", weeklySetsWidget, loads.sets, /No sets yet/],
    ["raceCountdown", raceCountdownWidget, loads.race, /No race planned/],
  ] as const;
  for (const [id, w, load, empty] of cases) {
    it(id, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      load.mockRejectedValueOnce(new Error("db down"));
      const r = render(<>{await streamedContent(id, w, ctx, w === trainingLoadWidget ? "m" : "s")}</>);
      expect(screen.getByText("Couldn't load this.")).toBeTruthy();
      r.unmount();
      load.mockResolvedValueOnce(null);
      render(<>{await streamedContent(id, w, ctx, "s")}</>);
      expect(screen.getByText(empty)).toBeTruthy();
    });
  }
});
