// @vitest-environment jsdom
import { BodyOverview } from "@/components/features/garmin/BodySignals";
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
    floors: 18,
    distance: 11.3,
    activeTime: 108,
    calories: 3245,
    altitude: 97,
    boneMass: 6.3,
    bodyWater: 58.1,
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
    night: {
      date: "2026-11-12",
      deepS: 5100,
      lightS: 18600,
      remS: 6300,
      awakeS: 900,
      optimal: { deep: [16, 33], light: [30, 64], rem: [21, 31] },
      feedback: "POSITIVE_LONG_AND_DEEP",
      insight: "NEGATIVE_STRESSFUL_DAY",
      nextNeedMin: 510,
      bedtime: [1320, 1340],
      breathing: "NONE",
      lowestSpO2: 87,
      spo2Avg7: 97.4,
      napS: 1200,
      alignment: "BEHIND",
    },
    hrvStatus: { label: "Balanced", weeklyAvg: 89, nightHigh: 110 },
    floorGoal: 10,
    bmr: 2399,
    stepsWeek: ["05", "06", "07", "08", "09", "10", "11"].map((d, i) => ({ date: `2026-11-${d}`, steps: i === 1 ? null : 7000 + i * 1000 })),
    stepGoal: 10000,
  } as OverviewData;
}

describe("BodyOverview", () => {
  it("draws ratings you build as gauges and opens the sheet with the bands", () => {
    render(<BodyOverview data={data()} />);
    const vo2 = screen.getByRole("button", { name: /^VO2 max 51/ });
    expect(within(vo2).getByRole("img", { name: "51.0, Good" })).toBeTruthy();

    fireEvent.click(vo2);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Good for men aged 20–29: better than 60 to 80 % of them.")).toBeTruthy();
    expect(within(sheet).getByText(/is 0\.1 higher/)).toBeTruthy();
    expect(within(sheet).getByText("45.4–51.1")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: /Open Trends/ }).getAttribute("href")).toBe("/more/garmin?tab=trends");
  });

  it("shows trend signals as tiles with a chip, and last night's stages in one card", () => {
    render(<BodyOverview data={data()} />);
    expect(within(screen.getByRole("button", { name: /^HRV 75/ })).getByText("Balanced")).toBeTruthy();
    const night = screen.getByRole("region", { name: "Last night" });
    expect(within(night).getByRole("img", { name: /Deep 17 %, light 62 %, REM 21 %, awake 15 min/ })).toBeTruthy();
    expect(within(night).getByRole("button", { name: "Awake periods 2" })).toBeTruthy();

    fireEvent.click(within(night).getByRole("button", { name: "Deep sleep 17 %" }));
    expect(within(screen.getByRole("dialog")).getByText(/Garmin's range for your night is 16 to 33 %/)).toBeTruthy();
  });

  it("shows a week of steps against the goal, and body measures as rows", () => {
    render(<BodyOverview data={data()} />);
    const steps = screen.getByRole("button", { name: /^Steps 8,200/ });
    expect(within(steps).getByText("goal 10,000")).toBeTruthy();
    expect(within(steps).getByText("Somewhat active")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Muscle mass 37\.4/ })).toBeTruthy();
  });

  it("shows a grey gauge and a link to the profile field when a rating needs the user's gender", () => {
    render(<BodyOverview data={data({ sex: null })} />);
    const vo2 = screen.getByRole("button", { name: /^VO2 max/ });
    expect(within(vo2).getByRole("img", { name: "51.0, not rated" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Want a rating\? Add your gender/ }).getAttribute("href")).toBe("/more/account#body-profile");
    fireEvent.click(vo2);
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /Add your gender in Account/ }).getAttribute("href")).toBe("/more/account#body-profile");
  });
});

describe("BodyOverview: the rest of Garmin's day", () => {
  it("shows Garmin's verdict, tonight's need and the night's extra facts", () => {
    render(<BodyOverview data={data()} />);
    const night = screen.getByRole("region", { name: "Last night" });
    expect(within(night).getByText("Long and deep")).toBeTruthy();
    expect(within(night).getByText("Stressful day")).toBeTruthy();
    expect(within(night).getByText("8 h 30")).toBeTruthy();
    expect(within(night).getByText("22:00–22:20")).toBeTruthy();
    expect(within(night).getByText("low 87 · 7 d 97")).toBeTruthy();
    expect(within(night).getByText("Breathing variations").nextSibling?.textContent).toBe("None");
    expect(within(night).getByText("Sleep timing").nextSibling?.textContent).toBe("Behind");
    expect(within(night).getByText("Naps").nextSibling?.textContent).toBe("20 min");
    expect(within(screen.getByRole("button", { name: /^HRV 75/ })).getByText("last night · 7 d 89 · high 110")).toBeTruthy();
  });

  it("lists the day's activity and the body composition as rows", () => {
    render(<BodyOverview data={data()} />);
    const day = screen.getByRole("region", { name: "Day to day" });
    expect(within(within(day).getByRole("button", { name: /^Floors climbed 18/ })).getByText("last full day · goal 10")).toBeTruthy();
    expect(within(within(day).getByRole("button", { name: /^Calories 3,245/ })).getByText("last full day · 2,399 at rest")).toBeTruthy();
    for (const name of [/^Active time 108/, /^Distance 11\.3/, /^Altitude 97/]) expect(within(day).getByRole("button", { name })).toBeTruthy();
    const body = screen.getByRole("region", { name: "Body composition" });
    for (const name of [/^Weight 89\.7/, /^Muscle mass 37\.4/, /^Bone mass 6\.3/, /^Body water 58\.1/]) expect(within(body).getByRole("button", { name })).toBeTruthy();
  });
});
