import { buildRunPlan } from "@/lib/utils/run-plan";
import { defaultRunMode, plannedRunNumbers, runAnchorText, runChart, runOutdoorText, runStepRows, runStepZone } from "@/lib/utils/run-view";
import { flattenWorkout } from "@/lib/utils/workout-player";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";
import { BASE_RUN, OWNER } from "@/__tests__/fixtures/base-run";
import { describe, expect, it } from "vitest";

/** The run exercise screen's data (docs/plans/run-logger.md, step 2). */

function workout(w: unknown): Workout {
  const p = parseWorkout(w);
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.workout;
}

function plan(w: unknown, th: ThresholdValues, mode: "indoor" | "outdoor", surface: "road" | "trail" = "road") {
  const wk = workout(w);
  return buildRunPlan(wk, flattenWorkout(wk).map((_, i) => i + 1), th, mode, { surface });
}

describe("defaultRunMode (R4)", () => {
  it("takes the last run of the exercise first", () => {
    expect(defaultRunMode({ lastMode: "outdoor", recent: { indoor: 5, outdoor: 0 }, month: 12 })).toBe("outdoor");
  });
  it("else the mode of most runs in the last 4 weeks", () => {
    expect(defaultRunMode({ lastMode: null, recent: { indoor: 1, outdoor: 3 }, month: 1 })).toBe("outdoor");
    expect(defaultRunMode({ lastMode: null, recent: { indoor: 3, outdoor: 1 }, month: 7 })).toBe("indoor");
  });
  it("else, and on a tie, the month: November to March on a treadmill", () => {
    expect([1, 3, 4, 10, 11, 12].map((month) => defaultRunMode({ lastMode: null, recent: { indoor: 0, outdoor: 0 }, month }))).toEqual(["indoor", "indoor", "outdoor", "outdoor", "indoor", "indoor"]);
    expect(defaultRunMode({ lastMode: null, recent: { indoor: 2, outdoor: 2 }, month: 6 })).toBe("outdoor");
  });
});

describe("runStepRows on a treadmill", () => {
  it("shows the mockup rows: belts, the heart rate cap with its start speed, the strides block as one row and the walk", () => {
    const rows = runStepRows(plan(BASE_RUN, OWNER, "indoor"));
    expect(rows.map((r) => [r.title, r.detail, r.time, r.chip])).toEqual([
      ["Warm-up", "Belt 7.5 km/h · incline 1%", "10:00", "Z1"],
      ["Steady", "HR under 160 · start 8.2 km/h", "50:00", "Z2"],
      ["Strides 6 ×", "30 s · 13.0 km/h · 1:30 easy between", "12:00", "Fast"],
      ["Cool-down", "Walk 5.5 km/h", "3:00", "Z1"],
    ]);
    expect(rows.map((r) => r.easy)).toEqual([true, false, false, true]);
  });

  it("with no threshold pace: a heart rate step has no start speed, a written belt and the walk stay", () => {
    const rows = runStepRows(plan(BASE_RUN, { lthr_run: 180 }, "indoor"));
    expect(rows.map((r) => r.detail)).toEqual(["Belt 7.5 km/h · incline 1%", "HR under 160 · set the belt by feel", "30 s · 13.0 km/h · 1:30 easy between", "Walk 5.5 km/h"]);
  });

  it("with no LTHR: heart rate targets show as effort (4.2)", () => {
    const rows = runStepRows(plan(BASE_RUN, { run_threshold_pace: 1000 / 339 }, "indoor"));
    expect(rows[1].detail).toBe("Effort 3 · start 8.2 km/h");
  });

  it("a repeat of long steps keeps a row per round; a treadmill distance step shows its distance", () => {
    const w = {
      v: 2,
      sport: "run",
      name: "Tempo",
      steps: [
        { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } }, { type: "recovery", end: { type: "time", seconds: 120 } }] },
      ],
    };
    const rows = runStepRows(plan(w, OWNER, "indoor"));
    expect(rows.map((r) => [r.title, r.time, r.chip])).toEqual([
      ["Work · 1 of 2", "1 km", "Z4"],
      ["Easy", "2:00", null],
      ["Work · 2 of 2", "1 km", "Z4"],
      ["Easy", "2:00", null],
    ]);
    expect(rows[0].detail).toBe("Belt 10.5 km/h");
  });
});

