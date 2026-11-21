// @vitest-environment jsdom
import { RunResults } from "@/components/features/run/RunResults";
import { RunSummary } from "@/components/features/run/RunSummary";
import type { StepLog } from "@/lib/utils/ride-results";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { runResultRows, runSummary } from "@/lib/utils/run-results";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The run results table and the summary (docs/plans/run-logger.md, section 5, step 4). */

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: () => <span>Workout</span> }));
const startRide = vi.fn();
vi.mock("@/lib/actions/rides", () => ({ startRide: (d: unknown) => startRide(d), setRideEndReason: vi.fn() }));
vi.mock("@/components/features/bike/useRide", () => ({ armRide: vi.fn(), disarmRide: vi.fn() }));
const pickRideGarminActivity = vi.fn();
const undoRideGarminFill = vi.fn();
vi.mock("@/lib/actions/ride-garmin", () => ({ pickRideGarminActivity: (d: unknown) => pickRideGarminActivity(d), undoRideGarminFill: (d: unknown) => undoRideGarminFill(d) }));
const logWithRetry = vi.fn();
vi.mock("@/lib/actions/run-test", () => ({ saveRunThreshold: vi.fn() }));
vi.mock("@/contexts/pending-queue-context", () => ({ useWorkoutSetWriter: () => ({ logWithRetry, unlogWithRetry: vi.fn() }) }));

