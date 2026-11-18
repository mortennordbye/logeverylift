import {
  handUnlogs,
  fieldText,
  parseField,
  parseStepTime,
  resultFields,
  resultPayloads,
  resultSteps,
  rideSummary,
  type StepLog,
} from "@/lib/utils/ride-results";
import { buildRidePlan, type RidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The mockup ride (docs/plans/bike-ride-logger.md, 4.6): 5 steps once the last recovery is dropped. */
function mockup(): Workout {
  const p = parseWorkout({
    v: 2,
    sport: "bike",
    name: "Upper endurance 2 x 15",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 900 }, ramp: { anchor: "ftp", from: 55, to: 75 } },
      {
        type: "repeat",
        count: 2,
        steps: [
          { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 75, high: 81 } },
          { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
        ],
      },
      { type: "work", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 56, high: 75 } },
    ],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.workout;
}
const plan = (mode: "indoor" | "outdoor" = "indoor", ftp: number | null = 180): RidePlan =>
  buildRidePlan(mockup(), [1, 2, 3, 4, 5, 6], ftp ? { ftp, lthr_bike: 171 } : {}, mode);

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
  sources: { durationSeconds: "clock" },
  ...over,
});

/** Program sets 1, 2, 3, 4 and 6 are the five ridden steps (5 is the dropped last recovery). */
const IDS = [1, 2, 3, 4, 6];
const SECONDS = [900, 900, 300, 900, 900];
const WATTS = [124, 141, 92, 131, 118];
const filled = () => Object.fromEntries(IDS.map((id, i) => [id, log({ durationSeconds: SECONDS[i], avgPower: WATTS[i], rpe: 6 })]));
const ctx = { sessionId: 7, exerciseId: 3, setNumbers: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 } };

describe("resultFields", () => {
  it("indoors: never distance, speed or climbing", () => {
    const f = resultFields("indoor");
    expect([...f.main, ...f.more]).toEqual(["avgPower", "avgHr", "maxHr", "avgCadence"]);
  });
  it("outdoors: max HR, distance, speed and climbing under More numbers", () => {
    expect(resultFields("outdoor").more).toEqual(["maxHr", "distanceMeters", "avgSpeed", "climbM"]);
  });
});

describe("parsing typed numbers", () => {
  it("reads km, km/h and whole numbers; empty is null; nonsense is undefined", () => {
    expect(parseField("distanceMeters", "12,5")).toBe(12500);
    expect(parseField("avgSpeed", "36")).toBeCloseTo(10);
    expect(parseField("avgPower", " 141 ")).toBe(141);
    expect(parseField("avgPower", "")).toBeNull();
    expect(parseField("avgHr", "abc")).toBeUndefined();
    expect(parseField("avgHr", "400")).toBeUndefined();
    expect(fieldText("distanceMeters", 12500)).toBe("12.5");
    expect(fieldText("avgSpeed", 10)).toBe("36");
  });
  it("miles", () => {
    const mi = { distance: "mi" as const, swim: "m" as const };
    expect(parseField("distanceMeters", "1", mi)).toBe(1609);
    expect(fieldText("avgSpeed", 1609.344 / 3600, mi)).toBe("1");
  });
  it("step times: 1-2 digits are minutes, 3-4 digits are mmss, a dot or comma is a colon", () => {
    expect(parseStepTime("1530")).toBe(930);
    expect(parseStepTime("930")).toBe(570);
    expect(parseStepTime("5")).toBe(300);
    expect(parseStepTime("15.30")).toBe(930);
    expect(parseStepTime("15,30")).toBe(930);
    expect(parseStepTime("12345")).toBeUndefined();
    expect(parseStepTime("1575")).toBeUndefined();
  });

  it("step times: at most 4 x the planned time or 10 h, whichever is more", () => {
    expect(parseStepTime("10:00:00", 900)).toBe(36000);
    expect(parseStepTime("10:00:01", 900)).toBeUndefined();
    expect(parseStepTime("11:00:00", 3 * 3600)).toBe(39600);
    expect(parseStepTime("13:00:00", null)).toBeUndefined();
  });

  it("step times: mm:ss, h:mm:ss or minutes", () => {
    expect(parseStepTime("14:30")).toBe(870);
    expect(parseStepTime("1:05:00")).toBe(3900);
    expect(parseStepTime("15")).toBe(900);
    expect(parseStepTime("")).toBeNull();
    expect(parseStepTime("1:75")).toBeUndefined();
  });
});

