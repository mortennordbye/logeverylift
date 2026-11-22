import { BASE_RUN, OWNER } from "@/__tests__/fixtures/base-run";
import { ridePushUrl, runPushSchedule } from "@/lib/utils/ride-pushes";
import { rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The push alerts of a running run (docs/plans/run-logger.md, step 6 and 4.5). */

const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const at = (s: number) => T0 + s * 1000;
let seq = 0;
const ev = (kind: RideEventInput["kind"], s: number, value?: number, stepKey?: string): RideEventInput => ({
  seq: ++seq,
  kind,
  at: at(s),
  ...(value !== undefined && { value }),
  ...(stepKey !== undefined && { stepKey }),
});

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}
const ids = (w: Workout) => Array.from({ length: w.steps.reduce((a, n) => a + (n.type === "repeat" ? n.count * n.steps.length : 1), 0) }, (_, i) => 1000 + i);
const base = tree(BASE_RUN);
const treadmill = buildRunPlan(base, ids(base), OWNER, "indoor");
const outdoor = buildRunPlan(base, ids(base), OWNER, "outdoor");

function schedule(plan: typeof treadmill, events: RideEventInput[], s: number, opts = {}) {
  return runPushSchedule(plan, rideTimeline(plan, [ev("start", 0), ...events], at(s)), at(s), opts).map((r) => ({ ...r, sendAt: (r.sendAt - T0) / 1000 }));
}

