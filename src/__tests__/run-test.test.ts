import { buildRunPlan } from "@/lib/utils/run-plan";
import { runStepRows } from "@/lib/utils/run-view";
import { runScreen } from "@/lib/utils/run-screen";
import { rideTimeline, type RideEventInput, type RidePlan } from "@/lib/utils/ride-timeline";
import { workoutToRows } from "@/lib/utils/program-steps";
import {
  runTestCheckText,
  runTestResult,
  runTestSteps,
  runTestThresholds,
  runTestView,
  runTestWorkout,
  sickBlocksTest,
  type RunTestInput,
  type RunTestLog,
  type RunTestTiming,
} from "@/lib/utils/run-test";
import { minSec, valueFromTest } from "@/lib/utils/thresholds";
import { estimateWorkout, parseWorkout, type ThresholdValues, type WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The run threshold test (docs/plans/run-logger.md, 4.10, step 8; section 7 unit 12). */

const TH: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 170, max_hr: 190 };
const T0 = Date.UTC(2026, 10, 18, 17, 0, 0);
const at = (s: number) => T0 + s * 1000;
let seq = 0;
const ev = (kind: RideEventInput["kind"], s: number, extra: Partial<RideEventInput> = {}): RideEventInput => ({ seq: ++seq, kind, at: at(s), ...extra });

function plan(mode: "treadmill" | "outdoor", th: ThresholdValues = TH): RidePlan {
  const parsed = parseWorkout(runTestWorkout(mode));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const ids = workoutToRows(parsed.workout).map((_, i) => i + 1);
  return buildRunPlan(parsed.workout, ids, th, mode === "treadmill" ? "indoor" : "outdoor");
}

describe("runTestWorkout", () => {
  it("warm-up 15 min with 3 x 1 min pickups, then 10 and 20 min with the same target, then 10 min easy", () => {
    for (const mode of ["treadmill", "outdoor"] as const) {
      const w = runTestWorkout(mode);
      const parsed = parseWorkout(w);
      expect(parsed.ok).toBe(true);
      expect(w.test).toBe("30min");
      const p = plan(mode);
      expect(p.test).toBe("30min");
      expect(p.steps.map((s) => s.seconds)).toEqual([540, 60, 60, 60, 60, 60, 60, 600, 1200, 600]);
      expect(p.steps.slice(0, 7).reduce((a, s) => a + s.seconds!, 0)).toBe(15 * 60);
      const [ten, twenty] = [p.steps[7].step, p.steps[8].step];
      expect(ten.target).toEqual(twenty.target);
      expect(twenty.note).toBe("Run as hard as you can hold for 30 min");
      expect(estimateWorkout(parsed.ok ? parsed.workout : w, {}).durationSeconds).toBe(55 * 60);
    }
  });

  it("treadmill: the test starts at 10.0 km/h with the line to raise it", () => {
    const ten = runTestWorkout("treadmill").steps[2] as WorkoutStep;
    expect(ten.belt).toBe(10);
    expect(ten.note).toBe("Run as hard as you can hold for 30 min. Start at 10.0 km/h, raise it if you can");
    expect((runTestWorkout("outdoor").steps[2] as WorkoutStep).belt).toBeUndefined();
  });

  it("the test steps are the 20 min step and the 10 min step before it", () => {
    expect(runTestSteps(plan("outdoor").steps)).toEqual({ first: 7, last: 8 });
  });

  it("outdoors the test runs on effort, not a heart rate cap", () => {
    const rows = runStepRows(plan("outdoor"));
    expect(rows.filter((r) => r.title === "Work").map((r) => r.detail)).toEqual(["Effort 9-10", "Effort 9-10"]);
  });
});

