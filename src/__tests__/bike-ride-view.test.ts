import { CHART, bikeStepRows, defaultRideMode, plannedRideNumbers, rideChart, rideLengthText } from "@/lib/utils/bike-ride-view";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The mockup ride of docs/plans/bike-ride-logger.md (4.6, section 5), at FTP 180 and bike LTHR 171. */
function mockupRide(): Workout {
  const p = parseWorkout({
    v: 2,
    sport: "bike",
    name: "Upper endurance 2 x 15",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 }, cadence: { low: 85, high: 95 } },
      {
        type: "repeat",
        count: 2,
        steps: [
          { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 }, cadence: { low: 85, high: 95 }, note: "Talk in short sentences" },
          { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
        ],
      },
      { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
    ],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.workout;
}
const setIds = [1, 2, 3, 4, 5, 6];
const thresholds = { ftp: 180, lthr_bike: 171 };

describe("defaultRideMode (D6)", () => {
  it("takes the planned session's mode first", () => {
    expect(defaultRideMode({ plannedMode: "outdoor", lastMode: "indoor", month: 1 })).toBe("outdoor");
  });
  it("then the last ride of this program exercise", () => {
    expect(defaultRideMode({ plannedMode: null, lastMode: "indoor", month: 7 })).toBe("indoor");
    expect(defaultRideMode({ plannedMode: null, lastMode: "outdoor", month: 12 })).toBe("outdoor");
  });
  it("then the month: November to March indoor, April to October outdoor", () => {
    const byMonth = Array.from({ length: 12 }, (_, i) => defaultRideMode({ plannedMode: null, lastMode: null, month: i + 1 }));
    expect(byMonth).toEqual(["indoor", "indoor", "indoor", "outdoor", "outdoor", "outdoor", "outdoor", "outdoor", "outdoor", "outdoor", "indoor", "indoor"]);
  });
});

describe("plannedRideNumbers, the mockup ride", () => {
  const plan = buildRidePlan(mockupRide(), setIds, thresholds, "indoor");
  const n = plannedRideNumbers(plan);

  it("runs 5 steps over 65 min: the recovery after the last round is dropped", () => {
    expect(plan.steps).toHaveLength(5);
    expect(n.seconds).toBe(65 * 60);
    expect(n.open).toBe(false);
    expect(rideLengthText(n)).toBe("65 min");
  });
  it("planned IF 0.71, load 55, 490 kJ (4.6), a ramp counted at its midpoint", () => {
    expect(n.intensityFactor!.toFixed(2)).toBe("0.71");
    expect(Math.round(n.load.load)).toBe(55);
    expect(n.load.partial).toBe(false);
    expect(n.kj).toBe(490);
  });
  it("the same load without an FTP, and no kJ", () => {
    const noFtp = plannedRideNumbers(buildRidePlan(mockupRide(), setIds, {}, "indoor"));
    expect(Math.round(noFtp.load.load)).toBe(55);
    expect(noFtp.kj).toBeNull();
  });
  it("time in zones from each step's midpoint: Z1 5, Z2 30, Z3 30, main zone Z3", () => {
    expect(n.zoneMinutes.slice(0, 4)).toEqual([5, 30, 30, 0]);
    expect(n.mainZone).toBe(3);
  });
  it("a ramp alone counts at its midpoint in plannedLoad", () => {
    const ramp = parseWorkout({ v: 2, sport: "bike", name: "Ramp", steps: [{ type: "work", end: { type: "time", seconds: 3600 }, ramp: { anchor: "ftp", from: 60, to: 100 } }] });
    if (!ramp.ok) throw new Error();
    expect(workoutPlannedLoad(ramp.workout, {}).load).toBeCloseTo(64, 6);
  });
  it("a lap step leaves the time open and the load partial", () => {
    const w = mockupRide();
    const lap: Workout = { ...w, steps: [...w.steps, { id: "cd", type: "cooldown", end: { type: "lap" }, free: true }] };
    const open = plannedRideNumbers(buildRidePlan(lap, [...setIds, 7], thresholds, "indoor"));
    expect(rideLengthText(open)).toBe("65 min + open");
    expect(open.load.partial).toBe(true);
  });
});