describe("resultPayloads", () => {
  it("after a ride: sends only the changed fields, marked typed, and keeps the clock's time and status", () => {
    const logs = { 1: log({ status: "partial", durationSeconds: 500, targetOffsetW: 5 }), 2: log({ status: "skipped", durationSeconds: 0 }) };
    const steps = resultSteps(plan(), logs);
    const out = resultPayloads(steps, { 1: { avgPower: "124", avgHr: "" }, 2: { avgPower: "150" } }, null, ctx, false);
    // The skipped step and the steps not ridden take no numbers.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ programSetId: 1, durationSeconds: 500, stepStatus: "partial", targetOffsetW: 5, avgPower: 124, sources: { avgPower: "typed" } });
    expect(out[0]).not.toHaveProperty("avgHr");
    expect(out[0]).not.toHaveProperty("rpe");
    expect(out[0].sources).not.toHaveProperty("durationSeconds");
  });

  it("effort once per ride: a new effort goes on every ridden step", () => {
    const steps = resultSteps(plan(), filled());
    const out = resultPayloads(steps, {}, 7, ctx, false);
    expect(out.map((p) => p.programSetId)).toEqual(IDS);
    expect(out.every((p) => p.rpe === 7 && Object.keys(p.sources).length === 0)).toBe(true);
  });

  it("an effort taken away is sent as null", () => {
    const out = resultPayloads(resultSteps(plan(), filled()), {}, null, ctx, false);
    expect(out).toHaveLength(5);
    expect(out.every((p) => p.rpe === null)).toBe(true);
  });

  it("a value typed back as it shows (speed at one decimal) is no change", () => {
    const logs = filled();
    logs[1] = log({ avgPower: 124, rpe: 6, avgSpeed: 8.3 });
    expect(fieldText("avgSpeed", 8.3)).toBe("29.9");
    expect(resultPayloads(resultSteps(plan("outdoor"), logs), { 1: { avgSpeed: "29.9" } }, 6, ctx, false)).toEqual([]);
  });

  it("by hand: a cleared time un-logs a logged step; it is not saved", () => {
    const logs = { 1: log(), 2: log() };
    const steps = resultSteps(plan(), logs);
    expect(handUnlogs(steps, { 1: { time: "" }, 3: { time: "" }, 2: { time: "10:00" } })).toEqual([1]);
    expect(resultPayloads(steps, { 1: { time: "" } }, null, ctx, true).map((p) => p.programSetId)).not.toContain(1);
  });

  it("by hand: 1530 is 15:30", () => {
    const out = resultPayloads(resultSteps(plan(), {}), { 1: { time: "1530" } }, null, ctx, true);
    expect(out[0]).toMatchObject({ programSetId: 1, durationSeconds: 930 });
  });

  it("an unchanged table sends nothing", () => {
    expect(resultPayloads(resultSteps(plan(), filled()), { 1: { avgPower: "124" } }, 6, ctx, false)).toEqual([]);
  });

  it("a cleared value is sent as null with no source; a Garmin value the rider changes becomes typed", () => {
    const logs = { 1: log({ avgPower: 120, avgHr: 140, sources: { durationSeconds: "clock", avgPower: "garmin", avgHr: "typed" } }) };
    const out = resultPayloads(resultSteps(plan(), logs), { 1: { avgPower: "125", avgHr: "" } }, null, ctx, false);
    expect(out[0]).toMatchObject({ avgPower: 125, avgHr: null, sources: { avgPower: "typed" } });
    expect(out[0].sources).not.toHaveProperty("avgHr");
  });

  it("by hand: each step with a time saves as done with a typed time; the plan's time is the start", () => {
    const steps = resultSteps(plan(), {});
    const out = resultPayloads(steps, { 2: { time: "14:30", avgPower: "141" }, 3: { time: "" } }, 6, ctx, true);
    expect(out.map((p) => [p.programSetId, p.durationSeconds])).toEqual([
      [1, 900],
      [2, 870],
      [4, 900],
      [6, 900],
    ]);
    expect(out[1]).toMatchObject({ stepStatus: "done", isCompleted: true, avgPower: 141, rpe: 6, sources: { durationSeconds: "typed", avgPower: "typed" } });
  });
});