const parsed = parseWorkout({
  v: 2,
  sport: "run",
  name: "Run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, belt: 7.5 },
    { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const plan = (mode: "indoor" | "outdoor") => buildRunPlan(parsed.workout, [1, 2], { run_threshold_pace: 1000 / 339, lthr_run: 180 }, mode);

const log = (seconds: number, kmh: number | null): StepLog => ({
  status: "done",
  durationSeconds: seconds,
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower: null,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  avgSpeed: kmh === null ? null : kmh / 3.6,
  distanceMeters: kmh === null ? null : Math.round((kmh / 3.6) * seconds),
  climbM: null,
  rpe: null,
  sources: kmh === null ? { durationSeconds: "clock" } : { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" },
});

beforeEach(() => {
  logWithRetry.mockReset();
  replace.mockReset();
  startRide.mockReset();
});

describe("RunResults", () => {
  function table(mode: "indoor" | "outdoor", logs: Record<number, StepLog>) {
    const { steps, rows } = runResultRows(plan(mode), logs);
    render(<RunResults programId={1} exerciseId={7} steps={steps} rows={rows} mode={mode} setNumbers={{ 1: 1, 2: 2 }} sessionId={9} garminWaiting laterHref="/" />);
  }

  it("More numbers keeps to the left when it wraps on a narrow phone", () => {
    table("outdoor", { 1: log(600, null) });
    expect(screen.getByTestId("more-numbers").className).toContain("text-left");
  });

  it("on a treadmill the belt stepper moves 0.1 km/h; Done saves the belt as typed speed and distance, with the effort on each step, then opens the summary", async () => {
    table("indoor", { 1: log(600, 7.5), 2: log(1200, 8.2) });
    expect(screen.getByTestId("garmin-waiting").textContent).toBe("Waiting for your Garmin run. It fills the numbers.");
    expect(screen.getByTestId("result-belt-2").textContent).toBe("8.2km/h");
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.1 km/h step 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.1 km/h step 2" }));
    expect(screen.getByTestId("result-belt-2").textContent).toBe("8.4km/h");
    fireEvent.change(screen.getByTestId("result-avgHr-2"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    fireEvent.click(screen.getByTestId("results-done"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2"));
    expect(logWithRetry).toHaveBeenCalledTimes(2);
    expect(logWithRetry.mock.calls[0][0]).toMatchObject({ programSetId: 1, rpe: 6 });
    expect(logWithRetry.mock.calls[1][0]).toMatchObject({ programSetId: 2, avgHr: 150, distanceMeters: 2800, rpe: 6, sources: { avgHr: "typed", avgSpeed: "typed", distanceMeters: "typed" } });
    expect(logWithRetry.mock.calls[1][0].avgSpeed).toBeCloseTo(8.4 / 3.6, 5);
  });

  it("a belt stepped back to the saved one sends nothing", async () => {
    table("indoor", { 1: log(600, 7.5), 2: log(1200, 8.2) });
    fireEvent.click(screen.getByRole("button", { name: "Belt up 0.1 km/h step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Belt down 0.1 km/h step 1" }));
    fireEvent.click(screen.getByTestId("results-done"));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(logWithRetry).not.toHaveBeenCalled();
  });

  it("outdoors asks for one optional total distance and spreads it over the steps", async () => {
    table("outdoor", { 1: log(600, null), 2: log(1200, null) });
    expect(screen.queryByRole("button", { name: /Belt up/ })).toBeNull();
    fireEvent.change(screen.getByTestId("result-total-km"), { target: { value: "4,5" } });
    fireEvent.click(screen.getByTestId("results-done"));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(logWithRetry.mock.calls.map((c) => c[0].distanceMeters)).toEqual([1500, 3000]);
  });
});

describe("RunSummary", () => {
  it("an ended-early run says so, asks why, and Run again starts a new treadmill run with its count", async () => {
    startRide.mockResolvedValue({ success: true, data: {} });
    const p = plan("indoor");
    render(
      <RunSummary
        programId={1}
        exerciseName="Run"
        doneLine="Ended early 18:00 · Treadmill"
        summary={runSummary(p, { 1: log(600, 7.5) }, { beltEvents: false })}
        rideId={5}
        early={{ kept: "Step 1 is saved", endReason: null }}
        doneHref="/"
        saveTheRun={false}
        runAgain={{ sessionId: 9, programExerciseId: 2, mode: "indoor", surface: null }}
      />,
    );
    expect(screen.getByText("Run ended early")).toBeTruthy();
    expect(screen.getByTestId("run-end-reason")).toBeTruthy();
    expect(screen.getByTestId("summary-distance-source").textContent).toBe("Distance from the plan · no belt changes");
    expect(screen.getByTestId("tile-Pace").textContent).toBe("Pace8:00/km");
    fireEvent.click(screen.getByTestId("summary-run-again"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/programs/1/workout/exercises/2?ride=1"));
    expect(startRide).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 9, programExerciseId: 2, mode: "indoor", countIn: true, again: true }));
  });

  it("a finished run has no reason chips and no Run again; Save the run opens run mode while the workout waits", () => {
    render(
      <RunSummary programId={1} exerciseName="Run" doneLine="Done 18:00 · Treadmill" summary={runSummary(plan("indoor"), { 1: log(600, 7.5), 2: log(1200, 8.2) }, { beltEvents: true })} rideId={5} early={null} doneHref="/" saveTheRun />,
    );
    expect(screen.getByText("Run done")).toBeTruthy();
    expect(screen.queryByTestId("run-end-reason")).toBeNull();
    expect(screen.queryByTestId("summary-run-again")).toBeNull();
    expect(screen.getByTestId("summary-done").getAttribute("href")).toBe("/programs/1/workout/exercises/2?ride=1");
  });
});

describe("RunSummary with Garmin (step 7)", () => {
  const stream = {
    numbers: { seconds: 1800, gapSPerKm: null, intensityFactor: null, load: null, hrZoneMinutes: [10, 20, 0, 0, 0], drift: { pct: 3.2, steady: true, efFirst: 0.016, efSecond: 0.0155 }, onTarget: { 2: 92 }, timeOnTarget: 92 },
    chart: { bands: [], power: "24,50 246,50", hr: "24,60 246,58", hrLabel: null, ftpY: null, yTicks: [], xTicks: [{ x: 246, label: "30 min" }] },
  };
  const garminLog = (seconds: number, kmh: number, hr: number): StepLog => ({ ...log(seconds, kmh), avgHr: hr, sources: { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt", avgHr: "garmin" } });

  it("shows drift as a tile, the chart with the belt line, time on target per step, and Undo", () => {
    render(
      <RunSummary
        programId={1}
        exerciseName="Run"
        doneLine="Done 18:00 · Treadmill · from Garmin"
        summary={runSummary(plan("indoor"), { 1: garminLog(600, 7.5, 125), 2: garminLog(1200, 8.2, 150) }, { beltEvents: true, stream })}
        rideId={5}
        early={null}
        doneHref="/"
        saveTheRun={false}
        garmin={{ state: "filled", candidates: [] }}
      />,
    );
    expect(screen.getByTestId("tile-Drift").textContent).toBe("Drift3%steady");
    expect(screen.getByTestId("summary-chart").textContent).toContain("Belt");
    expect(screen.getAllByTestId("row-on-target").map((r) => r.textContent)).toEqual(["92% on target"]);
    expect(screen.getByTestId("summary-garmin").textContent).toContain("Steps filled from Garmin");
  });

  it("two Garmin runs match: Pick lists start, time and distance, and sends the part of a multisport file", async () => {
    pickRideGarminActivity.mockResolvedValue({ success: true, data: null });
    render(
      <RunSummary
        programId={1}
        exerciseName="Run"
        doneLine="Done 18:00 · Outdoor"
        summary={runSummary(plan("outdoor"), { 1: log(600, null), 2: log(1200, null) }, { beltEvents: false })}
        rideId={5}
        early={null}
        doneHref="/"
        saveTheRun={false}
        timeZone="UTC"
        garmin={{
          state: "pick",
          candidates: [
            { garminActivityId: 11, segment: 0, startMs: Date.parse("2026-11-18T16:00:00Z"), seconds: 1800, meters: 5200 },
            { garminActivityId: 12, segment: 2, startMs: Date.parse("2026-11-18T16:01:00Z"), seconds: 1740, meters: 5100 },
          ],
        }}
      />,
    );
    const box = screen.getByTestId("summary-garmin-pick");
    expect(box.textContent).toContain("Two Garmin runs match");
    fireEvent.click(within(box).getByRole("button", { name: "Pick" }));
    fireEvent.click(within(box).getByRole("button", { name: "16:01 · 29 min · 5.1 km" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(pickRideGarminActivity).toHaveBeenCalledWith({ rideId: 5, garminActivityId: 12, segment: 2 });
  });
});

describe("step 7 review: a rep's round at 320 px", () => {
  it("shows the round on its own line under the step name, so a narrow row never cuts it", () => {
    const reps = parseWorkout({
      v: 2,
      sport: "run",
      name: "Reps",
      steps: [{ type: "repeat", count: 2, steps: [{ type: "work", end: { type: "time", seconds: 300 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] }],
    });
    if (!reps.ok) throw new Error("bad");
    const p = buildRunPlan(reps.workout, [1, 2, 3, 4], { run_threshold_pace: 1000 / 339, lthr_run: 180 }, "outdoor");
    render(<RunSummary programId={1} exerciseName="Run" doneLine="Done" summary={runSummary(p, { 1: log(300, null) }, { beltEvents: false })} rideId={5} early={null} doneHref="/" saveTheRun={false} />);
    const row = screen.getAllByTestId("summary-row")[0];
    expect(within(row).getByTestId("row-name").textContent).toBe("Work");
    expect(within(row).getByTestId("row-round").textContent).toBe("1 of 2");
  });
});