describe("the 20 min step of a treadmill test keeps the belt", () => {
  const p = plan("treadmill");

  it("is frozen with no belt of its own and says Keep the belt", () => {
    expect(p.steps[7].run).toMatchObject({ belt: 100, beltFrom: "step" });
    expect(p.steps[8].run).toMatchObject({ belt: null, carry: true });
    expect(runStepRows(p).find((r) => r.n === 9)?.detail).toBe("Keep the belt");
  });

  it("starts at the belt the 10 min step ended on, and its meters come from it", () => {
    // Up to 11.5 km/h 1 min into the test (15 min warm-up first).
    const events = [ev("start", 0), ev("belt", 960, { value: 115, stepKey: p.steps[7].key })];
    const t = rideTimeline(p, events, at(15 * 60 + 600 + 300));
    expect(t.current?.index).toBe(8);
    expect(t.current?.beltKmh).toBe(11.5);
    const ten = t.steps.find((s) => s.index === 7)!;
    // 60 s at 10.0 and 540 s at 11.5 km/h.
    expect(ten.distanceM).toBe(Math.round((60 * 10 + 540 * 11.5) / 3.6));
    const screen = runScreen(p, t);
    expect(screen?.treadmill).toMatchObject({ belt: 11.5, planBelt: null });
    const done = rideTimeline(p, events, at(15 * 60 + 1800 + 1));
    expect(done.steps.find((s) => s.index === 8)!.distanceM).toBe(Math.round((1200 * 11.5) / 3.6));
  });

  it("the next card says Keep the belt, and no cue asks to slow down", () => {
    const t = rideTimeline(p, [ev("start", 0), ev("belt", 960, { value: 115, stepKey: p.steps[7].key })], at(15 * 60 + 595));
    const screen = runScreen(p, t)!;
    expect(screen.next.target).toBe("Keep the belt");
    expect(screen.cue).toBeNull();
  });

  it("an outdoor test has no carry", () => {
    expect(plan("outdoor").steps.every((s) => !s.run?.carry)).toBe(true);
  });
});

// ── Result (section 7 unit 12) ────────────────────────────────────────────

const ID = { first: 8, last: 9 };
const log = (over: Partial<RunTestLog> = {}): RunTestLog => ({ status: "done", durationSeconds: 600, distanceMeters: null, avgHr: null, rpe: null, ...over });
const timing = (programSetId: number, seconds: number, pause = 0): RunTestTiming => ({ programSetId, startedAt: 0, endedAt: (seconds + pause) * 1000, activeSeconds: seconds });

/** A treadmill test at 11.5 km/h for 30 min: 1917 m and 3833 m, 20 min HR 176, effort 9. */
function input(over: Partial<RunTestInput> = {}, logs: Partial<Record<"first" | "last", Partial<RunTestLog>>> = {}): RunTestInput {
  return {
    plan: plan("treadmill"),
    logs: {
      [ID.first]: log({ durationSeconds: 600, distanceMeters: 1917, avgHr: 168, ...logs.first }),
      [ID.last]: log({ durationSeconds: 1200, distanceMeters: 3833, avgHr: 176, rpe: 9, ...logs.last }),
    },
    timing: [timing(ID.first, 600), timing(ID.last, 1200)],
    beltEvents: true,
    current: { lthr: 172, speed: 1000 / 320 },
    ...over,
  };
}

