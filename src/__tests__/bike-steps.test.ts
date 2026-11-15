import { describe, expect, it } from "vitest";
import { groupWorkout } from "@/lib/utils/workout-group";
import {
  cadenceText,
  describeWorkout,
  estimateWorkout,
  hrZoneLabel,
  isHardWorkout,
  parseWorkout,
  pctFtpText,
  resolveTarget,
  resolveWorkout,
  targetLabel,
  type ResolvedStep,
  type ThresholdValues,
  type Workout,
  type WorkoutTarget,
  type ZoneSet,
} from "@/lib/utils/workout-steps";
import { APP_FTP, GARMIN_CYCLING_ZONES, LONG_RIDE_WORKOUT, LTHR_BIKE, TEMPO_WORKOUT } from "./fixtures/bike-sessions";

/** The step model of the bike build (docs/plans/bike-sessions.md, 4.1, 4.2 and 6). */

function parsed(input: unknown): Workout {
  const r = parseWorkout(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const tempo = parsed(TEMPO_WORKOUT);
const longRide = parsed(LONG_RIDE_WORKOUT);
const t = (x: object) => x as WorkoutTarget;
const bike = (target: object, thresholds: ThresholdValues = { ftp: APP_FTP }, zones: ZoneSet | null = GARMIN_CYCLING_ZONES) => resolveTarget(t(target), "bike", thresholds, undefined, zones);

describe("the tempo resolves to table 4.1 (FTP 180, Garmin CYCLING zones)", () => {
  const steps = resolveWorkout(tempo, { ftp: APP_FTP }, undefined, GARMIN_CYCLING_ZONES).steps as ResolvedStep[];

  it("gives watts and % FTP for every step", () => {
    expect(steps.map((s) => s.resolved?.text)).toEqual(["108-130 W", "135-144 W", "90-108 W", "135-144 W", "108-130 W"]);
    expect(steps.map((s) => pctFtpText(s.resolved?.forms ?? null))).toEqual(["60-72% FTP", "75-80% FTP", "50-60% FTP", "75-80% FTP", "60-72% FTP"]);
    expect(steps[1].resolved?.forms).toMatchObject({ watts: { low: 135, high: 144 }, pctFtp: { low: 75, high: 80 }, powerZone: 3, bpm: null, hrZone: null });
  });

  it("gives HR zone 3 as the Garmin band in bpm", () => {
    expect(steps[1].resolvedSecondary).toMatchObject({ low: 141, high: 160, text: "141-160 bpm", missing: null });
    expect(steps[1].resolvedSecondary?.forms).toMatchObject({ bpm: { low: 141, high: 160 }, hrZone: 3, hrZoneSource: "garmin", watts: null });
    expect(hrZoneLabel(steps[1].resolvedSecondary?.forms ?? null)).toBe("Garmin Z3");
  });

  it("gives the HR cap as under 140 bpm, in Garmin zone 2", () => {
    expect(steps[0].resolvedSecondary?.text).toBe("under 140 bpm");
    expect(steps[0].resolvedSecondary?.forms).toMatchObject({ bpm: { low: null, high: 140 }, hrZone: 2, hrZoneSource: "garmin" });
  });

  it("needs no LTHR when the zones come from Garmin", () => {
    expect(resolveWorkout(tempo, { ftp: APP_FTP }, undefined, GARMIN_CYCLING_ZONES).missingAnchors).toEqual([]);
    expect(resolveWorkout(tempo, { ftp: APP_FTP }).missingAnchors).toEqual(["lthr_bike"]);
  });

  it("has 30 min hard time in 65 min, though isHardWorkout says easy", () => {
    expect(estimateWorkout(tempo, { ftp: APP_FTP })).toMatchObject({ durationSeconds: 65 * 60, hardSeconds: 30 * 60 });
    expect(isHardWorkout(tempo, { ftp: APP_FTP })).toBe(false);
  });
});

describe("the long ride", () => {
  it("totals 135 min, with no hard time", () => {
    expect(estimateWorkout(longRide, { ftp: APP_FTP })).toMatchObject({ durationSeconds: 135 * 60, hardSeconds: 0 });
  });

  it("resolves Z2 HR and the one-sided cool-down", () => {
    const steps = resolveWorkout(longRide, { ftp: APP_FTP }, undefined, GARMIN_CYCLING_ZONES).steps;
    const steady = steps[1] as ResolvedStep;
    expect(steady.resolved?.text).toBe("110-130 W");
    expect(steady.resolvedSecondary?.text).toBe("121-140 bpm");
    const cooldown = steps[4] as ResolvedStep;
    expect(cooldown.resolved?.text).toBe("under 110 W");
    expect(pctFtpText(cooldown.resolved?.forms ?? null)).toBe("under 61% FTP");
    expect(cooldown.resolvedSecondary?.text).toBe("under 120 bpm");
    expect(cooldown.resolvedSecondary?.forms?.hrZone).toBe(1);
  });
});

describe("resolved forms", () => {
  it("an absolute watt target gets % FTP and a power zone when FTP is set", () => {
    expect(bike({ metric: "power", anchor: "absolute", low: 162, high: 180 }).forms).toMatchObject({ watts: { low: 162, high: 180 }, pctFtp: { low: 90, high: 100 }, powerZone: 4 });
    expect(bike({ metric: "power", anchor: "absolute", low: 162, high: 180 }, {}).forms).toMatchObject({ watts: { low: 162, high: 180 }, pctFtp: null, powerZone: null });
  });

  it("a power zone keeps its zone number", () => {
    expect(bike({ metric: "power", anchor: "ftp", zone: 2 }).forms).toMatchObject({ pctFtp: { low: 55, high: 74 }, powerZone: 2 });
  });

  it("one-sided power texts", () => {
    expect(bike({ metric: "power", anchor: "absolute", low: 110 }).text).toBe("110 W or more");
    expect(bike({ metric: "power", anchor: "ftp", low: 105 }).forms?.powerZone).toBe(5);
  });

  it("custom zones label as yours", () => {
    const custom: ZoneSet = { ...GARMIN_CYCLING_ZONES, source: "custom" };
    const r = bike({ metric: "hr", anchor: "lthr", zone: 2 }, {}, custom);
    expect(r.text).toBe("121-140 bpm");
    expect(hrZoneLabel(r.forms)).toBe("Your Z2");
  });

  it("an HR range in % LTHR gets its zone from the Garmin bands", () => {
    const r = bike({ metric: "hr", anchor: "lthr", low: 90, high: 93 }, { lthr_bike: LTHR_BIKE });
    expect(r.text).toBe("158-163 bpm");
    expect(hrZoneLabel(r.forms)).toBe("Garmin Z3");
  });

  it("with no zones, HR zones fall back to the % LTHR tables, labelled estimate", () => {
    const z = bike({ metric: "hr", anchor: "lthr", zone: 3 }, { lthr_bike: LTHR_BIKE }, null);
    expect(z.text).toBe("158-163 bpm");
    expect(z.forms).toMatchObject({ hrZone: 3, hrZoneSource: "estimate" });
    expect(hrZoneLabel(z.forms)).toBe("Z3 (estimate)");
    const abs = bike({ metric: "hr", anchor: "absolute", high: 140 }, { lthr_bike: LTHR_BIKE }, null);
    expect(abs.forms).toMatchObject({ hrZone: 1, hrZoneSource: "estimate" }); // 140 is 80% of 175
    expect(bike({ metric: "hr", anchor: "absolute", high: 140 }, {}, null).forms).toMatchObject({ bpm: { low: null, high: 140 }, hrZone: null, hrZoneSource: null });
  });

  it("Garmin zones are cycling zones: a run uses the run table", () => {
    const r = resolveTarget(t({ metric: "hr", anchor: "lthr", zone: 2 }), "run", { lthr_run: 170 }, undefined, GARMIN_CYCLING_ZONES);
    expect(r.text).toBe("145-151 bpm");
    expect(hrZoneLabel(r.forms)).toBe("Z2 (estimate)");
  });

  it("cadence and pace have forms with every field null", () => {
    const empty = { watts: null, pctFtp: null, powerZone: null, bpm: null, hrZone: null, hrZoneSource: null };
    expect(bike({ metric: "cadence", anchor: "absolute", low: 85, high: 95 }).forms).toEqual(empty);
    expect(resolveTarget(t({ metric: "pace", anchor: "threshold_pace", low: 85, high: 90 }), "run", { run_threshold_pace: 4 }).forms).toEqual(empty);
  });

  it("a missing anchor gives no forms", () => {
    expect(bike({ metric: "power", anchor: "ftp", low: 75, high: 80 }, {}).forms).toBeNull();
  });
});

describe("labels", () => {
  it("one-sided ranges read as under and or more", () => {
    expect(targetLabel(t({ metric: "hr", anchor: "absolute", high: 140 }), "bike")).toBe("HR under 140 bpm");
    expect(targetLabel(t({ metric: "hr", anchor: "absolute", low: 150 }), "bike")).toBe("HR 150 bpm or more");
    expect(targetLabel(t({ metric: "power", anchor: "ftp", high: 61 }), "bike")).toBe("under 61% FTP");
    expect(targetLabel(t({ metric: "power", anchor: "absolute", low: 110 }), "bike")).toBe("110 W or more");
    expect(targetLabel(t({ metric: "hr", anchor: "absolute", low: 140, high: 150 }), "bike")).toBe("140-150 bpm");
  });

  it("describeWorkout writes the one-sided cool-down", () => {
    expect(describeWorkout(longRide)).toMatch(/· 5 min cool-down under 61% FTP$/);
  });

  it("cadence text", () => {
    expect(cadenceText({ low: 85, high: 95 })).toBe("85-95 rpm");
    expect(cadenceText({ low: 90, high: 90 })).toBe("90 rpm");
  });
});

describe("one-sided targets and hard workouts", () => {
  const w = (target: object) => parsed({ v: 1, sport: "bike", name: "x", steps: [{ type: "work", end: { type: "time", seconds: 600 }, target }] });

  it("an under target is never hard; an or more target is read by its floor", () => {
    expect(isHardWorkout(w({ metric: "power", anchor: "ftp", high: 120 }))).toBe(false);
    expect(isHardWorkout(w({ metric: "power", anchor: "ftp", low: 95 }))).toBe(true);
    expect(isHardWorkout(w({ metric: "power", anchor: "absolute", low: 170 }), { ftp: APP_FTP })).toBe(true);
    expect(isHardWorkout(w({ metric: "power", anchor: "absolute", high: 300 }), { ftp: APP_FTP })).toBe(false);
  });
});

describe("groupWorkout", () => {
  it("splits the tempo into warm-up, main (work, recovery, work) and cool-down", () => {
    const groups = groupWorkout(tempo);
    expect(groups.map((g) => g.kind)).toEqual(["warmup", "main", "cooldown"]);
    expect(groups[1].nodes.map((n) => n.type)).toEqual(["work", "recovery", "work"]);
  });

  it("keeps a repeat in the main set", () => {
    expect(groupWorkout(longRide).map((g) => [g.kind, g.nodes.map((n) => n.type)])).toEqual([
      ["warmup", ["warmup"]],
      ["main", ["steady", "repeat", "steady"]],
      ["cooldown", ["cooldown"]],
    ]);
  });

  it("has no warm-up or cool-down group when the workout has none", () => {
    const work = { type: "work", end: { type: "time", seconds: 600 } };
    expect(groupWorkout(parsed({ v: 1, sport: "bike", name: "x", steps: [work] })).map((g) => g.kind)).toEqual(["main"]);
    const cool = { type: "cooldown", end: { type: "time", seconds: 600 } };
    expect(groupWorkout(parsed({ v: 1, sport: "bike", name: "x", steps: [work, cool, cool] })).map((g) => [g.kind, g.nodes.length])).toEqual([
      ["main", 1],
      ["cooldown", 2],
    ]);
  });
});