describe("runPushSchedule", () => {
  it("a treadmill run: the belt first, one alert at the strides block start and one at the end of its last work round", () => {
    expect(schedule(treadmill, [], 1)).toEqual([
      { sendAt: 540, kind: "minute_left", title: "1 min left · next 8.2 km/h · Steady", body: "Step 1 of 4 · Warm-up", stepIndex: 0 },
      { sendAt: 600, kind: "step", title: "8.2 km/h · Steady · 50 min", body: "Step 2 of 4 · Warm-up done", stepIndex: 1 },
      { sendAt: 3540, kind: "minute_left", title: "1 min left · next 13.0 km/h · Strides 6 × 30 s", body: "Step 2 of 4 · Steady", stepIndex: 1 },
      { sendAt: 3600, kind: "step", title: "13.0 km/h · Strides 6 × 30 s · 1 min 30 s easy between", body: "Step 3 of 4 · Steady done", stepIndex: 2 },
      // The end of the 6th stride: the recovery after it.
      { sendAt: 4230, kind: "step", title: "7.0 km/h · Easy · 1 min 30 s", body: "Step 3 of 4 · Strides done", stepIndex: 13 },
      // The recovery after the last stride ends: the step that just ended is named, not the block again.
      { sendAt: 4320, kind: "step", title: "5.5 km/h · Cool-down · 3 min", body: "Step 4 of 4 · Easy done", stepIndex: 14 },
      { sendAt: 4440, kind: "minute_left", title: "1 min left · last step", body: "Step 4 of 4 · Cool-down", stepIndex: 14 },
      { sendAt: 4500, kind: "done", title: "Run done", body: "Step 4 of 4 · Cool-down done", stepIndex: 14 },
    ]);
  });

  it("outdoors: the target of 4.2 first", () => {
    const titles = schedule(outdoor, [], 1).map((r) => r.title);
    expect(titles).toEqual([
      "1 min left · next HR under 162 · Steady",
      "HR under 162 · Steady · 50 min",
      "1 min left · next Fast and relaxed · Strides 6 × 30 s",
      "Fast and relaxed · Strides 6 × 30 s · 1 min 30 s easy between",
      "Easy jog or walk · Easy · 1 min 30 s",
      "Effort 1-2 · Cool-down · 3 min",
      "1 min left · last step",
      "Run done",
    ]);
  });

  it("inside a block: no alert per rep and no 1 min left, only the end of the last work round", () => {
    // Stride 3 runs (3600 + 2 × 120 = 3840 to 3870).
    const rows = schedule(treadmill, [], 3850);
    expect(rows.map((r) => [r.sendAt, r.kind, r.stepIndex])).toEqual([
      [4230, "step", 13],
      [4320, "step", 14],
      [4440, "minute_left", 14],
      [4500, "done", 14],
    ]);
  });

  it("a single skip inside the block: the run moves on to the next step of the block", () => {
    // Skip stride 6 (4200 to 4230): its recovery runs from 4210 to 4300, so the 4230 alert goes.
    const last = schedule(treadmill, [ev("skip", 4210, undefined, treadmill.steps[12].key)], 4211);
    expect(last.map((r) => [r.sendAt, r.kind, r.stepIndex, r.body])).toEqual([
      [4300, "step", 14, "Step 4 of 4 · Easy done"],
      [4420, "minute_left", 14, "Step 4 of 4 · Cool-down"],
      [4480, "done", 14, "Step 4 of 4 · Cool-down done"],
    ]);
    // Skip stride 3 (3840 to 3870) at 3850: the block's end and every alert after it come 20 s sooner.
    const mid = schedule(treadmill, [ev("skip", 3850, undefined, treadmill.steps[6].key)], 3851);
    expect(mid.map((r) => [r.sendAt, r.kind, r.stepIndex])).toEqual([
      [4210, "step", 13],
      [4300, "step", 14],
      [4420, "minute_left", 14],
      [4480, "done", 14],
    ]);
  });

  it("hold to skip in a block skips the rest of it; its unskip brings the block's alerts back", () => {
    const key = treadmill.steps[6].key;
    const skipped = schedule(treadmill, [ev("skip", 3850, 1, key)], 3851);
    expect(skipped.map((r) => [r.sendAt, r.kind])).toEqual([
      [3970, "minute_left"],
      [4030, "done"],
    ]);
    const back = schedule(treadmill, [ev("skip", 3850, 1, key), ev("unskip", 3852)], 3853);
    expect(back.map((r) => [r.sendAt, r.kind, r.stepIndex])).toEqual([
      [4230, "step", 13],
      [4320, "step", 14],
      [4440, "minute_left", 14],
      [4500, "done", 14],
    ]);
  });

  it("a belt event moves the alerts of a belt distance step", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Km",
      steps: [
        { type: "work", end: { type: "distance", meters: 1000 }, belt: 10 },
        { type: "work", end: { type: "time", seconds: 120 }, belt: 8 },
      ],
    });
    const p = buildRunPlan(w, ids(w), OWNER, "indoor");
    // 1 km at 10 km/h is 360 s.
    expect(schedule(p, [], 10).map((r) => [r.sendAt, r.kind, r.title])).toEqual([
      [300, "minute_left", "1 min left · next 8.0 km/h · Work"],
      [360, "step", "8.0 km/h · Work · 2 min"],
      [420, "minute_left", "1 min left · last step"],
      [480, "done", "Run done"],
    ]);
    // At 60 s, 167 m run; the 833 m left at 12 km/h take 250 s.
    expect(schedule(p, [ev("belt", 60, 120, p.steps[0].key)], 61).map((r) => r.sendAt)).toEqual([250, 310, 370, 430]);
  });

  it("a later belt distance step counts at its frozen belt; with no belt, nothing after its start has a time", () => {
    const steps = (belt?: number) => [
      { type: "work", end: { type: "time", seconds: 120 }, belt: 8 },
      { type: "work", end: { type: "distance", meters: 1000 }, ...(belt && { belt }) },
      { type: "cooldown", end: { type: "time", seconds: 120 }, belt: 6 },
    ];
    const withBelt = tree({ v: 2, sport: "run", name: "A", steps: steps(10) });
    const p = buildRunPlan(withBelt, ids(withBelt), {}, "indoor");
    expect(schedule(p, [], 1).map((r) => [r.sendAt, r.kind])).toEqual([
      [60, "minute_left"],
      [120, "step"],
      [420, "minute_left"],
      [480, "step"],
      [540, "minute_left"],
      [600, "done"],
    ]);
    expect(schedule(p, [], 1)[1].title).toBe("10.0 km/h · Work · 1 km");
    const byFeel = tree({ v: 2, sport: "run", name: "B", steps: steps() });
    const q = buildRunPlan(byFeel, ids(byFeel), {}, "indoor");
    const rows = schedule(q, [], 1);
    expect(rows.map((r) => [r.sendAt, r.kind])).toEqual([
      [60, "minute_left"],
      [120, "step"],
    ]);
    expect(rows[1].title).toBe("Belt by feel · Work · 1 km");
  });

  it("a brick run outdoors: an alert in its first 10 min says effort 4 to 5", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Brick",
      steps: [
        { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
      ],
    });
    const p = buildRunPlan(w, ids(w), OWNER, "outdoor");
    const steps = schedule(p, [], 1, { brick: true }).filter((r) => r.kind === "step");
    expect(steps.map((r) => r.title)).toEqual(["Effort 4-5 · Steady · 10 min", "HR under 162 · Steady · 10 min"]);
    expect(schedule(p, [], 1).filter((r) => r.kind === "step")[0].title).toBe("HR under 162 · Steady · 10 min");
  });

  it("none while paused or after the end", () => {
    expect(schedule(treadmill, [ev("pause", 100)], 150)).toEqual([]);
    expect(schedule(treadmill, [ev("end", 100)], 150)).toEqual([]);
  });

  it("no punctuation colons or em dashes in any run alert; a colon inside a pace (5:36) is a number", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Intervals",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
        {
          type: "repeat",
          count: 4,
          steps: [
            { type: "work", end: { type: "time", seconds: 240 }, target: { metric: "pace", anchor: "threshold_pace", low: 96, high: 101 } },
            { type: "recovery", end: { type: "time", seconds: 120 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 2 } },
          ],
        },
      ],
    });
    // With an LTHR heart rate leads, as on the run screen (docs/plans/strict-targets.md); with none the pace leads.
    const hr = buildRunPlan(w, ids(w), OWNER, "outdoor");
    expect(schedule(hr, [], 1).some((r) => r.title.startsWith("HR 171-179 · Work · 1 of 4"))).toBe(true);
    const pace = buildRunPlan(w, ids(w), { run_threshold_pace: OWNER.run_threshold_pace }, "outdoor");
    const paceRows = schedule(pace, [], 1);
    expect(paceRows.some((r) => /\d:\d\d-\d:\d\d \/km/.test(r.title))).toBe(true);
    for (const plan of [treadmill, outdoor, hr, pace]) {
      for (const s of [1, 3850]) for (const r of schedule(plan, [], s)) expect(`${r.title} ${r.body}`).not.toMatch(/(?<!\d):|:(?!\d)|—/);
    }
  });

  it("outdoors an alert names the same main target as the run screen", () => {
    const w = tree({
      v: 2,
      sport: "run",
      name: "Steady",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
        { type: "work", end: { type: "time", seconds: 1500 }, target: { metric: "pace", anchor: "absolute", low: 2.564, high: 2.632 }, target2: { metric: "hr", anchor: "absolute", low: 142, high: 155 } },
      ],
    });
    const plan = buildRunPlan(w, ids(w), OWNER, "outdoor");
    const step = schedule(plan, [], 1).find((r) => r.kind === "step" && r.stepIndex === 1)!;
    expect(step.title).toBe("HR 142-155 · Work · 25 min");
  });

  it("the tap opens the run exercise in run mode", () => {
    expect(ridePushUrl(5, 9)).toBe("/programs/5/workout/exercises/9?ride=1");
  });
});
