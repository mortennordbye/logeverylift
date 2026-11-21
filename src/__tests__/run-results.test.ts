import { describe, expect, it } from "vitest";
import type { StepLog } from "@/lib/utils/ride-results";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { brickText, runResultPayloads, runResultRows, runSummary, type RunStepLog } from "@/lib/utils/run-results";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";

/** The run results table and summary (docs/plans/run-logger.md, section 5, 4.2 judging, 4.7 and 4.9). */

/** The owner: threshold pace 5:39 /km, run LTHR 180. */
const OWNER: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

/** "2 Base · Run" as the owner's program holds it. */
const BASE = tree({
  v: 2,
  sport: "run",
  name: "2 Base · Run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 }, belt: 7.5, incline: 1 },
    { type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 6,
      steps: [
        { type: "work", end: { type: "time", seconds: 30 }, target: { metric: "rpe", anchor: "absolute", low: 9, high: 9 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 90 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 3 }, belt: 7 },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 180 }, target: { metric: "rpe", anchor: "absolute", low: 1, high: 2 } },
  ],
});
const ids = Array.from({ length: 15 }, (_, i) => 100 + i);
const plan = buildRunPlan(BASE, ids, OWNER, "indoor");

const log = (seconds: number, kmh: number | null, extra: Partial<RunStepLog> = {}): RunStepLog => ({
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
  rpe: 6,
  sources: kmh === null ? { durationSeconds: "clock" } : { durationSeconds: "clock", distanceMeters: "belt", avgSpeed: "belt" },
  ...extra,
});

/** The run as the summary mockup shows it: steady at 8.5 km/h, 5 of 6 strides (the last skipped). */
function ranLogs(): Record<number, RunStepLog> {
  const logs: Record<number, RunStepLog> = {
    100: log(600, 7.5, { avgHr: 124, inclinePercent: 1 }),
    101: log(3000, 8.5, { avgHr: 146 }),
    114: log(180, 5.5, { avgHr: 118 }),
  };
  for (let k = 0; k < 6; k++) {
    logs[102 + 2 * k] = k < 5 ? log(30, 13) : log(0, null, { status: "skipped" });
    logs[103 + 2 * k] = k < 5 ? log(90, 7) : log(0, null, { status: "skipped" });
  }
  return logs;
}

describe("the results table rows", () => {
  it("one row per step, a strides block as one row with the reps run, and the plan's belt", () => {
    const { steps, rows } = runResultRows(plan, ranLogs());
    expect(steps).toHaveLength(15);
    expect(rows.map((r) => [r.n, r.title, r.planBelt])).toEqual([
      [1, "Warm-up", 7.5],
      [2, "Steady", 8.2],
      [3, "Strides 6 × 30 s · 5 of 6", null],
      [4, "Cool-down", 5.5],
    ]);
    expect(rows[2].step).toBeNull();
  });
});

describe("the results table's saves", () => {
  const ctx = { sessionId: 1, exerciseId: 2, setNumbers: Object.fromEntries(ids.map((id, i) => [id, i + 1])) };
  it("a belt set in the table saves typed speed and distance over the step's time; untouched steps send nothing", () => {
    const { steps } = runResultRows(plan, ranLogs());
    const out = runResultPayloads(steps, {}, { 101: 9 }, undefined, 6, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ programSetId: 101, durationSeconds: 3000, stepStatus: "done", avgSpeed: 2.5, distanceMeters: 7500, sources: { avgSpeed: "typed", distanceMeters: "typed" } });
  });

  it("outdoors one total distance spreads over the steps run by their time, adding up to the total", () => {
    const out = buildRunPlan(BASE, ids, OWNER, "outdoor");
    const logs = ranLogs();
    for (const l of Object.values(logs)) Object.assign(l, { avgSpeed: null, distanceMeters: null, sources: { durationSeconds: "clock" } });
    const { steps } = runResultRows(out, logs);
    const saved = runResultPayloads(steps, {}, {}, "9.75", 6, ctx);
    const total = saved.reduce((a, p) => a + ((p as { distanceMeters?: number }).distanceMeters ?? 0), 0);
    expect(total).toBe(9750);
    expect(saved.find((p) => p.programSetId === 101)).toMatchObject({ distanceMeters: Math.round((9750 * 3000) / 4380), sources: { distanceMeters: "typed" } });
    // The skipped steps get none.
    expect(saved.some((p) => p.programSetId === 112)).toBe(false);
  });
});

