import { describe, expect, it } from "vitest";
import { buildWorkout, workoutToRows, type StepRow } from "@/lib/utils/program-steps";
import { AUTO_END_AFTER_MS, rideTimeline, type RideEventInput, type RidePlan, type RunStepPlan, type TimelineStep } from "@/lib/utils/ride-timeline";
import { buildRunPlan, resolveBelt } from "@/lib/utils/run-plan";
import { RUN_PACE_ZONES, parseWorkout, runZoneSpeed, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";

/** The run rules of docs/plans/run-logger.md, 4.2 to 4.5, and its section 7 unit tests 2 to 11. */

const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const at = (s: number) => T0 + s * 1000;
/** The owner: threshold pace 5:39 /km, run LTHR 180. */
const OWNER: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

let seq = 0;
const ev = (kind: RideEventInput["kind"], s: number, value?: number, stepKey?: string): RideEventInput => ({
  seq: ++seq,
  kind,
  at: at(s),
  ...(value !== undefined && { value }),
  ...(stepKey !== undefined && { stepKey }),
});
const start = () => ev("start", 0);

const runStep = (i: number, seconds: number | null, run: Partial<RunStepPlan> & Pick<RunStepPlan, "rule">, estSeconds?: number): TimelineStep => ({
  key: `s${i}`,
  programSetId: 100 + i,
  seconds,
  power: null,
  ...(estSeconds !== undefined && { estSeconds }),
  run: { meters: null, belt: null, beltFrom: null, incline: null, block: null, ...run },
});
const runPlan = (steps: TimelineStep[]) => ({ sport: "run" as const, steps });

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}
const ids = (w: Workout) => Array.from({ length: w.steps.reduce((a, n) => a + (n.type === "repeat" ? n.count * n.steps.length : 1), 0) }, (_, i) => 1000 + i);

describe("run step fields", () => {
  it("a run step takes incline and belt with one decimal; a bike step takes neither", () => {
    const run = parseWorkout({ v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 }, incline: 1.5, belt: 8.5 }] });
    expect(run.ok).toBe(true);
    const bad = parseWorkout({ v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 }, incline: 1.25, belt: 40 }] });
    expect(!bad.ok && bad.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["steps[0].incline", "steps[0].belt"]));
    const bike = parseWorkout({ v: 2, sport: "bike", name: "Ride", steps: [{ type: "work", end: { type: "time", seconds: 600 }, incline: 1, belt: 8 }] });
    expect(!bike.ok && bike.errors.map((e) => `${e.path} ${e.message}`)).toEqual(
      expect.arrayContaining(["steps[0].incline incline is only for run steps", "steps[0].belt belt is only for run steps"]),
    );
  });

  it("the rows keep a run step's incline and belt, and a bike row's incline stays off its step", () => {
    const w = tree({ v: 2, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "time", seconds: 600 }, incline: 1.5, belt: 8.5 }] });
    const rows = workoutToRows(w);
    expect(rows[0]).toMatchObject({ inclinePercent: 1.5, beltKmh: 8.5 });
    const back = buildWorkout(rows as StepRow[], { sport: "run", name: "Run" });
    expect("workout" in back && back.workout.steps[0]).toMatchObject({ incline: 1.5, belt: 8.5 });
    const bike = buildWorkout([{ ...rows[0], inclinePercent: 2, beltKmh: 9 }] as StepRow[], { sport: "bike", name: "Ride" });
    expect("workout" in bike && bike.workout.steps[0]).not.toHaveProperty("incline");
  });
});

