// @vitest-environment jsdom
import { RideSummary } from "@/components/features/bike/RideSummary";
import { RunSummary } from "@/components/features/run/RunSummary";
import { SessionCheckSteps } from "@/components/features/session-check/SessionCheckSteps";
import { rideSummary, type StepLog } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { runSummary } from "@/lib/utils/run-results";
import { checkSteps } from "@/lib/utils/session-check";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The step page cards and the marks on the ride and run summaries (docs/plans/session-check.md, decisions 2, 3 and 7). */

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/programs/1/workout/exercises/2" }));
vi.mock("@/components/ui/BackLink", () => ({ BackLink: ({ fallback }: { fallback: { label: string } }) => <span>{fallback.label}</span> }));
vi.mock("@/lib/actions/rides", () => ({ startRide: vi.fn(), setRideEndReason: vi.fn() }));
vi.mock("@/components/features/bike/useRide", () => ({ armRide: vi.fn(), disarmRide: vi.fn() }));
vi.mock("@/lib/actions/ride-garmin", () => ({ pickRideGarminActivity: vi.fn(), undoRideGarminFill: vi.fn() }));
vi.mock("@/lib/actions/ride-ftp", () => ({ saveRideFtp: vi.fn() }));
vi.mock("@/lib/actions/run-test", () => ({ saveRunThreshold: vi.fn() }));

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const log = (over: Partial<StepLog> = {}): StepLog => ({
  status: "done",
  durationSeconds: 900,
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower: null,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  avgSpeed: null,
  distanceMeters: null,
  climbM: null,
  rpe: null,
  sources: null,
  ...over,
});

const TEMPO = tree({
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 } },
    {
      type: "work",
      end: { type: "time", seconds: 900 },
      target: { metric: "power", anchor: "absolute", low: 140, high: 149 },
      target2: { metric: "hr", anchor: "absolute", low: 135, high: 148 },
      cadence: { low: 85, high: 95 },
    },
  ],
});
const bike = buildRidePlan(TEMPO, [1, 2], { ftp: 200 }, "indoor");

describe("the step page", () => {
  it("one card per step: time against the plan, each target with its mark; only over and under in the accent colour", () => {
    const steps = checkSteps(bike, { 1: log({ durationSeconds: 600 }), 2: log({ avgPower: 155, avgHr: 141, avgCadence: 90 }) });
    render(
      <SessionCheckSteps
        view={{ title: "Bike tempo · Tue 24 Nov", parts: [{ key: "ride-1", sport: "bike", name: "Bike tempo", match: { kind: "garmin", name: "Indoor Cycling", split: "laps", watchOnly: false }, steps }] }}
        back={{ href: "/history/1", label: "Workout" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Bike tempo · Tue 24 Nov" })).toBeTruthy();
    expect(screen.getByTestId("check-match").textContent).toBe("Matched to Garmin · Indoor Cycling · steps split by Garmin laps");
    const cards = screen.getAllByTestId("check-step");
    expect(cards).toHaveLength(2);
    // The warm-up shows its time only.
    expect(cards[0].textContent).toContain("1 · Warm-up");
    expect(within(cards[0]).queryAllByTestId("check-row")).toHaveLength(0);
    const rows = within(cards[1]).getAllByTestId("check-row");
    expect(rows.map((r) => r.textContent)).toEqual(["Power155 W · 140-149↑ over", "Heart rate141 · 135-148✓ in", "Cadence90 rpm · 85-95✓ in"]);
    const marks = within(cards[1]).getAllByTestId("check-mark");
    const over = marks.find((m) => m.dataset.mark === "over")!;
    expect(over.className).toContain("bg-primary");
    for (const m of marks.filter((x) => x.dataset.mark === "in")) expect(m.className).not.toContain("bg-primary");
    expect(cards[1].textContent).toContain("15:00 · plan 15:00");
  });

  it("with nothing to show says so; a session logged in the app alone says so too", () => {
    const { unmount } = render(<SessionCheckSteps view={{ title: "Run · Wed 25 Nov", parts: [] }} back={{ href: "/planned/1", label: "Session" }} />);
    expect(screen.getByTestId("check-empty").textContent).toBe("No steps to show yet. They show once the session is done.");
    unmount();
    render(<SessionCheckSteps view={{ title: "Ride", parts: [{ key: "r", sport: "bike", name: "Ride", match: { kind: "app" }, steps: checkSteps(bike, {}) }] }} back={{ href: "/", label: "Home" }} />);
    expect(screen.getByTestId("check-match").textContent).toBe("Logged in the app");
  });

  it("a watch-only session names how it was split", () => {
    render(
      <SessionCheckSteps
        view={{ title: "Run", parts: [{ key: "g", sport: "run", name: "Run", match: { kind: "garmin", name: "Oslo Running", split: "time", watchOnly: true }, steps: [] }] }}
        back={{ href: "/planned/1", label: "Session" }}
      />,
    );
    expect(screen.getByTestId("check-match").textContent).toBe("Matched to Garmin · Oslo Running · steps split by the planned times");
  });

  it("without Garmin access a watch-only session names no activity", () => {
    render(<SessionCheckSteps view={{ title: "Run", parts: [{ key: "w", sport: "run", name: "Run", match: { kind: "watch" }, steps: [] }] }} back={{ href: "/planned/1", label: "Session" }} />);
    expect(screen.getByTestId("check-match").textContent).toBe("Done on the watch");
  });
});

describe("the summaries use the same rule (decision 3)", () => {
  it("the ride summary marks over as well as under, and lists the other targets that are out", () => {
    const s = rideSummary(bike, { 1: log({ durationSeconds: 600 }), 2: log({ avgPower: 155, avgHr: 160, avgCadence: 80 }) });
    render(<RideSummary programId={1} exerciseName="Bike" doneLine="Done" summary={s} doneHref="/" saveTheRide={false} />);
    const row = screen.getAllByTestId("summary-row")[1];
    expect(within(row).getByLabelText("over target").textContent).toBe("↑");
    expect(within(row).getByTestId("row-extra").textContent).toBe("HR 160 ↑ · Cadence 80 ↓");
  });

  it("the run summary puts the heart rate's arrow after the heart rate on a treadmill", () => {
    const steady = tree({ v: 2, sport: "run", name: "Steady", steps: [{ type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] });
    const p = buildRunPlan(steady, [1], { run_threshold_pace: 1000 / 339, lthr_run: 180 }, "indoor");
    const s = runSummary(p, { 1: log({ durationSeconds: 3000, avgSpeed: 8.5 / 3.6, avgHr: 170 }) }, { beltEvents: true });
    render(<RunSummary programId={1} exerciseName="Run" doneLine="Done" summary={s} rideId={5} early={null} doneHref="/" saveTheRun={false} />);
    const row = screen.getAllByTestId("summary-row")[0];
    expect(row.textContent).toContain("8.5 · HR 170↑");
    expect(within(row).getByLabelText("over target")).toBeTruthy();
  });
});