describe("runTestResult", () => {
  it("done: LTHR from the 20 min heart rate, pace from the whole 30 min, every check passes", () => {
    const r = runTestResult(input())!;
    expect(r).toMatchObject({ lthr: 176, hr20: 176, meters30: 5750, valid: true, band: "save" });
    expect(1000 / r.speed!).toBeCloseTo(313.04, 1);
    expect(minSec(1000 / r.speed!)).toBe("5:13");
    expect(r.checks).toEqual({ noStops: true, evenPace: true, hrHigh: true, effort: true });
  });

  it("the saved rows agree with the run_30min field test", () => {
    const r = runTestResult(input())!;
    for (const row of runTestThresholds(r)) {
      const v = valueFromTest(row.kind, "run_30min", row.testData);
      expect("value" in v && Math.abs(v.value - row.value)).toBeLessThan(1e-9);
    }
    expect(runTestThresholds(r).map((x) => x.kind)).toEqual(["lthr_run", "run_threshold_pace"]);
  });

  it("ended early: the 20 min step not done gives nothing", () => {
    expect(runTestResult(input({}, { last: { status: "partial", durationSeconds: 700 } }))).toBeNull();
    expect(runTestResult(input({ logs: { [ID.first]: log({ distanceMeters: 1917, avgHr: 168 }) } }))).toBeNull();
  });

  it("paused 90 s in the 20 min step gives nothing; a 30 s pause gives a result that fails no stops", () => {
    expect(runTestResult(input({ timing: [timing(ID.first, 600), timing(ID.last, 1200, 90)] }))).toBeNull();
    const r = runTestResult(input({ timing: [timing(ID.first, 600, 30), timing(ID.last, 1200)] }))!;
    expect(r.checks.noStops).toBe(false);
    expect(r.valid).toBe(false);
    expect(runTestCheckText(r.checks)).toEqual(["You stopped during the test"]);
  });

  it("a treadmill with no belt events during the test gives LTHR only", () => {
    const r = runTestResult(input({ beltEvents: false }))!;
    expect(r).toMatchObject({ lthr: 176, speed: null, meters30: null });
    expect(r.checks.evenPace).toBeNull();
    expect(runTestThresholds(r).map((x) => x.kind)).toEqual(["lthr_run"]);
  });

  it("outdoors the pace counts with no belt; with no distance it gives LTHR only", () => {
    const out = { plan: plan("outdoor"), beltEvents: false };
    expect(runTestResult(input(out))?.speed).not.toBeNull();
    expect(runTestResult(input(out, { first: { distanceMeters: null } }))).toMatchObject({ lthr: 176, speed: null });
  });

  it("out of range: a heart rate over 210 or a pace slower than 10:00 /km is left out; both out gives nothing", () => {
    expect(runTestResult(input({}, { last: { avgHr: 215 } }))).toMatchObject({ lthr: null, hr20: null });
    expect(runTestResult(input({}, { first: { distanceMeters: 900 }, last: { distanceMeters: 1900 } }))).toMatchObject({ speed: null, lthr: 176 });
    expect(runTestResult(input({}, { first: { distanceMeters: 900 }, last: { distanceMeters: 1900, avgHr: 100 } }))).toBeNull();
  });

  it("checks: an uneven pace, a low heart rate and a low effort each fail", () => {
    // 10 min at 12.5 km/h, then 20 min at 11.0: the last 20 min are 12% slower.
    const r = runTestResult(input({}, { first: { distanceMeters: 2083 }, last: { distanceMeters: 3667, avgHr: 150, rpe: 7 } }))!;
    expect(r.checks).toEqual({ noStops: true, evenPace: false, hrHigh: false, effort: false });
    expect(r.valid).toBe(false);
    expect(runTestCheckText(r.checks)).toHaveLength(3);
    // No max HR and no effort: those checks are not run, and nothing fails.
    const plain = runTestResult(input({ plan: plan("treadmill", { ...TH, max_hr: undefined }) }, { last: { rpe: null } }))!;
    expect(plain.checks).toMatchObject({ hrHigh: null, effort: null });
    expect(plain.valid).toBe(true);
  });

  describe("each band of the comparison", () => {
    const band = (current: RunTestInput["current"]) => runTestResult(input({ current }))!.band;
    const pace = (s: number) => 1000 / s;
    it("within 5 bpm and 3%: save", () => {
      expect(band({ lthr: 171, speed: pace(313 * 1.03) })).toBe("save");
      expect(band({ lthr: null, speed: null })).toBe("save");
    });
    it("6 to 10 bpm or 3 to 8%: choose", () => {
      expect(band({ lthr: 170, speed: pace(313) })).toBe("choose");
      expect(band({ lthr: 186, speed: pace(313) })).toBe("choose");
      expect(band({ lthr: 176, speed: pace(313 * 1.05) })).toBe("choose");
    });
    it("further off: retest", () => {
      expect(band({ lthr: 164, speed: pace(313) })).toBe("retest");
      expect(band({ lthr: 176, speed: pace(313 * 1.1) })).toBe("retest");
      expect(band({ lthr: 170, speed: pace(313 * 0.9) })).toBe("retest");
    });
  });

  it("the view: null for a run that is no test", () => {
    const { test: _t, ...plain } = plan("treadmill");
    void _t;
    expect(runTestView(input({ plan: plain }))).toBeNull();
    expect(runTestView(input())).toMatchObject({ test: "30min", saved: false, result: { lthr: 176 } });
  });
});

describe("sickBlocksTest", () => {
  const today = "2026-11-18";
  it("an open sick period, or one that ended less than 7 days ago, stops the test", () => {
    expect(sickBlocksTest([{ startedOn: "2026-11-15", endedOn: null }], today)).toBe(true);
    expect(sickBlocksTest([{ startedOn: "2026-11-05", endedOn: "2026-11-12" }], today)).toBe(true);
    expect(sickBlocksTest([{ startedOn: "2026-11-05", endedOn: "2026-11-11" }], today)).toBe(false);
    expect(sickBlocksTest([], today)).toBe(false);
  });
});