describe("the summary", () => {
  it("tiles, distance source, zones and the step table in the plan's units (the summary mockup)", () => {
    const s = runSummary(plan, ranLogs(), { beltEvents: true });
    // 600 + 3000 + 5 x 120 + 180 s; 1250 + 7083 + 5 x (108 + 175) + 275 m.
    expect(s.tiles.map((t) => [t.label, t.value, t.est ?? false])).toEqual([
      ["Time", "73:00", false],
      ["Distance", "10.0 km", false],
      ["Pace", "7:16 /km", false],
      ["Avg HR", "141", false],
      ["Load", expect.stringMatching(/^\d+$/), true],
      ["Effort", "6", false],
    ]);
    expect(s.distanceLine).toBe("Distance from the belt");
    expect(s.zones).toEqual([
      { zone: 1, m: 63 },
    ]);
    expect(s.rows.map((r) => [r.title, r.plan, r.done, r.mark])).toEqual([
      ["Warm-up", "7.5 · HR 153", "7.5 · HR 124", null],
      ["Steady", "8.2 · HR 162", "8.5 · HR 146", null],
      ["Strides", "6 × 30 s", "5 of 6", null],
      ["Cool-down", "5.5 · Z1", "5.5 · HR 118", null],
    ]);
    expect(s.footnote).toBe("km/h · HR. Under an easy cap is a pass.");
  });

  it("counts the run time and distance of a skipped step in the totals (4.7)", () => {
    const logs = ranLogs();
    logs[114] = log(60, 5.5, { status: "skipped" });
    const s = runSummary(plan, logs, { beltEvents: true });
    expect(s.numbers.seconds).toBe(600 + 3000 + 5 * 120 + 60);
    expect(s.rows[3].done).toBe("Skipped");
  });

  it("marks a step over its cap with ↑ and leaves a short step unjudged (4.2)", () => {
    const logs = ranLogs();
    logs[101] = log(3000, 8.5, { avgHr: 165 });
    logs[114] = log(180, 5.5, { avgHr: 190 });
    const s = runSummary(plan, logs, { beltEvents: true });
    expect(s.rows[1].mark).toBe("↑");
    expect(s.rows[3].mark).toBeNull();
  });

  it("judges a treadmill pace step by its belt, within 0.25 km/h of the range", () => {
    const tempo = tree({ v: 2, sport: "run", name: "Tempo", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } }] });
    const p = buildRunPlan(tempo, [1], OWNER, "indoor");
    // 98-102% of 10.62 km/h is 10.41 to 10.83 km/h.
    expect(runSummary(p, { 1: log(1200, 10.5) }, { beltEvents: true }).rows[0]).toMatchObject({ plan: "10.5 · Z4", done: "10.5", mark: null });
    expect(runSummary(p, { 1: log(1200, 10.1) }, { beltEvents: true }).rows[0].mark).toBe("↓");
    expect(runSummary(p, { 1: log(1200, 11.2) }, { beltEvents: true }).rows[0]).toMatchObject({ mark: "↑", markOn: "speed" });
  });

  it("with no belt taps says the distance is the plan's; with no numbers at all it is plan only", () => {
    const logs = ranLogs();
    for (const l of Object.values(logs)) Object.assign(l, { avgHr: null, rpe: null });
    const s = runSummary(plan, logs, { beltEvents: false });
    expect(s.distanceLine).toBe("Distance from the plan · no belt changes");
    expect(s.planOnly).toBe(true);
    expect(runSummary(plan, logs, { beltEvents: true }).planOnly).toBe(false);
  });

  it("with Drift from the stream the tiles are the mockup's six: Effort makes way", () => {
    const stream = {
      numbers: { seconds: 4500, gapSPerKm: null, intensityFactor: null, load: null, hrZoneMinutes: [10, 20, 0, 0, 0], drift: { pct: 3.2, steady: true, efFirst: 0.016, efSecond: 0.0155 }, onTarget: {}, timeOnTarget: null },
      chart: null,
    };
    const s = runSummary(plan, ranLogs(), { beltEvents: true, stream });
    expect(s.tiles.map((t) => t.label)).toEqual(["Time", "Distance", "Pace", "Avg HR", "Load", "Drift"]);
  });

  it("a run too short for a pace load, with a distance and no effort, asks only for the effort", () => {
    const s = runSummary(plan, { 100: log(80, 8.2, { rpe: null }) }, { beltEvents: true });
    expect(s.numbers.load).toBeNull();
    expect(s.noLoadReason).toBe("effort");
    const none = runSummary(plan, { 100: log(80, null, { rpe: null, avgHr: 130 }) }, { beltEvents: false });
    expect(none.noLoadReason).toBe("numbers");
  });

  it("outdoors shows the outdoor target and the pace run; with no LTHR no zone bar", () => {
    const out = buildRunPlan(BASE, ids, { run_threshold_pace: OWNER.run_threshold_pace }, "outdoor");
    const logs: Record<number, StepLog> = { 100: log(600, 8, { avgHr: 130 }) };
    const s = runSummary(out, logs, { beltEvents: false });
    expect(s.rows[0]).toMatchObject({ title: "Warm-up", done: "7:30 · HR 130" });
    expect(s.zones).toEqual([]);
    expect(s.footnote.startsWith("Pace /km · HR.")).toBe(true);
  });
});