describe("bikeStepRows", () => {
  it("indoors: watts from the FTP, zone, heart rate, cadence, round and note", () => {
    const rows = bikeStepRows(buildRidePlan(mockupRide(), setIds, thresholds, "indoor"));
    // The heart rate is the zone's, as the outdoor target gives it (docs/plans/strict-targets.md, decision 1).
    expect(rows.map((r) => [r.title, r.detail, r.target, r.time])).toEqual([
      ["Warm-up", "Ramp · HR under 139 · 85-95 rpm", "99 to 135 W", "15 min"],
      ["Work · 1 of 2", "Z2-3 · HR 139-152 · 85-95 rpm", "135-146 W", "15 min"],
      ["Easy", "Z1", "under 97 W", "5 min"],
      ["Work · 2 of 2", "Z2-3 · HR 139-152 · 85-95 rpm", "135-146 W", "15 min"],
      ["Work", "Z2 · HR 139-152", "101-135 W", "15 min"],
    ]);
    expect(rows[1].note).toBe("Talk in short sentences");
    expect(rows.map((r) => r.easy)).toEqual([false, false, true, false, false]);
  });
  it("outdoors: the derived target first, watts as a line for a power meter", () => {
    const rows = bikeStepRows(buildRidePlan(mockupRide(), setIds, thresholds, "outdoor"));
    expect(rows.map((r) => [r.detail, r.target])).toEqual([
      ["Ramp · 99 to 135 W with a power meter", "HR under 139"],
      ["Z2-3 · 135-146 W with a power meter", "HR 139-152"],
      // Effort 2 with its words (4.2).
      ["Z1 · under 97 W with a power meter", "Effort 2 · easy spin"],
      ["Z2-3 · 135-146 W with a power meter", "HR 139-152"],
      ["Z2 · 101-135 W with a power meter", "HR 139-152"],
    ]);
  });
  it("a heart rate second target: indoors next to the cadence, outdoors it leads (docs/plans/strict-targets.md)", () => {
    const p = parseWorkout({
      v: 2,
      sport: "bike",
      name: "Long ride",
      steps: [{ type: "work", end: { type: "time", seconds: 8100 }, target: { metric: "power", anchor: "absolute", low: 110, high: 130 }, target2: { metric: "hr", anchor: "absolute", low: 146, high: 160 }, cadence: { low: 85, high: 95 } }],
    });
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    const [inside] = bikeStepRows(buildRidePlan(p.workout, [1], thresholds, "indoor"));
    expect([inside.detail, inside.target]).toEqual(["Z2 · HR 146-160 · 85-95 rpm", "110-130 W"]);
    const [outside] = bikeStepRows(buildRidePlan(p.workout, [1], thresholds, "outdoor"));
    expect([outside.detail, outside.target]).toEqual(["Z2 · 110-130 W with a power meter", "HR 146-160"]);
  });
  it("without an FTP: targets in % FTP", () => {
    const rows = bikeStepRows(buildRidePlan(mockupRide(), setIds, {}, "indoor"));
    expect(rows.map((r) => r.target)).toEqual(["55 to 75% FTP", "75-81% FTP", "under 55% FTP", "75-81% FTP", "56-75% FTP"]);
  });
});

describe("rideChart", () => {
  it("one bar per step across the width, the FTP line, watt ticks and minute ticks", () => {
    const c = rideChart(buildRidePlan(mockupRide(), setIds, thresholds, "indoor"));
    expect(c.bars.map((b) => b.kind)).toEqual(["ramp", "range", "under", "range", "range"]);
    expect(c.bars.map((b) => b.label)).toEqual(["99 to 135", "135-146", "<97", "135-146", "101-135"]);
    expect(c.bars[0].y).toBeGreaterThan(c.bars[0].y2);
    expect(c.bars[1].capY).toBeLessThan(c.bars[1].y);
    expect(c.bars.map((b) => b.zone)).toEqual([2, 3, 1, 3, 2]);
    expect(c.ftpY).toBeCloseTo(100 - (100 / 130) * 100, 0);
    expect(c.yTicks.map((t) => t.label)).toEqual(["50", "100", "150"]);
    expect(c.xTicks.map((t) => t.label)).toEqual(["0", "15", "30", "45", "65 min"]);
    const last = c.bars[c.bars.length - 1];
    // The zone names keep a gutter right of the plot, clear of every bar and its label.
    expect(last.x + last.w).toBeLessThanOrEqual(CHART.right);
    expect(Math.max(...c.bars.filter((b) => b.label).map((b) => b.x + b.w / 2 + b.label!.length * 2.2))).toBeLessThan(CHART.right + 2);
    expect(CHART.width - CHART.right).toBeGreaterThanOrEqual(12);
  });
  it("without an FTP the labels are in % FTP", () => {
    const c = rideChart(buildRidePlan(mockupRide(), setIds, {}, "indoor"));
    expect(c.bars[1].label).toBe("75-81%");
    expect(c.yTicks.map((t) => t.label)).toEqual(["50%"]);
  });
});

describe("an effort target indoors", () => {
  it("reads Effort, as every bike screen says, not RPE", async () => {
    const { ftpTestWorkout } = await import("@/lib/utils/ftp-tests");
    const { parseWorkout } = await import("@/lib/utils/workout-steps");
    const { workoutToRows } = await import("@/lib/utils/program-steps");
    const parsed = parseWorkout(ftpTestWorkout("20min"));
    if (!parsed.ok) throw new Error("template");
    const ids = workoutToRows(parsed.workout).map((_, i) => i + 1);
    const targets = bikeStepRows(buildRidePlan(parsed.workout, ids, { ftp: 180 }, "indoor")).map((r) => r.target);
    expect(targets).toContain("Effort 9");
    expect(targets).toContain("Effort 9-10");
    expect(targets.some((t) => t?.includes("RPE"))).toBe(false);
  });
});
