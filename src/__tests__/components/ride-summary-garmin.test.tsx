// @vitest-environment jsdom
import { RideSummary } from "@/components/features/bike/RideSummary";
import { rideSummary, type StepLog } from "@/lib/utils/ride-results";
import { rideDoneChart, rideStreamNumbers, splitRide, type RideStreams } from "@/lib/utils/ride-stream";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The ride summary with a Garmin stream (docs/plans/bike-ride-logger.md, section 5 "Summary", 4.6 and 4.8, step 7). */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
const undoRideGarminFill = vi.fn();
const pickRideGarminActivity = vi.fn();
vi.mock("@/lib/actions/ride-garmin", () => ({
  undoRideGarminFill: (d: unknown) => undoRideGarminFill(d),
  pickRideGarminActivity: (d: unknown) => pickRideGarminActivity(d),
}));
vi.mock("@/lib/actions/ride-ftp", () => ({ saveRideFtp: vi.fn() }));

const parsed = parseWorkout({
  v: 2,
  sport: "bike",
  name: "Bike",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 1200 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
    { type: "work", end: { type: "time", seconds: 2400 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
    { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const plan = buildRidePlan(parsed.workout, [1, 2, 3], { ftp: 180, lthr_bike: 171 }, "indoor");
const SECONDS = [1200, 2400, 300];
const WATTS = [124, 141, 90];

/** A synthetic 65 min Garmin ride: heart rate rises through the work step. */
function synthetic(): RideStreams {
  const t: number[] = [];
  for (let s = 0; s < 3900; s++) t.push(s);
  const stepOf = (s: number) => (s < 1200 ? 0 : s < 3600 ? 1 : 2);
  return { t, power: t.map((s) => WATTS[stepOf(s)] + ((s * 37) % 21) - 10), hr: t.map((s) => (s < 1200 ? 125 : 140 + Math.floor((s - 1200) / 120))) };
}

const log = (i: number, over: Partial<StepLog> = {}): StepLog => ({
  status: "done",
  durationSeconds: SECONDS[i],
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower: WATTS[i],
  avgHr: 140,
  maxHr: 150,
  avgCadence: 90,
  avgSpeed: null,
  distanceMeters: null,
  climbM: null,
  rpe: null,
  sources: { durationSeconds: "clock", avgPower: "garmin", avgHr: "garmin" },
  ...over,
});

function withStream() {
  const streams = synthetic();
  const split = splitRide(SECONDS.map((s, i) => ({ programSetId: i + 1, activeSeconds: s })), [], [], 0);
  const numbers = rideStreamNumbers(streams, plan.steps, split.windows, { ftp: 180, lthr: 171, mode: "indoor" });
  return rideSummary(plan, { 1: log(0), 2: log(1), 3: log(2) }, undefined, { numbers, chart: rideDoneChart(streams, plan.steps, split, 180) });
}

beforeEach(() => {
  vi.clearAllMocks();
  undoRideGarminFill.mockResolvedValue({ success: true, data: null });
  pickRideGarminActivity.mockResolvedValue({ success: true, data: null });
});

describe("RideSummary with a Garmin stream", () => {
  it("NP and IF tiles, the load without est., the plan-against-done chart, zones, drift and time on target", () => {
    const s = withStream();
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Done 17:12 · Indoor trainer · from Garmin" summary={s} doneHref="/" saveTheRide={false} rideId={4} garmin={{ state: "filled", candidates: [] }} />);
    const tiles = screen.getByTestId("summary-tiles");
    expect(within(tiles).getByTestId("tile-NP").textContent).toBe(`NP${Math.round(s.numbers.np!)}`);
    expect(within(tiles).getByTestId("tile-IF").textContent).toBe(`IF${s.numbers.intensityFactor!.toFixed(2)}`);
    expect(within(tiles).getByTestId("tile-Load").textContent).not.toContain("est.");
    const chart = screen.getByTestId("summary-chart");
    expect(chart.querySelector("[data-testid=chart-power]")).toBeTruthy();
    expect(chart.querySelector("[data-testid=chart-hr]")).toBeTruthy();
    expect(chart.textContent).toContain("Power");
    expect(chart.textContent).toContain("Heart rate");
    expect(chart.textContent).toContain("Target");
    expect(screen.getByTestId("summary-zones")).toBeTruthy();
    // Heart rate rises 20 bpm over the work step at the same watts: not steady.
    expect(screen.getByTestId("summary-drift").textContent).toMatch(/^Heart rate drift \d+\.\d%$/);
    expect(screen.getAllByTestId("row-on-target")).toHaveLength(3);
    expect(screen.getByTestId("summary-line").textContent).toContain("from Garmin");
  });

  it("Steps filled from Garmin · Undo calls the undo and refreshes", async () => {
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Done" summary={withStream()} doneHref="/" saveTheRide={false} rideId={4} garmin={{ state: "filled", candidates: [] }} />);
    const row = screen.getByTestId("summary-garmin");
    expect(row.textContent).toContain("Steps filled from Garmin");
    fireEvent.click(within(row).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(undoRideGarminFill).toHaveBeenCalledWith({ rideId: 4 });
  });

  it("Two Garmin rides match · Pick lists them and fills from the one tapped", async () => {
    const candidates = [
      { garminActivityId: 11, startMs: Date.parse("2026-11-17T16:02:00Z"), seconds: 3900 },
      { garminActivityId: 12, startMs: Date.parse("2026-11-17T16:30:00Z"), seconds: 1800 },
    ];
    render(
      <RideSummary
        programId={1}
        exerciseName="Bike"
        doneLine="Done"
        summary={rideSummary(plan, { 1: log(0, { avgPower: null, sources: null }) })}
        doneHref="/"
        saveTheRide={false}
        rideId={4}
        garmin={{ state: "pick", candidates }}
        timeZone="UTC"
      />,
    );
    const row = screen.getByTestId("summary-garmin-pick");
    expect(row.textContent).toContain("Two Garmin rides match");
    expect(screen.queryByTestId("summary-chart")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Pick" }));
    fireEvent.click(within(row).getByRole("button", { name: "16:30 · 30 min" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(pickRideGarminActivity).toHaveBeenCalledWith({ rideId: 4, garminActivityId: 12 });
  });

  it("an error stays on screen and nothing refreshes", async () => {
    undoRideGarminFill.mockResolvedValue({ success: false, error: "Failed to undo" });
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Done" summary={withStream()} doneHref="/" saveTheRide={false} rideId={4} garmin={{ state: "filled", candidates: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Failed to undo");
    expect(refresh).not.toHaveBeenCalled();
  });
});