describe("the brick line", () => {
  it("names the ride, T2 and the run; T2 only when it shows", () => {
    expect(brickText({ rideSeconds: 3600, t2Seconds: 72 }, 2400)).toBe("Brick · ride 60:00 · T2 1:12 · run 40:00");
    expect(brickText({ rideSeconds: 3600, t2Seconds: null }, 2400)).toBe("Brick · ride 60:00 · run 40:00");
  });
});

describe("step 4 review (2): a typed total over a skipped step that ran", () => {
  it("spreads over every step that ran, skipped ones too, so the pace is total time over total distance", () => {
    const three = tree({ v: 2, sport: "run", name: "Three", steps: [
      { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
      { type: "work", end: { type: "time", seconds: 1800 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
      { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
    ] });
    const p = buildRunPlan(three, [1, 2, 3], OWNER, "outdoor");
    const logs: Record<number, RunStepLog> = { 1: log(600, null), 2: log(720, null, { status: "skipped" }), 3: log(300, null) };
    const { steps } = runResultRows(p, logs);
    const saved = runResultPayloads(steps, {}, {}, "6", null, { sessionId: 1, exerciseId: 2, setNumbers: { 1: 1, 2: 2, 3: 3 } });
    const meters = Object.fromEntries(saved.map((x) => [x.programSetId, (x as { distanceMeters?: number }).distanceMeters]));
    expect(meters).toEqual({ 1: Math.round((6000 * 600) / 1620), 2: Math.round((6000 * 720) / 1620), 3: 6000 - Math.round((6000 * 600) / 1620) - Math.round((6000 * 720) / 1620) });
    expect(saved.find((x) => x.programSetId === 2)).toMatchObject({ stepStatus: "skipped", durationSeconds: 720 });
    for (const x of saved) Object.assign(logs[x.programSetId], { distanceMeters: (x as { distanceMeters: number }).distanceMeters, sources: { distanceMeters: "typed" } });
    const s = runSummary(p, logs, { beltEvents: false });
    // 27 min over 6 km.
    expect(s.tiles.find((x) => x.label === "Pace")?.value).toBe("4:30 /km");
    expect(s.numbers.load?.method).toBe("pace");
  });
});

describe("step 7: outdoors with Garmin's pace", () => {
  /** A 5 min rep at 98 to 102% of threshold pace (5:32 to 5:46 /km) with heart rate as its second line, then 5 min easy. */
  const REPS = tree({
    v: 2,
    sport: "run",
    name: "Reps",
    steps: [
      { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
      { type: "recovery", end: { type: "time", seconds: 300 } },
    ],
  });
  const out = buildRunPlan(REPS, [1, 2], OWNER, "outdoor");
  const garmin = (seconds: number, speed: number): RunStepLog => ({
    ...log(seconds, null),
    distanceMeters: Math.round(speed * seconds),
    avgSpeed: speed,
    avgHr: 172,
    sources: { durationSeconds: "clock", distanceMeters: "garmin", avgSpeed: "garmin", avgHr: "garmin" },
  });

  it("a rep faster than its pace range shows ↑, slower ↓, inside none; its heart rate line does not judge it", () => {
    const fast = runSummary(out, { 1: garmin(300, 1000 / 328), 2: garmin(300, 2) }, { beltEvents: false });
    // The arrow sits on the pace it judges, not after the heart rate.
    expect(fast.rows[0]).toMatchObject({ plan: "5:32-5:46", done: "5:27 · HR 172", mark: "↑", markOn: "speed" });
    const slow = runSummary(out, { 1: garmin(300, 1000 / 350), 2: garmin(300, 2) }, { beltEvents: false });
    expect(slow.rows[0].mark).toBe("↓");
    const inside = runSummary(out, { 1: garmin(300, 1000 / 340), 2: garmin(300, 2) }, { beltEvents: false });
    expect(inside.rows[0].mark).toBeNull();
  });
});

describe("heart rate caps use the zone edges (final review)", () => {
  it("the cap text and the arrow agree with runHrZoneOf at LTHR 180", async () => {
    const { runHrZoneOf } = await import("@/lib/utils/workout-steps");
    const { runZoneCapText } = await import("@/lib/utils/run-view");
    // Z1 ends where 85% starts (153), Z2 where 90% starts (162).
    expect([152, 153, 161, 162].map((bpm) => runHrZoneOf((bpm / 180) * 100))).toEqual([1, 2, 2, 3]);
    expect(runZoneCapText(1, OWNER)).toBe("HR under 153");
    expect(runZoneCapText(2, OWNER)).toBe("HR under 162");
    // The 50 min steady (Z2 cap): 161 is still Z2 and passes, 162 is Z3 and gets the up arrow.
    expect(runSummary(plan, { 101: log(3000, 8.2, { avgHr: 161 }) }, { beltEvents: true }).rows[1].mark).toBeNull();
    expect(runSummary(plan, { 101: log(3000, 8.2, { avgHr: 162 }) }, { beltEvents: true }).rows[1].mark).toBe("↑");
  });
});