describe("run pace zones and the frozen belt (4.2)", () => {
  it("Z2 is 6:26 to 7:17 at a 5:39 threshold, and its slow end is 8.2 km/h", () => {
    const t = 339;
    const [fast, slow] = RUN_PACE_ZONES["2"];
    expect(Math.round((t * fast) / 100)).toBe(386); // 6:26
    expect(Math.round((t * slow) / 100)).toBe(437); // 7:17
    expect(Math.round(runZoneSpeed("2", OWNER.run_threshold_pace!) * 36) / 10).toBe(8.2);
  });

  it("takes the step's belt, else the pace target's midpoint to 0.5 km/h", () => {
    expect(resolveBelt({ belt: 7.5, target: { metric: "pace", anchor: "threshold_pace", low: 85, high: 90 } }, OWNER)).toEqual({ kmh: 7.5, from: "step" });
    // 87.5% of 10.62 km/h is 9.29, to 9.5.
    expect(resolveBelt({ target: { metric: "pace", anchor: "threshold_pace", low: 85, high: 90 } }, OWNER)).toEqual({ kmh: 9.5, from: "pace" });
  });

  it("a heart rate step uses the median of 2 or more done steps of 10 min in its zone, else the zone's slow end", () => {
    const z2 = { target: { metric: "hr", anchor: "lthr", zone: 2 } } as const;
    const history = [
      { beltKmh: 8, avgHr: 155, seconds: 600 },
      { beltKmh: 8.5, avgHr: 157, seconds: 900 },
      { beltKmh: 10, avgHr: 157, seconds: 300 },
      { beltKmh: 11, avgHr: 172, seconds: 1200 },
    ];
    expect(resolveBelt(z2, OWNER, history)).toEqual({ kmh: 8.3, from: "history" });
    expect(resolveBelt(z2, OWNER, history.slice(1))).toEqual({ kmh: 8.2, from: "zone" });
  });

  it("an effort step uses the pace its effort stands for; a walk is 5.5 km/h", () => {
    const rpe = (low: number, high: number) => ({ target: { metric: "rpe", anchor: "absolute", low, high } }) as const;
    expect(resolveBelt(rpe(1, 2), {})).toEqual({ kmh: 5.5, from: "effort" });
    expect(resolveBelt(rpe(3, 4), OWNER)).toEqual({ kmh: 7.6, from: "effort" });
    expect(resolveBelt(rpe(5, 6), OWNER)).toEqual({ kmh: 8.2, from: "effort" });
    expect(resolveBelt(rpe(9, 10), OWNER)).toEqual({ kmh: 11.1, from: "effort" });
  });

  // Unit test 7.
  it("a heart rate step with no history uses the zone pace; with no threshold pace the belt is null", () => {
    const w = tree({ v: 2, sport: "run", name: "Base", steps: [{ type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] });
    expect(buildRunPlan(w, ids(w), OWNER, "indoor").steps[0].run).toMatchObject({ belt: 82, beltFrom: "zone" });
    expect(buildRunPlan(w, ids(w), { lthr_run: 180 }, "indoor").steps[0].run).toMatchObject({ belt: null, beltFrom: null });
    expect(buildRunPlan(w, ids(w), OWNER, "outdoor").steps[0].run).toMatchObject({ belt: null });
  });
});

describe("run timeline", () => {
  it("an end before the start (End at the last step during the 5 s count) ends the run early with no steps", () => {
    const plan = runPlan([runStep(1, 60, { rule: "time" }), runStep(2, 60, { rule: "time" })]);
    const t = rideTimeline(plan, [ev("start", 5), ev("end", 2)], at(30));
    expect(t).toMatchObject({ status: "ended_early", steps: [], current: null, activeSeconds: 0 });
    expect(t.endedAt).toBe(at(2));
  });

  // Unit test 2.
  it("a belt distance step ends at the distance built from 2 belt changes", () => {
    const plan = runPlan([runStep(1, null, { rule: "belt_distance", meters: 1000, belt: 80 }), runStep(2, 300, { rule: "time", belt: 70 })]);
    // 60 s at 8 km/h is 133 m, 60 s at 10 km/h 167 m, the last 700 m at 12 km/h take 210 s.
    const events = [start(), ev("belt", 60, 100), ev("belt", 120, 120)];
    const mid = rideTimeline(plan, events, at(150));
    expect(mid.current).toMatchObject({ index: 0, beltKmh: 12, distanceM: 400, remainingMeters: 600, remainingSeconds: 180 });
    const t = rideTimeline(plan, events, at(400));
    expect(t.steps[0]).toMatchObject({ status: "done", activeSeconds: 330, endedAt: at(330), distanceM: 1000 });
    expect(t.current).toMatchObject({ index: 1, beltKmh: 7 });
  });

  it("a belt of 0 stops the meters of a belt distance step and does not end it", () => {
    const plan = runPlan([runStep(1, null, { rule: "belt_distance", meters: 1000, belt: 80 }), runStep(2, 300, { rule: "time", belt: 70 })]);
    const t = rideTimeline(plan, [start(), ev("belt", 30, 0)], at(60));
    expect(t.steps).toEqual([]);
    expect(t.current).toMatchObject({ index: 0, beltKmh: 0, distanceM: 67, remainingMeters: 933, remainingSeconds: null });
  });

  // Unit test 3.
  it("the same with a pause, and a belt event during the pause counts from the resume", () => {
    const plan = runPlan([runStep(1, null, { rule: "belt_distance", meters: 1000, belt: 80 }), runStep(2, 300, { rule: "time", belt: 70 })]);
    const events = [start(), ev("pause", 30), ev("belt", 60, 100), ev("resume", 90)];
    const paused = rideTimeline(plan, events.slice(0, 3), at(80));
    expect(paused.current).toMatchObject({ beltKmh: 10, distanceM: 67, endsAt: null });
    // 67 m before the pause; 933 m at 10 km/h take 336 s from the resume.
    const t = rideTimeline(plan, events, at(500));
    expect(t.steps[0]).toMatchObject({ status: "done", activeSeconds: 366, endedAt: at(426), distanceM: 1000 });
  });

  // Unit test 4.
  it("a belt event whose step key belongs to the step before is ignored", () => {
    const plan = runPlan([runStep(1, 300, { rule: "time", belt: 80 }), runStep(2, 300, { rule: "time", belt: 100 })]);
    const t = rideTimeline(plan, [start(), ev("belt", 310, 120, "s1")], at(320));
    expect(t.current).toMatchObject({ index: 1, beltKmh: 10 });
    const own = rideTimeline(plan, [start(), ev("belt", 310, 120, "s2")], at(320));
    expect(own.current).toMatchObject({ index: 1, beltKmh: 12 });
  });

  // Unit test 5.
  it("undo of a belt burst sends the value from before it and restores it", () => {
    const plan = runPlan([runStep(1, 600, { rule: "time", belt: 80 })]);
    const t = rideTimeline(plan, [start(), ev("belt", 10, 95), ev("belt", 13, 80)], at(60));
    expect(t.current?.beltKmh).toBe(8);
    // 57 s at 8 km/h and 3 s at 9.5 km/h.
    expect(t.current?.distanceM).toBe(Math.round((57 * 8 + 3 * 9.5) / 3.6));
  });

  // Unit test 6.
  it("a recovery after a 13 km/h stride counts its own frozen belt", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Strides",
      steps: [{ type: "repeat", count: 2, steps: [{ type: "work", end: { type: "time", seconds: 20 }, belt: 13 }, { type: "recovery", end: { type: "time", seconds: 100 }, belt: 7 }] }],
    });
    const plan = buildRunPlan(w, ids(w), OWNER, "indoor");
    expect(plan.steps.map((s) => s.run?.belt)).toEqual([130, 70, 130, 70]);
    const t = rideTimeline(plan, [start(), ev("belt", 10, 125)], at(30));
    expect(t.steps[0]).toMatchObject({ distanceM: Math.round((10 * 13 + 10 * 12.5) / 3.6) });
    expect(t.current).toMatchObject({ index: 1, beltKmh: 7 });
  });

  it("incline carries over unless the step has its own; the step saves its time-weighted incline", () => {
    const plan = runPlan([runStep(1, 100, { rule: "time", belt: 80, incline: 10 }), runStep(2, 100, { rule: "time", belt: 80 }), runStep(3, 100, { rule: "time", belt: 80, incline: 0 })]);
    const t = rideTimeline(plan, [start(), ev("incline", 50, 30)], at(250));
    expect(t.steps.map((s) => s.inclinePct)).toEqual([2, 3]);
    expect(t.current?.inclinePct).toBe(0);
  });

  // Unit test 8.
  it("an outdoor distance step ends on its estimate, early on Lap, later with +1 min, and a late lap moves its end", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Reps",
      steps: [
        { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "absolute", low: 3.2, high: 3.4 } },
        { type: "recovery", end: { type: "time", seconds: 120 } },
        { type: "work", end: { type: "time", seconds: 300 } },
      ],
    });
    const plan = buildRunPlan(w, ids(w), {}, "outdoor");
    // 1000 m at 3.3 m/s.
    expect(plan.steps[0]).toMatchObject({ seconds: 303, run: { rule: "estimate", meters: 1000 } });
    expect(plan.surface).toBe("road");

    const onTime = rideTimeline(plan, [start()], at(310));
    expect(onTime.steps[0]).toMatchObject({ status: "done", endedAt: at(303) });
    const early = rideTimeline(plan, [start(), ev("lap", 250)], at(260));
    expect(early.steps[0]).toMatchObject({ status: "done", endedAt: at(250) });
    const longer = rideTimeline(plan, [start(), ev("extend", 100, 60)], at(400));
    expect(longer.steps[0]).toMatchObject({ status: "done", endedAt: at(363), extendedSeconds: 60 });

    const late = rideTimeline(plan, [start(), ev("lap", 328)], at(400));
    expect(late.steps[0]).toMatchObject({ status: "done", endedAt: at(328), activeSeconds: 328 });
    expect(late.current).toMatchObject({ index: 1, startedAt: at(328), activeSeconds: 72 });
    const tooLate = rideTimeline(plan, [start(), ev("lap", 334)], at(400));
    expect(tooLate.steps.map((s) => [s.index, s.status, s.endedAt])).toEqual([
      [0, "done", at(303)],
      [1, "partial", at(334)],
    ]);
    expect(tooLate.current).toMatchObject({ index: 2, startedAt: at(334) });
  });

  // Unit test 9.
  it("auto ends 2 hours after a plan whose distance step has no belt counts that step at 6 km/h", () => {
    const w = tree({ v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "distance", meters: 5000 } }] });
    const plan = buildRunPlan(w, ids(w), {}, "indoor");
    expect(plan.steps[0]).toMatchObject({ seconds: null, estSeconds: 3000, run: { rule: "belt_distance", belt: null } });
    const open = rideTimeline(plan, [start()], at(3000));
    expect(open.openSteps).toBe(1);
    expect(open.current).toMatchObject({ remainingSeconds: null, distanceM: null });
    expect(rideTimeline(plan, [start()], at(3000) + AUTO_END_AFTER_MS - 1000).status).toBe("running");
    const ended = rideTimeline(plan, [start()], at(3000) + AUTO_END_AFTER_MS);
    expect(ended).toMatchObject({ status: "ended_early", autoEnded: true, endedAt: at(0) });
  });

  // Unit test 10.
  it("a Garmin mode correction does not change the timeline output", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Base",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
        { type: "work", end: { type: "distance", meters: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
      ],
    });
    const plan = buildRunPlan(w, ids(w), OWNER, "indoor");
    const events = [start(), ev("belt", 100, 85), ev("pause", 700), ev("resume", 760), ev("belt", 800, 90)];
    const before = rideTimeline(plan, events, at(3000));
    const corrected: RidePlan = { ...plan, mode: "outdoor" };
    expect(rideTimeline(corrected, events, at(3000))).toEqual(before);
  });

  // Unit test 11 (the timeline part; the alert rows come with step 6).
  it("in a strides block a skip ends one rep, a block skip the rest of the block, and an unskip takes it back", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Strides",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 300 } },
        { type: "repeat", count: 6, steps: [{ type: "work", end: { type: "time", seconds: 20 } }, { type: "recovery", end: { type: "time", seconds: 100 } }] },
        { type: "cooldown", end: { type: "time", seconds: 180 } },
      ],
    });
    const plan = buildRunPlan(w, ids(w), OWNER, "indoor");
    expect(plan.steps.filter((s) => s.run?.block !== null)).toHaveLength(12);
    expect(plan.steps).toHaveLength(14);
    const one = rideTimeline(plan, [start(), ev("skip", 310)], at(320));
    expect(one.steps.map((s) => s.status)).toEqual(["done", "skipped"]);
    expect(one.current).toMatchObject({ index: 2 });
    const rest = rideTimeline(plan, [start(), ev("skip", 310, 1)], at(320));
    expect(rest.steps.filter((s) => s.status === "skipped")).toHaveLength(12);
    expect(rest.current).toMatchObject({ index: 13, startedAt: at(310) });
    const back = rideTimeline(plan, [start(), ev("skip", 310, 1), ev("unskip", 313)], at(315));
    expect(back.steps.map((s) => s.status)).toEqual(["done"]);
    expect(back.current).toMatchObject({ index: 1, activeSeconds: 15 });
  });

  it("a nudge does nothing on a run, and a belt does nothing on a ride", () => {
    const plan = runPlan([runStep(1, 600, { rule: "time", belt: 80 })]);
    expect(rideTimeline(plan, [start(), ev("nudge", 10, 5)], at(20)).current?.offsetW).toBe(0);
    const ride = { steps: [{ key: "s1", programSetId: 1, seconds: 600, power: { from: 100, to: 120 } }] };
    const t = rideTimeline(ride, [start(), ev("belt", 10, 100), ev("incline", 11, 10)], at(20));
    expect(t.current).toEqual(rideTimeline(ride, [start()], at(20)).current);
    expect(t.current).not.toHaveProperty("beltKmh");
  });
});