describe("rideSummary", () => {
  it("the mockup ride: tiles time, avg W, load est., kJ, effort; zones by step average", () => {
    const s = rideSummary(plan(), filled());
    expect(s.tiles).toEqual([
      { label: "Time", value: "65:00" },
      { label: "Avg W", value: "126" },
      { label: "Load", value: "54", est: true },
      { label: "kJ", value: "490" },
      { label: "Effort", value: "6" },
    ]);
    expect(s.zones).toEqual([
      { zone: 1, m: 5 },
      { zone: 2, m: 45 },
      { zone: 3, m: 15 },
    ]);
    expect(s.planOnly).toBe(false);
    expect(s.noLoad).toBe(false);
  });

  it("plan against done: ↓ only under the low end, no ↓ on an 'under' target", () => {
    const logs = filled();
    logs[4] = log({ avgPower: 131 });
    logs[3] = log({ durationSeconds: 300, avgPower: 92 });
    const rows = rideSummary(plan(), logs).rows;
    expect(rows.map((r) => [r.title, r.plan, r.done, r.under])).toEqual([
      ["Warm-up", "99 to 135", "124 W", false],
      ["Work · 1 of 2", "135-146", "141 W", false],
      ["Easy", "under 97", "92 W", false],
      ["Work · 2 of 2", "135-146", "131 W", true],
      ["Work", "101-135", "118 W", false],
    ]);
  });

  it("ended early: only the ridden steps count; the rest say Skipped or Not ridden", () => {
    const logs = { 1: log({ avgPower: 124 }), 2: log({ status: "skipped", durationSeconds: 4 }), 3: log({ status: "partial", durationSeconds: 120, avgPower: 90 }) };
    const s = rideSummary(plan(), logs);
    expect(s.numbers.seconds).toBe(1020);
    expect(s.rows.map((r) => r.done)).toEqual(["124 W", "Skipped", "90 W", "Not ridden", "Not ridden"]);
  });

  it("times only: Plan only, and no load", () => {
    const s = rideSummary(plan(), Object.fromEntries(IDS.map((id) => [id, log()])));
    expect(s.planOnly).toBe(true);
    expect(s.noLoad).toBe(true);
    expect(s.tiles.map((t) => t.label)).toEqual(["Time"]);
  });

  it("a load that rounds to 0 shows no Load tile", () => {
    const s = rideSummary(plan(), { 1: log({ durationSeconds: 8, avgPower: 128, rpe: 6 }) });
    expect(s.numbers.load?.value).toBeLessThan(0.5);
    expect(s.tiles.map((t) => t.label)).not.toContain("Load");
  });

  it("effort but no power: the effort load, marked est.", () => {
    const s = rideSummary(plan(), Object.fromEntries(IDS.map((id) => [id, log({ rpe: 5 })])));
    expect(s.planOnly).toBe(false);
    expect(s.tiles.find((t) => t.label === "Load")).toEqual({ label: "Load", value: `${Math.round(75 * 5 * 0.22)}`, est: true });
  });

  it("no FTP: avg W and kJ, the effort load, no zones, the plan in % FTP", () => {
    const s = rideSummary(plan("indoor", null), filled());
    expect(s.tiles.map((t) => t.label)).toEqual(["Time", "Avg W", "Load", "kJ", "Effort"]);
    expect(s.numbers.load?.method).toBe("effort");
    expect(s.zones).toEqual([]);
    expect(s.rows[1].plan).toBe("75-81% FTP");
    expect(s.rows.some((r) => r.under)).toBe(false);
  });

  it("outdoors: the heart rate target against the avg HR", () => {
    const logs = filled();
    logs[2] = log({ avgHr: 130 });
    const row = rideSummary(plan("outdoor"), logs).rows[1];
    expect(row.plan).toMatch(/bpm|HR/);
    expect(row.done).toBe("130 bpm");
    expect(row.under).toBe(true);
  });
});
