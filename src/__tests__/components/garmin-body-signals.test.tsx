// @vitest-environment jsdom
import { BodySignals, SIGNAL_GROUPS } from "@/components/features/garmin/BodySignals";
import type { BodySignal } from "@/lib/garmin/analytics/overview";
import type { BodyKey, OverviewData } from "@/lib/garmin/queries";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const signal = (value: number | null): BodySignal => ({
  value,
  date: value === null ? null : "2026-11-12",
  points: value === null ? [] : [{ date: "2026-11-11", value }, { date: "2026-11-12", value }],
  normal: null,
  state: null,
});

function data(over: Partial<OverviewData["rating"]> = {}): OverviewData {
  const values: Record<BodyKey, number> = {
    sleep: 8.3,
    sleepScore: 81,
    hrv: 75,
    restingHr: 48,
    respiration: 15,
    bodyBattery: 91,
    vo2max: 51,
    fitnessAge: 18,
    weight: 89.7,
    deepSleep: 17,
    remSleep: 21,
    sleepStress: 19,
    awakeCount: 2,
    spo2: 96,
    sleepHr: 51,
    steps: 8200,
    stress: 33,
    sedentary: 13.8,
    muscleMass: 37.4,
  };
  const keys = Object.keys(values) as BodyKey[];
  return {
    body: Object.fromEntries(keys.map((k) => [k, signal(values[k])])) as OverviewData["body"],
    vo2Sport: "run",
    rating: {
      sex: "male",
      age: 23,
      hrvBaseline: { lowUpper: 76, balancedLow: 82, balancedUpper: 109, weeklyAvg: 89 },
      bodyFat: 20.4,
      bmi: 25.9,
      chronologicalAge: 23,
      sleepRanges: { deep: [16, 33], rem: [21, 31], awakeMax: 1 },
      ...over,
    },
  } as OverviewData;
}

describe("BodySignals", () => {
  it("rates each tile and opens a sheet with the scale and the next band", () => {
    render(<BodySignals data={data()} {...SIGNAL_GROUPS[0]} />);
    const vo2 = screen.getByRole("button", { name: /VO2 max/ });
    expect(within(vo2).getByText("Good")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^HRV/ })).getByText("Balanced")).toBeTruthy();

    fireEvent.click(vo2);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Good for men aged 20–29: better than 60 to 80 % of them.")).toBeTruthy();
    expect(within(sheet).getByText(/is 0\.1 higher/)).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: /Open Trends/ }).getAttribute("href")).toBe("/more/garmin?tab=trends");
  });

  it("points to Account when a rating needs the user's gender", () => {
    render(<BodySignals data={data({ sex: null })} {...SIGNAL_GROUPS[0]} />);
    const vo2 = screen.getByRole("button", { name: /VO2 max/ });
    expect(within(vo2).getByText("Tap to compare")).toBeTruthy();
    fireEvent.click(vo2);
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /Add your gender in Account/ }).getAttribute("href")).toBe("/more/account");
  });
});

describe("BodySignals: sleep quality and day to day", () => {
  it("rates against Garmin's ranges, and leaves tiles with no scale to your own normal", () => {
    render(<BodySignals data={data()} {...SIGNAL_GROUPS[1]} />);
    expect(within(screen.getByRole("button", { name: /^Deep sleep/ })).getByText("Optimal")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Awake periods/ })).getByText("More than optimal")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Sleep stress/ })).getByText("Rest")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Sleeping HR/ })).getByText("Learning your normal")).toBeTruthy();
  });

  it("shows steps as a 7-day average on the step categories", () => {
    render(<BodySignals data={data()} {...SIGNAL_GROUPS[2]} />);
    const steps = screen.getByRole("button", { name: /^Steps/ });
    expect(within(steps).getByText("7-day average")).toBeTruthy();
    expect(within(steps).getByText("Somewhat active")).toBeTruthy();
    fireEvent.click(steps);
    expect(within(screen.getByRole("dialog")).getByText((_, el) => el?.tagName === "P" && el.textContent === "Active is 1800 steps a day higher.")).toBeTruthy();
  });
});
