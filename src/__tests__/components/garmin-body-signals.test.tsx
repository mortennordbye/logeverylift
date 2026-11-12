// @vitest-environment jsdom
import { BodySignals } from "@/components/features/garmin/BodySignals";
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
  const keys: BodyKey[] = ["sleep", "sleepScore", "hrv", "restingHr", "respiration", "bodyBattery", "vo2max", "fitnessAge", "weight"];
  const values: Record<BodyKey, number> = { sleep: 8.3, sleepScore: 81, hrv: 75, restingHr: 48, respiration: 15, bodyBattery: 91, vo2max: 51, fitnessAge: 18, weight: 89.7 };
  return {
    body: Object.fromEntries(keys.map((k) => [k, signal(values[k])])) as OverviewData["body"],
    vo2Sport: "run",
    rating: { sex: "male", age: 23, hrvBaseline: { lowUpper: 76, balancedLow: 82, balancedUpper: 109, weeklyAvg: 89 }, bodyFat: 20.4, bmi: 25.9, chronologicalAge: 23, ...over },
  } as OverviewData;
}

describe("BodySignals", () => {
  it("rates each tile and opens a sheet with the scale and the next band", () => {
    render(<BodySignals data={data()} />);
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
    render(<BodySignals data={data({ sex: null })} />);
    const vo2 = screen.getByRole("button", { name: /VO2 max/ });
    expect(within(vo2).getByText("Tap to compare")).toBeTruthy();
    fireEvent.click(vo2);
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /Add your gender in Account/ }).getAttribute("href")).toBe("/more/account");
  });
});