describe("outdoor targets (4.2)", () => {
  it("caps easy steps, gives strides effort and a recovery the easy jog", () => {
    const rows = runStepRows(plan(BASE_RUN, OWNER, "outdoor"));
    expect(rows.map((r) => r.detail)).toEqual(["HR under 151", "HR under 160", "30 s · Fast and relaxed · 1:30 easy between", "Effort 1-2"]);
  });

  it("work of zone 3 to 5 for 3 min or more: a pace range with heart rate as the second line; on Trail or snow the heart rate", () => {
    const w = {
      v: 2,
      sport: "run",
      name: "Threshold",
      steps: [
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 4 } },
        { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
        { type: "work", end: { type: "time", seconds: 60 }, target: { metric: "pace", anchor: "threshold_pace", low: 110, high: 115 } },
        { type: "recovery", end: { type: "time", seconds: 120 } },
      ],
    };
    const road = plan(w, OWNER, "outdoor");
    expect(road.steps.map((s) => runOutdoorText(s, OWNER, "road"))).toEqual([
      { main: "5:36-5:56 /km", second: "HR 171-178" },
      { main: "5:32-5:46 /km", second: "HR 171-178" },
      { main: "Hard", second: null },
      { main: "Easy jog or walk", second: null },
    ]);
    const trail = plan(w, OWNER, "outdoor", "trail");
    expect(trail.steps.slice(0, 2).map((s) => runOutdoorText(s, OWNER, "trail").main)).toEqual(["HR 171-178", "HR 171-178"]);
    // No threshold pace: the pace step in % of it, the heart rate step as heart rate.
    const noPace = plan(w, { lthr_run: 180 }, "outdoor");
    expect(noPace.steps.slice(0, 2).map((s) => runOutdoorText(s, { lthr_run: 180 }, "road").main)).toEqual(["HR 171-178", "98-102% threshold pace"]);
  });

  it("caps easy and long steps with heart rate, never pace, on both surfaces when there is an LTHR (R13, R14)", () => {
    const w = {
      v: 2,
      sport: "run",
      name: "Pace written",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "pace", anchor: "threshold_pace", low: 75, high: 80 } },
        { type: "work", end: { type: "time", seconds: 1800 }, target: { metric: "pace", anchor: "threshold_pace", low: 88, high: 92 } },
      ],
    };
    for (const surface of ["road", "trail"] as const) {
      const p = plan(w, OWNER, "outdoor", surface);
      const rows = runStepRows(p, surface);
      // 75-80% of threshold speed is 129% of its pace time at the midpoint: Z1 (over 129%).
      expect(rows.map((r) => r.detail)).toEqual(["HR under 151", "HR under 169"]);
      expect(runChart(p).bars.map((b) => b.label).join(" ")).not.toContain("/km");
    }
    // With no LTHR: on Trail or snow an effort, on Road the pace as written.
    expect(runStepRows(plan(w, { run_threshold_pace: OWNER.run_threshold_pace }, "outdoor", "trail"), "trail").map((r) => r.detail)).toEqual(["Effort 2", "Effort 5"]);
    expect(runStepRows(plan(w, { run_threshold_pace: OWNER.run_threshold_pace }, "outdoor"), "road").map((r) => r.detail)).toEqual(["7:04-7:32 /km", "6:08-6:25 /km"]);
  });

  it("an outdoor distance step shows its estimate", () => {
    const w = { v: 2, sport: "run", name: "Km", steps: [{ type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } }] };
    const [row] = runStepRows(plan(w, OWNER, "outdoor"));
    expect(row.time).toBe("1 km");
    expect(row.detail).toBe("5:32-5:46 /km · HR 171-178 · about 5:39");
  });
});

describe("plannedRunNumbers and runChart", () => {
  it("the mockup run: 75 min, the treadmill distance from the belts, most minutes in Z2", () => {
    const n = plannedRunNumbers(plan(BASE_RUN, OWNER, "indoor"));
    expect(n.seconds).toBe(4500);
    expect(n.open).toBe(false);
    // 10 min at 7.5, 50 at 8.2, 6 × (30 s at 13 + 90 s at 7), 3 min at 5.5 km/h.
    expect(n.km).toBe(10.1);
    expect(n.zoneMinutes).toEqual([22, 50, 0, 0, 3]);
    expect(n.mainZone).toBe(2);
    // No target gives an IF here (heart rate and effort), so each step takes its type's default: about 70, marked partial.
    expect(Math.round(n.load.load)).toBe(70);
    expect(n.load.partial).toBe(false);
  });

  it("outdoors with heart rate steps the distance is not known", () => {
    expect(plannedRunNumbers(plan(BASE_RUN, OWNER, "outdoor")).km).toBeNull();
  });

  it("draws a cap as a dashed line at the top of its zone and labels the wide bar", () => {
    const c = runChart(plan(BASE_RUN, OWNER, "indoor"));
    expect(c.ftpY).toBeNull();
    expect(c.bars[1]).toMatchObject({ kind: "under", zone: 2, label: "Z2 · HR under 160" });
    expect(c.bars[2]).toMatchObject({ kind: "range", zone: 5, label: null });
    expect(c.bands.map((b) => b.zone)).toEqual([1, 2, 3, 4]);
    expect(c.xTicks.at(-1)!.label).toBe("75 min");
  });

  it("reads the zone of heart rate, pace and effort targets", () => {
    const st = (target: unknown) => workout({ v: 2, sport: "run", name: "x", steps: [{ type: "work", end: { type: "time", seconds: 60 }, target }] }).steps[0] as never;
    expect(runStepZone(st({ metric: "hr", anchor: "lthr", zone: 3 }), {})).toBe(3);
    expect(runStepZone(st({ metric: "pace", anchor: "threshold_pace", low: 85, high: 89 }), {})).toBe(2);
    expect(runStepZone(st({ metric: "pace", anchor: "threshold_pace", low: 105, high: 110 }), {})).toBe(5);
    expect(runStepZone(st({ metric: "rpe", anchor: "absolute", low: 7, high: 7 }), {})).toBe(3);
  });

  it("the line under the title names threshold pace on a treadmill and LTHR outdoors", () => {
    expect(runAnchorText(OWNER, "indoor")).toBe("threshold 5:39 /km");
    expect(runAnchorText(OWNER, "outdoor")).toBe("LTHR 180");
    expect(runAnchorText({ lthr_run: 180 }, "indoor")).toBe("LTHR 180");
    expect(runAnchorText({}, "outdoor")).toBeNull();
  });
});
