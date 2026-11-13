import {
  EASY_MAX_SECONDS,
  TAPER_NOTE,
  TEMPLATE_MONDAY,
  easyWorkout,
  hardAfterLowReadiness,
  heavyLegConflicts,
  heavyLegsBeforeKey,
  isHeavyLegSet,
  isStrengthSet,
  readinessFlag,
  readinessSwap,
  readinessWindow,
  remainingAfterOverride,
  strengthPerWeek,
  strengthWeeks,
  type LegSet,
  type PlacedGroup,
  type PlacedSession,
  type ReadinessDay,
} from "@/lib/utils/training-limits";
import { isHardWorkout, parseWorkout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/**
 * The placed-session rules of docs/plans/limits-strength-readiness.md:
 * heavy legs before a key session, strength per week by phase, the readiness
 * flag and its limit, and the readiness swap.
 */

const squat: LegSet = {
  category: "strength",
  discipline: null,
  bodyArea: "lower_body",
  movementPattern: "squat",
  equipment: "barbell",
  exerciseType: "compound",
  setType: "working",
  targetReps: 5,
  repRangeMax: null,
};

describe("isHeavyLegSet", () => {
  it("counts loaded squats and hinges, the deadlift and lower-body jumps", () => {
    expect(isHeavyLegSet(squat)).toBe(true);
    expect(isHeavyLegSet({ ...squat, movementPattern: "hinge", equipment: "dumbbell" })).toBe(true);
    expect(isHeavyLegSet({ ...squat, bodyArea: "full_body", movementPattern: "hinge" })).toBe(true);
    expect(isHeavyLegSet({ ...squat, equipment: "bodyweight", exerciseType: "plyometric" })).toBe(true);
    expect(isHeavyLegSet({ ...squat, targetReps: null, repRangeMax: null })).toBe(true);
    expect(isHeavyLegSet({ ...squat, repRangeMax: 12 })).toBe(true);
  });

  it("does not count bridges, curls, calf raises, light sets, warm-ups or endurance sets", () => {
    expect(isHeavyLegSet({ ...squat, movementPattern: "hinge", equipment: "bodyweight" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, movementPattern: "pull", equipment: "machine" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, movementPattern: "push", equipment: "machine" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, equipment: "bands" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, targetReps: 15 })).toBe(false);
    expect(isHeavyLegSet({ ...squat, targetReps: 5, repRangeMax: 15 })).toBe(false);
    expect(isHeavyLegSet({ ...squat, setType: "warmup" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, bodyArea: "upper_body", movementPattern: "push" })).toBe(false);
    expect(isHeavyLegSet({ ...squat, category: "cardio", discipline: "run" })).toBe(false);
  });

  it("tells strength sets from endurance and warm-up sets", () => {
    expect(isStrengthSet(squat)).toBe(true);
    expect(isStrengthSet({ ...squat, setType: "warmup" })).toBe(false);
    expect(isStrengthSet({ ...squat, category: "cardio", discipline: "run" })).toBe(false);
  });
});

let n = 0;
function session(p: Partial<PlacedSession> & { date: string }): PlacedSession {
  n++;
  return {
    ref: `p:${n}`,
    label: `S${n}`,
    position: 1,
    sport: null,
    hard: false,
    plannedDurationS: null,
    storedPriority: null,
    heavyLegSets: 0,
    strengthSets: 0,
    cycleId: 1,
    ...p,
  };
}
const legDay = (date: string, extra: Partial<PlacedSession> = {}) => session({ date, label: "Leg day", heavyLegSets: 4, strengthSets: 6, ...extra });
const keyRun = (date: string, extra: Partial<PlacedSession> = {}) => session({ date, label: "Long run", sport: "run", storedPriority: "key", plannedDurationS: 6000, ...extra });

function dated(sessions: PlacedSession[], from = "2027-05-10", to = "2027-05-30", cycles: PlacedGroup["cycles"] = { 1: { name: "Build 1", phaseType: "build", blockStart: "2027-05-10", blockEnd: "2027-06-06" } }): PlacedGroup {
  return { loop: false, from, to, sessions, cycles };
}
const one = (g: PlacedGroup) => new Map([["c:1", g]]);

describe("heavyLegConflicts", () => {
  it("flags a lift 1 or 2 days before a key run, not 3", () => {
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11")]))).toHaveLength(1);
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-12")]))[0].days).toBe(2);
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-13")]))).toHaveLength(0);
  });

  it("on the same day, flags a lift before the key session only", () => {
    expect(heavyLegConflicts(dated([legDay("2027-05-11", { position: 1 }), keyRun("2027-05-11", { position: 2 })]))).toHaveLength(1);
    expect(heavyLegConflicts(dated([keyRun("2027-05-11", { position: 1 }), legDay("2027-05-11", { position: 2 })]))).toHaveLength(0);
  });

  it("ignores key swims, easy runs, light leg days and lifts after the key session", () => {
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11", { sport: "swim" })]))).toHaveLength(0);
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11", { storedPriority: "support" })]))).toHaveLength(0);
    expect(heavyLegConflicts(dated([legDay("2027-05-10", { heavyLegSets: 2 }), keyRun("2027-05-11")]))).toHaveLength(0);
    expect(heavyLegConflicts(dated([keyRun("2027-05-11"), legDay("2027-05-12")]))).toHaveLength(0);
  });

  it("reads a derived key session: a hard bike, or the week's longest run of 90 minutes or more", () => {
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11", { sport: "bike", storedPriority: null, hard: true, plannedDurationS: 3600 })]))).toHaveLength(1);
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11", { storedPriority: null, plannedDurationS: 5400 })]))).toHaveLength(1);
    expect(heavyLegConflicts(dated([legDay("2027-05-10"), keyRun("2027-05-11", { storedPriority: null, plannedDurationS: 3600 })]))).toHaveLength(0);
  });

  it("sees a Sunday lift before a Tuesday key run across weeks, but not a key session before the range", () => {
    expect(heavyLegConflicts(dated([legDay("2027-05-09"), keyRun("2027-05-11")]))).toHaveLength(1);
    expect(heavyLegConflicts(dated([legDay("2027-05-08"), keyRun("2027-05-09")]))).toHaveLength(0);
  });

  it("reads a template week as a loop: Sunday legs sit before Monday's key run", () => {
    const g: PlacedGroup = { loop: true, from: TEMPLATE_MONDAY, to: "2001-01-07", sessions: [keyRun("2001-01-01"), legDay("2001-01-07")], cycles: {} };
    const c = heavyLegConflicts(g);
    expect(c).toHaveLength(1);
    expect(c[0].days).toBe(1);
  });
});

describe("heavyLegsBeforeKey", () => {
  it("breaks only when the write adds a conflict, and names it", () => {
    const run = keyRun("2027-05-11");
    const lift = legDay("2027-05-13");
    const before = one(dated([run, lift]));
    const after = one(dated([run, { ...lift, date: "2027-05-10" }]));
    const hit = heavyLegsBeforeKey(before, after);
    expect(hit?.rule).toBe("heavy_legs_before_key");
    expect(hit?.message).toBe(
      '"Leg day" on Mon 2027-05-10 (4 heavy leg sets) is 1 day before the key session "Long run" on Tue 2027-05-11. No heavy legs within 48 h before a key run or ride; upper body is fine.',
    );
    expect(hit?.numbers).toMatchObject({ conflicts: [{ daysBefore: 1, keyDay: "2027-05-11" }] });
  });

  it("does not block an unrelated edit to a plan that already has a conflict", () => {
    const g = dated([legDay("2027-05-10"), keyRun("2027-05-11")]);
    expect(heavyLegsBeforeKey(one(g), one({ ...g, sessions: [...g.sessions, session({ date: "2027-05-14", sport: "swim" })] }))).toBeNull();
  });

  it("is overridden like the other rules", () => {
    const hit = heavyLegsBeforeKey(new Map(), one(dated([legDay("2027-05-10"), keyRun("2027-05-11")])))!;
    expect(remainingAfterOverride([hit], ["heavy_legs_before_key"]).remaining).toEqual([]);
  });
});

describe("strength per week", () => {
  const twoLifts = [legDay("2027-05-11"), legDay("2027-05-14")];

  it("counts full weeks of a phase cycle only, and sessions with 3 strength sets", () => {
    const weeks = strengthWeeks(
      dated([...twoLifts, session({ date: "2027-05-12", strengthSets: 2 }), legDay("2027-05-31")], "2027-05-10", "2027-06-02"),
    );
    expect([...weeks.values()].map((w) => [w.monday, w.count])).toEqual([
      ["2027-05-10", 2],
      ["2027-05-17", 0],
      ["2027-05-24", 0],
    ]);
  });

  it("leaves cycles without a phase type out", () => {
    const g = dated(twoLifts, "2027-05-10", "2027-05-30", { 1: { name: "Block", phaseType: null, blockStart: "2027-05-10", blockEnd: "2027-06-06" } });
    expect(strengthWeeks(g).size).toBe(0);
  });

  it("breaks when a week moves away from the default, in both directions", () => {
    const week = (s: PlacedSession[]) => one(dated(s, "2027-05-10", "2027-05-16"));
    // Build, get stronger: 1 a week.
    const hit = strengthPerWeek(week([twoLifts[0]]), week(twoLifts), "stronger");
    expect(hit?.message).toContain('Build phase "Build 1" would hold 2 strength sessions in the week of 2027-05-10 (Tue, Fri). The default for "Get stronger" in build is 1.');
    expect(hit?.numbers).toMatchObject({ sessions: 2, before: 1, default: 1 });
    expect(strengthPerWeek(week([twoLifts[0]]), week([]), "stronger")?.rule).toBe("strength_per_week");
    // Back toward the default is fine.
    expect(strengthPerWeek(week(twoLifts), week([twoLifts[0]]), "stronger")).toBeNull();
    // An unrelated edit to a week already off the default is fine.
    expect(strengthPerWeek(week(twoLifts), week(twoLifts), "stronger")).toBeNull();
  });

  it("holds a new week to the default, so transition takes no strength", () => {
    const g = (phaseType: string) => one(dated([twoLifts[0]], "2027-05-10", "2027-05-16", { 1: { name: "Off", phaseType, blockStart: "2027-05-10", blockEnd: "2027-05-30" } }));
    expect(strengthPerWeek(new Map(), g("transition"), "keep_muscle")?.numbers).toMatchObject({ default: 0, sessions: 1 });
    expect(strengthPerWeek(new Map(), g("peak"), "keep_muscle")).toBeNull();
  });

  it("checks a template week", () => {
    const g: PlacedGroup = {
      loop: true,
      from: TEMPLATE_MONDAY,
      to: "2001-01-07",
      sessions: [legDay("2001-01-02"), legDay("2001-01-05"), legDay("2001-01-07")],
      cycles: { 1: { name: "Base 1", phaseType: "base", blockStart: null, blockEnd: null } },
    };
    expect(strengthPerWeek(new Map(), new Map([["t:1", g]]), "keep_muscle")?.message).toContain('Base phase "Base 1" would hold 3 strength sessions a week (Tue, Fri, Sun). The default for "Keep muscle" in base is 2.');
  });
});

const day = (date: string, p: Partial<ReadinessDay> = {}): ReadinessDay => ({
  date,
  hrvMs: 45,
  hrvState: "fatigued",
  hrvMean7: 48,
  bandLow: 52,
  bandHigh: 68,
  rhrFlag: true,
  rhrMean7: 56,
  rhrBaseline: 50,
  ...p,
});

describe("readinessFlag", () => {
  const today = "2026-11-13";

  it("flags HRV low two days with resting HR up", () => {
    const f = readinessFlag([day("2026-11-12"), day(today)], today);
    expect(f?.day).toBe(today);
    expect(f?.text).toBe("HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50");
  });

  it("needs both signals and two days of low HRV", () => {
    expect(readinessFlag([day("2026-11-12", { hrvState: "balanced" }), day(today)], today)).toBeNull();
    expect(readinessFlag([day("2026-11-12"), day(today, { rhrFlag: false })], today)).toBeNull();
    expect(readinessFlag([day("2026-11-12"), day(today, { hrvState: "balanced" })], today)).toBeNull();
    expect(readinessFlag([day("2026-11-12"), day(today, { hrvState: "calibrating" })], today)).toBeNull();
    expect(readinessFlag([day(today)], today)).toBeNull();
  });

  it("reads yesterday when today has no reading yet, and nothing older", () => {
    expect(readinessFlag([day("2026-11-11"), day("2026-11-12"), day(today, { hrvMs: null })], today)?.day).toBe("2026-11-12");
    expect(readinessFlag([day("2026-11-10"), day("2026-11-11")], today)).toBeNull();
  });

  it("lets a fine reading today win over a flagged yesterday", () => {
    expect(readinessFlag([day("2026-11-11"), day("2026-11-12"), day(today, { hrvState: "balanced", rhrFlag: false })], today)).toBeNull();
  });

  it("keeps hard sessions off the flagged day and the next, from today", () => {
    expect(readinessWindow({ day: today }, today)).toEqual([today, "2026-11-14"]);
    expect(readinessWindow({ day: "2026-11-12" }, today)).toEqual([today]);
  });
});

describe("hardAfterLowReadiness", () => {
  const today = "2026-11-13";
  const flag = readinessFlag([day("2026-11-12"), day(today)], today)!;
  const g = (s: PlacedSession[]) => one(dated(s, "2026-11-09", "2026-11-22"));

  it("breaks when a write puts a hard session on the window", () => {
    const intervals = session({ date: "2026-11-16", label: "Intervals", sport: "run", hard: true });
    const hit = hardAfterLowReadiness(g([intervals]), g([{ ...intervals, date: "2026-11-14" }]), flag, today);
    expect(hit?.message).toBe(
      'Today (2026-11-13) is a low-readiness day: HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50. This change puts a hard session on 2026-11-14 ("Intervals"). Make the next intensity session easy (zone 1-2) or rest.',
    );
    expect(hit?.numbers).toMatchObject({ lowReadinessDay: today, rhrOver: 6 });
  });

  it("passes a hard session moved out of the window, or one outside it", () => {
    const intervals = session({ date: today, sport: "run", hard: true });
    expect(hardAfterLowReadiness(g([intervals]), g([{ ...intervals, date: "2026-11-16" }]), flag, today)).toBeNull();
    expect(hardAfterLowReadiness(g([]), g([session({ date: "2026-11-15", hard: true })]), flag, today)).toBeNull();
    expect(hardAfterLowReadiness(g([intervals]), g([intervals]), flag, today)).toBeNull();
  });
});

describe("readiness swap", () => {
  const today = "2026-11-13";
  const flag = readinessFlag([day("2026-11-12"), day(today)], today)!;
  const hardRun = { id: 7, label: "Threshold run", sport: "run" as const, hard: true, plannedDurationS: 50 * 60, done: false };

  it("suggests an easy version of today's first hard session", () => {
    const s = readinessSwap({ flag, today, taper: false, sessions: [{ ...hardRun, id: 6, hard: false, label: "Swim" }, hardRun] });
    expect(s?.sessionId).toBe(7);
    expect(s?.minutes).toBe(50);
    expect(s?.text).toBe(
      'Low readiness today: HRV 7-day mean 48 ms is below your band (52-68) for 2 days and resting HR is 6 bpm over your normal 50. Make "Threshold run" an easy 50 min zone 2 session?',
    );
  });

  it("adds the taper line in a taper", () => {
    expect(readinessSwap({ flag, today, taper: true, sessions: [hardRun] })?.text).toContain(TAPER_NOTE);
  });

  it("suggests nothing without a flag this morning, a hard session, or once it is done", () => {
    expect(readinessSwap({ flag: null, today, taper: false, sessions: [hardRun] })).toBeNull();
    expect(readinessSwap({ flag: { ...flag, day: "2026-11-12" }, today, taper: false, sessions: [hardRun] })).toBeNull();
    expect(readinessSwap({ flag, today, taper: false, sessions: [{ ...hardRun, hard: false }] })).toBeNull();
    expect(readinessSwap({ flag, today, taper: false, sessions: [{ ...hardRun, done: true }] })).toBeNull();
  });

  it("builds an easy workout that passes the schema and is not hard, at most 60 minutes", () => {
    for (const sport of ["swim", "bike", "run"] as const) {
      const w = easyWorkout(sport, 2 * 3600);
      const parsed = parseWorkout(w);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (parsed.ok) expect(isHardWorkout(parsed.workout)).toBe(false);
      expect(w.sport).toBe(sport);
      expect((w.steps[0] as { end: { seconds: number } }).end.seconds).toBe(EASY_MAX_SECONDS);
    }
    expect((easyWorkout("run", 40 * 60).steps[0] as { end: { seconds: number } }).end.seconds).toBe(40 * 60);
    expect((easyWorkout("run", null).steps[0] as { end: { seconds: number } }).end.seconds).toBe(EASY_MAX_SECONDS);
  });
});
