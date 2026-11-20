import { describe, expect, it } from "vitest";
import { BASE_RUN, OWNER } from "@/__tests__/fixtures/base-run";
import { rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { beltStepsChanged, beltResults, beltToastText, resumeBeltText, runKeptText, runScreen, stepOnText } from "@/lib/utils/run-screen";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";

/** What run mode shows (docs/plans/run-logger.md, 4.2 to 4.6 and section 5 "Run mode"). */

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
const screenAt = (plan: typeof treadmill, s: number, events: RideEventInput[] = [], opts = {}) => runScreen(plan, rideTimeline(plan, [ev("start", 0), ...events], at(s)), opts)!;

describe("runScreen on a treadmill", () => {
  it("shows the step as the step list numbers it, the belt with the plan's, the incline, heart rate and pace", () => {
    const s = screenAt(treadmill, 30);
    expect(s.header).toBe("Treadmill · step 1 of 4");
    expect(s.title).toBe("Warm-up");
    expect(s.clock).toBe("9:30");
    expect(s.treadmill).toEqual({ belt: 7.5, planBelt: 7.5, incline: 1 });
    expect(s.second).toEqual([
      { label: "HR", value: "under 151" },
      { label: "Pace", value: "8:00 /km" },
    ]);
    expect(s.next).toEqual({ title: "Steady · 50:00", target: "8.2 km/h" });
    expect(s.canExtend).toBe(true);
    expect(s.lap).toBe(false);
    expect(s.target).toBeNull();
  });

  it("a belt tap moves the belt now, and the plan's stays to compare", () => {
    const s = screenAt(treadmill, 60, [ev("belt", 40, 85, "s1")]);
    expect(s.treadmill).toEqual({ belt: 8.5, planBelt: 7.5, incline: 1 });
    expect(s.second[1]).toEqual({ label: "Pace", value: "7:04 /km" });
  });

  it("cues the belt 10 s before a step whose belt differs by 1 km/h or more, not before", () => {
    // Steady ends at 3600 s; the first stride runs at 13.0.
    expect(screenAt(treadmill, 3589).cue).toBeNull();
    expect(screenAt(treadmill, 3590).cue).toBe("Speed up to 13.0 km/h");
    // A stride ends at 3630 s; its recovery runs at 7.0.
    expect(screenAt(treadmill, 3622).cue).toBe("Slow down to 7.0 km/h");
    // Warm-up 7.5 to steady 8.2 is under 1 km/h: no cue.
    expect(screenAt(treadmill, 595).cue).toBeNull();
  });

  it("a strides block is one step: Stride 2 of 6 with its dots, and the next step inside the block", () => {
    const s = screenAt(treadmill, 3600 + 120 + 5);
    expect(s.header).toBe("Treadmill · step 3 of 4");
    expect(s.title).toBe("Stride 2 of 6");
    expect(s.block).toEqual({ index: 2, of: 6, done: 1 });
    expect(s.inBlock).toBe(true);
    expect(s.next).toEqual({ title: "Easy · 1:30", target: "7.0 km/h" });
    expect(s.treadmill?.belt).toBe(13);
    // Before the block, the Next card names it as one.
    expect(screenAt(treadmill, 700).next).toEqual({ title: "Strides 6 × 30 s", target: "13.0 km/h" });
  });

  it("a distance step on the belt shows the meters left and takes no +1 min", () => {
    const w = tree({ v: 2, sport: "run", name: "x", steps: [{ type: "work", end: { type: "distance", meters: 1000 }, belt: 10 }] });
    const plan = buildRunPlan(w, ids(w), OWNER, "indoor");
    const s = screenAt(plan, 180);
    expect(s.distanceLine).toBe("500 m left");
    expect(s.canExtend).toBe(false);
  });

  it("the count says the first belt, and the paused screen the belt to set", () => {
    expect(stepOnText(treadmill)).toBe("Step on · Set belt 7.5 km/h");
    const paused = rideTimeline(treadmill, [ev("start", 0), ev("belt", 10, 80, "s1"), ev("pause", 20)], at(30));
    expect(resumeBeltText(paused)).toBe("Set belt 8.0 km/h");
  });
});

describe("runScreen outdoors", () => {
  it("shows the outdoor target big, with Lap", () => {
    const s = screenAt(outdoor, 30);
    expect(s.header).toBe("Outdoor · step 1 of 4");
    expect(s.target).toEqual({ value: "under 151", unit: "bpm" });
    expect(s.treadmill).toBeNull();
    expect(s.lap).toBe(true);
    expect(s.next.target).toBe("HR under 160");
  });

  it("a distance step ends on its estimate: 1 km · about its time", () => {
    const w = tree({ v: 2, sport: "run", name: "x", steps: [{ type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 100, high: 100 } }] });
    const plan = buildRunPlan(w, ids(w), OWNER, "outdoor");
    expect(screenAt(plan, 10).distanceLine).toBe("1 km · about 5:39");
  });

  it("a brick run runs its first 10 min on effort 4 to 5 with short quick steps, then the written target", () => {
    const s = screenAt(outdoor, 30, [], { brick: true });
    expect(s.target).toEqual({ value: "Effort 4-5", unit: null });
    expect(s.second).toEqual([
      { label: "Short quick steps", value: "" },
      { label: "HR", value: "under 160" },
    ]);
    expect(screenAt(outdoor, 700, [], { brick: true }).target).toEqual({ value: "under 160", unit: "bpm" });
    // On a treadmill the belt stays the main target; the effort and the cue go on the second line.
    expect(screenAt(treadmill, 30, [], { brick: true }).second.slice(0, 2)).toEqual([
      { label: "Effort", value: "4-5" },
      { label: "Short quick steps", value: "" },
    ]);
  });
});

describe("runKeptText", () => {
  it("counts a strides block once and leaves out skipped steps", () => {
    const t = rideTimeline(treadmill, [ev("start", 0), ev("skip", 100, undefined, "s1"), ev("pause", 3600 + 200)], at(3600 + 300));
    expect(runKeptText(treadmill, t)).toBe("Steps 2 and 3 are saved");
    expect(runKeptText(treadmill, t, true)).toBe("Steps 2 and 3 are saved. Ending now keeps them.");
  });
});

describe("beltResults", () => {
  it("gives meters, speed and incline from the belt; only the incline with no belt", () => {
    expect(beltResults({ distanceM: 1250, inclinePct: 1, activeSeconds: 600 })).toEqual({ distanceMeters: 1250, avgSpeed: 2.083, inclinePercent: 1 });
    expect(beltResults({ distanceM: null, inclinePct: 1.5, activeSeconds: 600 })).toEqual({ inclinePercent: 1.5 });
    expect(beltResults({ distanceM: undefined, inclinePct: undefined, activeSeconds: 600 })).toEqual({});
  });

  it("toasts say the value", () => {
    expect(beltToastText("belt", 95)).toBe("Belt 9.5 km/h");
    expect(beltToastText("incline", 15)).toBe("Incline 1.5%");
  });
});

describe("beltStepsChanged", () => {
  it("only the ended steps whose belt meters or incline moved", () => {
    const before = rideTimeline(treadmill, [ev("start", 0)], at(700));
    const later = rideTimeline(treadmill, [ev("start", 0), ev("belt", 300, 85, "s1")], at(700));
    expect(beltStepsChanged(before, later).map((r: { index: number }) => r.index)).toEqual([0]);
    const inStep2 = rideTimeline(treadmill, [ev("start", 0), ev("belt", 650, 85, treadmill.steps[1].key)], at(700));
    expect(beltStepsChanged(before, inStep2)).toEqual([]);
  });
});
