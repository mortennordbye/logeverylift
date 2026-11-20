/**
 * Local demo accounts for structured endurance steps in programs
 * (docs/plans/one-program-model.md).
 *
 *   steps-tri@demo.local    endurance on, thresholds set. Programs with steps:
 *                           run intervals (today), a swim with send-offs
 *                           (tomorrow), a bike with power and an HR cap, and a
 *                           brick (ride then run, one program). Weekday cycle
 *                           from this Monday. Also a run with plain sets and
 *                           a long name, not in the cycle.
 *   steps-lift@demo.local   strength only: the same screens before and after,
 *                           to check nothing changed for a lifter.
 *   steps-ride@demo.local   endurance on, FTP 180 W and bike LTHR 171: the
 *                           ride of the bike ride logger mockups
 *                           (docs/plans/bike-ride-logger.md), today.
 *   steps-noftp@demo.local  the same ride with no thresholds set.
 *   steps-hand@demo.local   the same ride with FTP and LTHR, for "Log by hand"
 *                           (a ride logged without ride mode).
 *   steps-garmin@demo.local the same ride, ridden in ride mode and ended 10
 *                           min ago, with a synthetic Garmin activity (made
 *                           here, no real FIT file) that filled its steps:
 *                           the summary with stream numbers. Admin role, as
 *                           Garmin is for Premium (admin) accounts only.
 *   steps-ftp@demo.local    FTP 180 W: the app's 20 min FTP test, ridden in
 *                           ride mode and ended 10 min ago, the all-out step
 *                           typed at 196 W: the summary offers New FTP 186 W.
 *   steps-run@demo.local    endurance on, run threshold pace 5:39 /km and run
 *                           LTHR 180: "2 Base · Run" of the run logger
 *                           mockups (docs/plans/run-logger.md), today.
 *   steps-run-nopace@demo.local   the same run with run LTHR 180 only.
 *   steps-run-nolthr@demo.local   the same run with threshold pace 5:39 only.
 *   steps-run-pace@demo.local     pace 5:39 and LTHR 180: a run written in
 *                                 pace, today, for Road and Trail or snow.
 *   steps-runmode@demo.local      pace 5:39 and LTHR 180: a 5:25 treadmill run
 *                                 with a strides block, today, for run mode.
 *   steps-runout@demo.local       the same thresholds: a 400 m rep and 1 min
 *                                 easy, today, for run mode outdoors.
 *   steps-brick@demo.local        the same thresholds and FTP 200 W: a short
 *                                 ride today, then its run linked as a brick.
 *   steps-brick-live@demo.local   the same brick, for "End ride and start run".
 *   steps-rundone@demo.local      pace 5:39 and LTHR 180: "2 Base · Run" run on a
 *                                 treadmill and done 10 min ago, the steady
 *                                 step at 8.5 km/h by a belt tap, avg HR
 *                                 typed: the run summary and results table.
 *   steps-runearly@demo.local     the same thresholds: "Run · Tempo" run
 *                                 outdoors and ended early in the tempo, no
 *                                 numbers: plan only, the reason and Run again.
 *   steps-runbrick@demo.local     the same thresholds and FTP 200 W: the short
 *                                 brick ridden, then its run on a treadmill
 *                                 1:12 after the ride: the brick line.
 *   steps-rungarmin@demo.local    admin (Garmin is for Premium accounts): the
 *                                 rundone treadmill run, filled from a
 *                                 synthetic Garmin treadmill run (no real
 *                                 data): heart rate, cadence, drift, the chart.
 *   steps-rungarmin-out@demo.local admin: "Run · Tempo" run outdoors, filled
 *                                 from a synthetic Garmin run with GPS.
 *   steps-runpick@demo.local      admin: the same outdoor run with two
 *                                 synthetic Garmin runs that match it: Pick.
 *   steps-runtest@demo.local      pace 5:39 and LTHR 180: the treadmill run
 *                                 test run 10 min ago, the belt at 10.9 km/h
 *                                 from the test's first second, the 20 min
 *                                 typed at HR 176, effort 9: the summary offers
 *                                 New threshold pace 5:30 /km · LTHR 176. Also
 *                                 "Run · Tempo" in pace, for the belts after Save.
 *
 * Dates are relative to the run day. Each run deletes the demo accounts (and
 * with them all their data) and makes them again. No other account is touched.
 *
 * Local databases only:
 *   docker exec logeverylift-app pnpm db:seed-steps-demo
 */

import { inArray } from "drizzle-orm";
import type { Workout } from "../src/lib/utils/workout-steps";

const DEMO_PASSWORD = "steps-demo-password";
const TRI = "steps-tri@demo.local";
const LIFT = "steps-lift@demo.local";
const RIDE = "steps-ride@demo.local";
const NOFTP = "steps-noftp@demo.local";
const HAND = "steps-hand@demo.local";
const GARMIN = "steps-garmin@demo.local";
const FTP_TEST = "steps-ftp@demo.local";
const RUN = "steps-run@demo.local";
const RUN_NOPACE = "steps-run-nopace@demo.local";
const RUN_NOLTHR = "steps-run-nolthr@demo.local";
const RUN_PACE = "steps-run-pace@demo.local";
const RUN_MODE = "steps-runmode@demo.local";
const RUN_OUT = "steps-runout@demo.local";
const BRICK = "steps-brick@demo.local";
const BRICK_LIVE = "steps-brick-live@demo.local";
const RUN_DONE = "steps-rundone@demo.local";
const RUN_EARLY = "steps-runearly@demo.local";
const RUN_BRICK = "steps-runbrick@demo.local";
const RUN_GARMIN = "steps-rungarmin@demo.local";
const RUN_GARMIN_OUT = "steps-rungarmin-out@demo.local";
const RUN_PICK = "steps-runpick@demo.local";
const RUN_TEST = "steps-runtest@demo.local";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
const DEMO_TZ = "Europe/Oslo";

function assertLocal() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run against database host "${host}": local hosts only`);
}

assertLocal();

const RUN_INTERVALS: Workout = {
  v: 2,
  sport: "run",
  name: "Run · Threshold",
  steps: [
    { type: "warmup", end: { type: "distance", meters: 2000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 4,
      steps: [
        { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
        { type: "recovery", end: { type: "time", seconds: 120 }, target: { metric: "hr", anchor: "lthr", zone: 1 }, note: "easy jog" },
      ],
    },
    { type: "cooldown", end: { type: "distance", meters: 1500 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
  ],
};

const SWIM: Workout = {
  v: 2,
  sport: "swim",
  name: "Swim · CSS",
  poolLengthM: 25,
  steps: [
    { type: "warmup", end: { type: "distance", meters: 400 }, stroke: "choice" },
    { type: "repeat", count: 10, steps: [{ type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 105, stroke: "free", equipment: ["pull_buoy", "paddles"], target: { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 4 } }] },
    { type: "repeat", count: 4, steps: [{ type: "work", end: { type: "distance", meters: 50 }, stroke: "drill", note: "catch-up" }, { type: "rest", end: { type: "time", seconds: 15 } }] },
    { type: "cooldown", end: { type: "distance", meters: 200 }, stroke: "back" },
  ],
};

const BIKE: Workout = {
  v: 2,
  sport: "bike",
  name: "Bike · Sweet spot",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 55, high: 70 } },
    {
      type: "repeat",
      count: 3,
      steps: [
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 }, target2: { metric: "hr", anchor: "lthr", low: 80, high: 95 }, cadence: { low: 85, high: 95 } },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
      ],
    },
    { type: "cooldown", end: { type: "lap" }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 3 } },
  ],
};

/** The ride of the bike ride logger mockups: 65 min, planned IF 0.71 and load 55 at FTP 180. */
const UPPER_ENDURANCE: Workout = {
  v: 2,
  sport: "bike",
  name: "Bike · Upper endurance",
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
};

/** "2 Base · Run" of the run logger mockups: 75 min, the strides block and a walk to end. */
const BASE_RUN: Workout = {
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
};

/** A run written in pace: easy warm-up, a long tempo, 3 threshold reps, an easy cool-down. */
const PACE_RUN: Workout = {
  v: 2,
  sport: "run",
  name: "Run · Tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "pace", anchor: "threshold_pace", low: 75, high: 80 } },
    { type: "work", end: { type: "time", seconds: 1800 }, target: { metric: "pace", anchor: "threshold_pace", low: 88, high: 92 } },
    {
      type: "repeat",
      count: 3,
      steps: [
        { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
        { type: "recovery", end: { type: "time", seconds: 120 } },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "pace", anchor: "threshold_pace", low: 75, high: 80 } },
  ],
};

/** A treadmill run short enough to walk through in run mode: warm-up, steady, 2 strides, cool-down. */
const MODE_RUN: Workout = {
  v: 2,
  sport: "run",
  name: "Run mode demo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 25 }, target: { metric: "hr", anchor: "lthr", zone: 1 }, belt: 7.5, incline: 1 },
    { type: "work", end: { type: "time", seconds: 30 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        { type: "work", end: { type: "time", seconds: 15 }, target: { metric: "rpe", anchor: "absolute", low: 9, high: 9 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 20 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 3 }, belt: 7 },
      ],
    },
    { type: "work", end: { type: "time", seconds: 180 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    { type: "cooldown", end: { type: "time", seconds: 20 }, target: { metric: "rpe", anchor: "absolute", low: 1, high: 2 } },
  ],
};

/** One 400 m rep at threshold pace, then 1 min easy: an outdoor distance step that ends on its estimate or by Lap. */
const REP_RUN: Workout = {
  v: 2,
  sport: "run",
  name: "Run · 400 m",
  steps: [
    { type: "work", end: { type: "distance", meters: 400 }, target: { metric: "pace", anchor: "threshold_pace", low: 100, high: 100 } },
    { type: "recovery", end: { type: "time", seconds: 60 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 2 } },
  ],
};

/** The halves of a short brick: two ride steps, then a run with 10 min on effort. */
const SHORT_BRICK_RIDE: Workout = {
  v: 2,
  sport: "bike",
  name: "Brick ride",
  steps: [
    { type: "work", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", low: 70, high: 78 } },
    { type: "cooldown", end: { type: "time", seconds: 120 }, target: { metric: "power", anchor: "ftp", zone: 1 } },
  ],
};
const SHORT_BRICK_RUN: Workout = {
  v: 2,
  sport: "run",
  name: "Brick run",
  steps: [
    { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "hr", anchor: "lthr", zone: 3 } },
  ],
};

const BRICK_BIKE: Workout = { v: 2, sport: "bike", name: "Brick", steps: [{ type: "work", end: { type: "time", seconds: 3600 }, target: { metric: "power", anchor: "ftp", low: 70, high: 78 } }] };
const BRICK_RUN: Workout = { v: 2, sport: "run", name: "Brick", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "threshold_pace", low: 88, high: 92 } }] };

async function main() {
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { LEGAL_VERSION } = await import("../src/lib/constants/legal");
  const rev = await import("../src/lib/plan-revisions");
  const sessionsLib = await import("../src/lib/planned-sessions");
  const { userToday } = await import("../src/lib/user-settings");
  const { toDateStr } = await import("../src/lib/utils/cycle-position");
  const { addDaysStr, dowOf, mondayOf } = await import("../src/lib/utils/planned-sessions");
  const { workoutToRows } = await import("../src/lib/utils/program-steps");
  const { assertStepRows } = await import("../src/lib/program-steps-db");
  const { buildRidePlan } = await import("../src/lib/utils/ride-timeline");
  const { fillRidesFromGarmin } = await import("../src/lib/ride-garmin");
  const { allOutStep, ftpTestWorkout } = await import("../src/lib/utils/ftp-tests");
  const { buildRunPlan } = await import("../src/lib/utils/run-plan");
  const { runTestWorkout } = await import("../src/lib/utils/run-test");
  const { rideTimeline } = await import("../src/lib/utils/ride-timeline");
  const { beltResults } = await import("../src/lib/utils/run-screen");
  const { eq, isNull, and } = await import("drizzle-orm");

  type Ctx = { userId: string; writer: "user" };

  const old = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.email, [TRI, LIFT, RIDE, NOFTP, HAND, GARMIN, FTP_TEST, RUN, RUN_NOPACE, RUN_NOLTHR, RUN_PACE, RUN_MODE, RUN_OUT, BRICK, BRICK_LIVE, RUN_DONE, RUN_EARLY, RUN_BRICK, RUN_GARMIN, RUN_GARMIN_OUT, RUN_PICK, RUN_TEST]));
  if (old.length) {
    const ids = old.map((u) => u.id);
    await db.delete(s.planRevisions).where(inArray(s.planRevisions.userId, ids));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    console.log(`Deleted ${old.length} old demo account(s)`);
  }

  async function makeUser(email: string, name: string, endurance: boolean): Promise<string> {
    const res = await auth.api.createUser({ body: { name, email, password: DEMO_PASSWORD } });
    const id = res.user.id;
    await db
      .update(s.users)
      .set({ tutorialDismissedAt: new Date(), termsVersion: LEGAL_VERSION, policySeenVersion: LEGAL_VERSION, termsAcceptedAt: new Date(), healthConsentAt: new Date(), timeZone: DEMO_TZ, enduranceEnabled: endurance })
      .where(eq(s.users.id, id));
    return id;
  }

  const sportExercise = async (name: string) => {
    const [row] = await db.select({ id: s.exercises.id }).from(s.exercises).where(and(eq(s.exercises.name, name), isNull(s.exercises.userId)));
    if (!row) throw new Error(`Exercise "${name}" is not in the library. Run pnpm db:seed first.`);
    return row.id;
  };

  /** A program whose exercises hold steps, written as edit_program_exercise writes them. */
  async function stepProgram(ctx: Ctx, name: string, parts: { exercise: string; workout: Workout }[]): Promise<number> {
    const { result } = await rev.planWrite(ctx, async (w) => {
      const [p] = await w.tx.insert(s.programs).values({ userId: ctx.userId, name }).returning({ id: s.programs.id });
      w.create({ type: "program", id: p.id });
      for (const [i, part] of parts.entries()) {
        const [pe] = await w.tx
          .insert(s.programExercises)
          .values({ programId: p.id, exerciseId: await sportExercise(part.exercise), orderIndex: i, progressionAdvance: "manual", poolLengthM: part.workout.poolLengthM ?? null, rideTest: part.workout.test ?? null })
          .returning({ id: s.programExercises.id });
        await w.tx.insert(s.programSets).values(workoutToRows(part.workout).map((r) => ({ ...r, programExerciseId: pe.id, restTimeSeconds: 0 })));
        await assertStepRows(w.tx, pe.id);
      }
      return p.id;
    });
    return result;
  }

  async function strengthProgram(ctx: Ctx, name: string): Promise<number> {
    const lifts = [
      { name: "Bench Press", reps: 8, kg: 80 },
      { name: "Barbell Row", reps: 8, kg: 70 },
    ];
    const { result } = await rev.planWrite(ctx, async (w) => {
      const [p] = await w.tx.insert(s.programs).values({ userId: ctx.userId, name }).returning({ id: s.programs.id });
      w.create({ type: "program", id: p.id });
      for (const [i, l] of lifts.entries()) {
        const [pe] = await w.tx.insert(s.programExercises).values({ programId: p.id, exerciseId: await sportExercise(l.name), orderIndex: i }).returning({ id: s.programExercises.id });
        await w.tx.insert(s.programSets).values([1, 2, 3].map((n) => ({ programExerciseId: pe.id, setNumber: n, targetReps: l.reps, weightKg: String(l.kg), restTimeSeconds: 150, targetRir: 2 })));
      }
      return p.id;
    });
    return result;
  }

  async function weekdayCycle(ctx: Ctx, name: string, slots: { dayOfWeek: number; programId: number }[], start: string) {
    const { result: id } = await rev.planWrite(ctx, async (w) => {
      const [row] = await w.tx.insert(s.trainingCycles).values({ userId: ctx.userId, name, durationWeeks: 4, scheduleType: "day_of_week", endAction: "none" }).returning({ id: s.trainingCycles.id });
      w.create({ type: "cycle", id: row.id });
      return row.id;
    });
    await rev.planWrite(ctx, async (w) => {
      await w.touch({ type: "cycle", id });
      for (const sl of slots) await sessionsLib.upsertSlotInTx(w.tx, id, { dayOfWeek: sl.dayOfWeek, orderIndex: null, daySlot: 1 }, { programId: sl.programId, label: null });
    });
    await rev.activateCycle(ctx, id, undefined, start);
    await sessionsLib.ensureCycleSessions(ctx.userId, id);
  }

  // ── steps-tri ─────────────────────────────────────────────────────────────
  const tri = await makeUser(TRI, "Tri Demo", true);
  const triCtx: Ctx = { userId: tri, writer: "user" };
  const today = toDateStr(await userToday(tri));
  await db.insert(s.athleteThresholds).values([
    { userId: tri, kind: "run_threshold_pace", value: 1000 / 245, measuredOn: today, source: "manual" },
    { userId: tri, kind: "swim_css", value: 100 / 95, measuredOn: today, source: "manual" },
    { userId: tri, kind: "ftp", value: 260, measuredOn: today, source: "manual" },
    { userId: tri, kind: "lthr_run", value: 172, measuredOn: today, source: "manual" },
    { userId: tri, kind: "lthr_bike", value: 165, measuredOn: today, source: "manual" },
  ]);
  const run = await stepProgram(triCtx, "Run · Threshold", [{ exercise: "Run", workout: RUN_INTERVALS }]);
  const swim = await stepProgram(triCtx, "Swim · CSS", [{ exercise: "Swim", workout: SWIM }]);
  const bike = await stepProgram(triCtx, "Bike · Sweet spot", [{ exercise: "Bike", workout: BIKE }]);
  const brick = await stepProgram(triCtx, "Brick · Ride and run", [
    { exercise: "Bike", workout: BRICK_BIKE },
    { exercise: "Run", workout: BRICK_RUN },
  ]);
  // Plain sets, as programs made before steps hold them, with a long name for 320 px.
  await rev.planWrite(triCtx, async (w) => {
    const [p] = await w.tx.insert(s.programs).values({ userId: tri, name: "Long Sunday run along the river and back again" }).returning({ id: s.programs.id });
    w.create({ type: "program", id: p.id });
    const [pe] = await w.tx.insert(s.programExercises).values({ programId: p.id, exerciseId: await sportExercise("Run"), orderIndex: 0, progressionAdvance: "manual" }).returning({ id: s.programExercises.id });
    await w.tx.insert(s.programSets).values([
      { programExerciseId: pe.id, setNumber: 1, distanceMeters: 3000, targetHeartRateZone: 1, restTimeSeconds: 0 },
      { programExerciseId: pe.id, setNumber: 2, distanceMeters: 14000, targetHeartRateZone: 2, restTimeSeconds: 0 },
      { programExerciseId: pe.id, setNumber: 3, durationSeconds: 600, targetHeartRateZone: 1, restTimeSeconds: 0 },
    ]);
  });
  const dow = (d: string) => dowOf(d);
  await weekdayCycle(
    triCtx,
    "Build · Week 1",
    [
      { dayOfWeek: dow(today), programId: run },
      { dayOfWeek: dow(addDaysStr(today, 1)), programId: swim },
      { dayOfWeek: dow(addDaysStr(today, 2)), programId: bike },
      { dayOfWeek: dow(addDaysStr(today, 3)), programId: brick },
    ],
    mondayOf(today),
  );

  // ── steps-lift ────────────────────────────────────────────────────────────
  const lift = await makeUser(LIFT, "Lift Demo", false);
  const liftCtx: Ctx = { userId: lift, writer: "user" };
  const upper = await strengthProgram(liftCtx, "Upper A");
  await weekdayCycle(liftCtx, "Strength block", [{ dayOfWeek: dow(today), programId: upper }], mondayOf(today));

  // ── steps-ride, steps-noftp and steps-hand ────────────────────────────────
  for (const [email, name, thresholds] of [
    [RIDE, "Ride Demo", true],
    [NOFTP, "No FTP Demo", false],
    [HAND, "Hand Demo", true],
  ] as const) {
    const id = await makeUser(email, name, true);
    const ctx: Ctx = { userId: id, writer: "user" };
    if (thresholds) {
      await db.insert(s.athleteThresholds).values([
        { userId: id, kind: "ftp", value: 180, measuredOn: today, source: "manual" },
        { userId: id, kind: "lthr_bike", value: 171, measuredOn: today, source: "manual" },
      ]);
    }
    const ride = await stepProgram(ctx, UPPER_ENDURANCE.name, [{ exercise: "Bike", workout: UPPER_ENDURANCE }]);
    await weekdayCycle(ctx, "Base · Week 1", [{ dayOfWeek: dow(today), programId: ride }], mondayOf(today));
  }

  // ── steps-garmin: a ridden ride filled from a synthetic Garmin activity ───
  {
    const id = await makeUser(GARMIN, "Garmin Demo", true);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, id));
    const ctx: Ctx = { userId: id, writer: "user" };
    await db.insert(s.athleteThresholds).values([
      { userId: id, kind: "ftp", value: 180, measuredOn: today, source: "manual" },
      { userId: id, kind: "lthr_bike", value: 171, measuredOn: today, source: "manual" },
    ]);
    const programId = await stepProgram(ctx, UPPER_ENDURANCE.name, [{ exercise: "Bike", workout: UPPER_ENDURANCE }]);
    await weekdayCycle(ctx, "Base · Week 1", [{ dayOfWeek: dow(today), programId }], mondayOf(today));
    const [pe] = await db.select().from(s.programExercises).where(eq(s.programExercises.programId, programId));
    const sets = await db.select().from(s.programSets).where(eq(s.programSets.programExerciseId, pe.id)).orderBy(s.programSets.setNumber);
    const plan = buildRidePlan(UPPER_ENDURANCE, sets.map((x) => x.id), { ftp: 180, lthr_bike: 171 }, "indoor");
    const total = plan.steps.reduce((a, x) => a + (x.seconds ?? 0), 0);
    const end = new Date(Date.now() - 10 * 60_000);
    const start = new Date(end.getTime() - total * 1000);
    const [session] = await db
      .insert(s.workoutSessions)
      .values({ userId: id, programId, date: today, startTime: start, endTime: end, isCompleted: true, rideMode: "indoor" })
      .returning();
    const [ride] = await db
      .insert(s.rides)
      .values({ userId: id, sessionId: session.id, programExerciseId: pe.id, mode: "indoor", status: "finished", plan, seq: 1, startedAt: start, endedAt: end })
      .returning();
    await db.insert(s.rideEvents).values({ rideId: ride.id, seq: 1, clientId: "seed-start", kind: "start", at: start });
    for (const [n, st] of plan.steps.entries()) {
      await db.insert(s.workoutSets).values({
        sessionId: session.id, exerciseId: pe.exerciseId, programExerciseId: pe.id, programSetId: st.programSetId, setNumber: n + 1,
        actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: st.seconds, isCompleted: true, stepStatus: "done",
        targetOffsetW: 0, extendedSeconds: 0, rpe: 6, sources: { durationSeconds: "clock" },
      });
    }
    // Garmin's record: started with the ride, 1 s samples; power inside each step's target, heart rate rising slowly.
    const watts = [null, 141, 92, 131, 118];
    const t: number[] = [];
    const power: number[] = [];
    const hr: number[] = [];
    const cadence: number[] = [];
    let from = 0;
    for (const [k, st] of plan.steps.entries()) {
      for (let i = 0; i < st.seconds!; i++) {
        const at = from + i;
        const base = watts[k] ?? 99 + (36 * i) / st.seconds!;
        t.push(at);
        power.push(Math.round(base + 6 * Math.sin(at / 7) + ((at * 37) % 9) - 4));
        hr.push(Math.round(118 + Math.min(30, at / 60) + (base - 120) / 6 + Math.sin(at / 40)));
        cadence.push(88 + (at % 5));
      }
      from += st.seconds!;
    }
    const garminActivityId = 990000001;
    await db.insert(s.garminActivities).values({
      userId: id, garminActivityId, startTimeLocal: new Date(start.getTime() + 3600_000), activityType: "indoor_cycling",
      data: { activityId: garminActivityId, startTimeGMT: start.toISOString().slice(0, 19).replace("T", " "), activityType: { typeKey: "indoor_cycling" }, duration: total, elapsedDuration: total },
      filesFetchedAt: new Date(),
    });
    await db.insert(s.garminActivityStreams).values({
      userId: id, garminActivityId, parserVersion: 3, sport: "cycling", subSport: "indoor_cycling",
      streams: { t, power, hr, cadence }, laps: [], sets: [], timeInZone: [],
      session: { startTime: start.toISOString(), totalElapsedTime: total }, lengths: [], events: [],
    });
    const filled = await fillRidesFromGarmin(id);
    console.log(`steps-garmin: ${filled} ride filled from Garmin`);
  }

  // ── steps-ftp: a ridden 20 min FTP test with typed watts ──────────────────
  {
    const id = await makeUser(FTP_TEST, "FTP Demo", true);
    const ctx: Ctx = { userId: id, writer: "user" };
    await db.insert(s.athleteThresholds).values([
      { userId: id, kind: "ftp", value: 180, measuredOn: today, source: "manual" },
      { userId: id, kind: "lthr_bike", value: 171, measuredOn: today, source: "manual" },
    ]);
    const test = ftpTestWorkout("20min", "Bike · FTP test");
    const programId = await stepProgram(ctx, test.name, [{ exercise: "Bike", workout: test }]);
    await weekdayCycle(ctx, "Base · Week 1", [{ dayOfWeek: dow(today), programId }], mondayOf(today));
    const [pe] = await db.select().from(s.programExercises).where(eq(s.programExercises.programId, programId));
    const sets = await db.select().from(s.programSets).where(eq(s.programSets.programExerciseId, pe.id)).orderBy(s.programSets.setNumber);
    const plan = buildRidePlan(test, sets.map((x) => x.id), { ftp: 180, lthr_bike: 171 }, "indoor");
    const total = plan.steps.reduce((a, x) => a + (x.seconds ?? 0), 0);
    const end = new Date(Date.now() - 10 * 60_000);
    const start = new Date(end.getTime() - total * 1000);
    const [session] = await db
      .insert(s.workoutSessions)
      .values({ userId: id, programId, date: today, startTime: start, endTime: end, isCompleted: true, rideMode: "indoor" })
      .returning();
    const [ride] = await db
      .insert(s.rides)
      .values({ userId: id, sessionId: session.id, programExerciseId: pe.id, mode: "indoor", status: "finished", plan, seq: 1, startedAt: start, endedAt: end })
      .returning();
    await db.insert(s.rideEvents).values({ rideId: ride.id, seq: 1, clientId: "seed-start", kind: "start", at: start });
    const allOut = allOutStep(plan.steps)!;
    // Warm-up, two hard minutes, easy, the all-out 20 min at 196 W, cool-down.
    const watts = [125, 290, 95, 295, 100, 196, 105];
    for (const [n, st] of plan.steps.entries()) {
      await db.insert(s.workoutSets).values({
        sessionId: session.id, exerciseId: pe.exerciseId, programExerciseId: pe.id, programSetId: st.programSetId, setNumber: n + 1,
        actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: st.seconds, isCompleted: true, stepStatus: "done",
        targetOffsetW: 0, extendedSeconds: 0, rpe: 9, avgPower: st === allOut ? 196 : watts[n], sources: { durationSeconds: "clock", avgPower: "typed" },
      });
    }
  }

  // ── steps-run, steps-run-nopace and steps-run-nolthr ──────────────────────
  for (const [email, name, kinds, workout] of [
    [RUN, "Run Demo", ["run_threshold_pace", "lthr_run"], BASE_RUN],
    [RUN_NOPACE, "No Pace Demo", ["lthr_run"], BASE_RUN],
    [RUN_NOLTHR, "No LTHR Demo", ["run_threshold_pace"], BASE_RUN],
    [RUN_PACE, "Pace Demo", ["run_threshold_pace", "lthr_run"], PACE_RUN],
    [RUN_MODE, "Run Mode Demo", ["run_threshold_pace", "lthr_run"], MODE_RUN],
    [RUN_OUT, "Outdoor Run Demo", ["run_threshold_pace", "lthr_run"], REP_RUN],
  ] as const) {
    const id = await makeUser(email, name, true);
    const ctx: Ctx = { userId: id, writer: "user" };
    const value = { run_threshold_pace: 1000 / 339, lthr_run: 180 };
    await db.insert(s.athleteThresholds).values(kinds.map((kind) => ({ userId: id, kind, value: value[kind], measuredOn: today, source: "manual" as const })));
    const programId = await stepProgram(ctx, workout.name, [{ exercise: "Run", workout }]);
    await weekdayCycle(ctx, "Base · Week 1", [{ dayOfWeek: dow(today), programId }], mondayOf(today));
  }

  // ── steps-brick and steps-brick-live: today's ride, then its run as a brick ─
  for (const [email, name] of [
    [BRICK, "Brick Demo"],
    [BRICK_LIVE, "Brick Live Demo"],
  ] as const) {
    const id = await makeUser(email, name, true);
    const ctx: Ctx = { userId: id, writer: "user" };
    await db.insert(s.athleteThresholds).values([
      { userId: id, kind: "run_threshold_pace", value: 1000 / 339, measuredOn: today, source: "manual" },
      { userId: id, kind: "lthr_run", value: 180, measuredOn: today, source: "manual" },
      { userId: id, kind: "ftp", value: 200, measuredOn: today, source: "manual" },
    ]);
    const rideId = await stepProgram(ctx, SHORT_BRICK_RIDE.name, [{ exercise: "Bike", workout: SHORT_BRICK_RIDE }]);
    const runId = await stepProgram(ctx, SHORT_BRICK_RUN.name, [{ exercise: "Run", workout: SHORT_BRICK_RUN }]);
    await weekdayCycle(ctx, "Brick · Week 1", [{ dayOfWeek: dow(today), programId: rideId }], mondayOf(today));
    const [ridePlanned] = await db.select().from(s.plannedSessions).where(and(eq(s.plannedSessions.userId, id), eq(s.plannedSessions.date, today)));
    await db.insert(s.plannedSessions).values({ userId: id, cycleId: ridePlanned.cycleId, date: today, position: 2, programId: runId, brickParentId: ridePlanned.id });
  }

  // ── steps-rundone, steps-runearly and steps-runbrick: runs already run ──────
  const runThresholds = { run_threshold_pace: 1000 / 339, lthr_run: 180 };
  /**
   * A run of a program's run exercise, run as run mode runs it and saved as it
   * saves each step (docs/plans/run-logger.md, 4.7): `belts` are taps (seconds
   * into the run, km/h), `endAfter` ends it early, `hr` gives each step's typed
   * average heart rate.
   */
  async function ranRun(
    id: string,
    programId: number,
    workout: Workout,
    mode: "indoor" | "outdoor",
    o: { agoMin: number; belts?: { at: number; kmh: number }[]; endAfter?: number; hr?: (i: number) => number | null; rpe?: number; brickRideId?: number },
  ) {
    const [pe] = await db.select().from(s.programExercises).where(eq(s.programExercises.programId, programId));
    const sets = await db.select().from(s.programSets).where(eq(s.programSets.programExerciseId, pe.id)).orderBy(s.programSets.setNumber);
    const plan = buildRunPlan(workout, sets.map((x) => x.id), runThresholds, mode, { surface: "road" });
    const seconds = o.endAfter ?? plan.steps.reduce((a, x) => a + (x.seconds ?? 0), 0);
    const end = new Date(Date.now() - o.agoMin * 60_000);
    const start = new Date(end.getTime() - seconds * 1000);
    const at = (sec: number) => start.getTime() + sec * 1000;
    const [session] = await db.insert(s.workoutSessions).values({ userId: id, programId, date: today, startTime: start, endTime: end, isCompleted: true }).returning();
    // The step key a belt tap carries: the step that runs at that second.
    const keyAt = (sec: number) => {
      let t = 0;
      for (const st of plan.steps) {
        t += st.seconds ?? 0;
        if (sec < t) return st.key;
      }
      return plan.steps[plan.steps.length - 1].key;
    };
    type SeedEvent = { seq: number; kind: "start" | "belt" | "end"; at: number; value?: number; stepKey?: string };
    const events: SeedEvent[] = [
      { seq: 1, kind: "start", at: at(0) },
      ...(o.belts ?? []).map((b, k) => ({ seq: k + 2, kind: "belt" as const, at: at(b.at), value: Math.round(b.kmh * 10), stepKey: keyAt(b.at) })),
    ];
    if (o.endAfter !== undefined) events.push({ seq: events.length + 1, kind: "end", at: at(o.endAfter) });
    const [ride] = await db
      .insert(s.rides)
      .values({ userId: id, sessionId: session.id, programExerciseId: pe.id, sport: "run", mode, surface: mode === "outdoor" ? "road" : null, brickRideId: o.brickRideId ?? null, status: o.endAfter !== undefined ? "ended_early" : "finished", plan, seq: events.length, startedAt: start, endedAt: end })
      .returning();
    await db.insert(s.rideEvents).values(events.map((e) => ({ rideId: ride.id, seq: e.seq, clientId: `seed-${e.seq}`, kind: e.kind, at: new Date(e.at), value: e.value ?? null, stepKey: e.stepKey ?? null })));
    const t = rideTimeline(plan, events, end.getTime() + 1000);
    for (const [n, r] of t.steps.entries()) {
      const b = mode === "indoor" ? beltResults(r) : {};
      const hr = o.hr?.(r.index) ?? null;
      await db.insert(s.workoutSets).values({
        sessionId: session.id, exerciseId: pe.exerciseId, programExerciseId: pe.id, programSetId: r.programSetId, setNumber: n + 1,
        actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: r.activeSeconds, isCompleted: r.status !== "skipped", stepStatus: r.status,
        targetOffsetW: 0, extendedSeconds: 0, rpe: o.rpe ?? null, avgHr: hr, distanceMeters: b.distanceMeters ?? null, avgSpeed: b.avgSpeed ?? null, inclinePercent: b.inclinePercent ?? null,
        sources: { durationSeconds: "clock", ...(b.distanceMeters !== undefined && { distanceMeters: "belt", avgSpeed: "belt" }), ...(hr !== null && { avgHr: "typed" }) },
      });
    }
    return { ride, plan, steps: t.steps };
  }
  /**
   * A synthetic Garmin run over a ran run (docs/plans/run-logger.md, step 7):
   * 1 s samples from `lead` seconds before its start to its end, heart rate
   * and speed per step from `hr` and `speed` (step index, share of the step
   * run), cadence per foot as Garmin's FIT has it, GPS and altitude outdoors.
   * No real Garmin data.
   */
  async function garminRun(
    id: string,
    garminActivityId: number,
    typeKey: string,
    run: Awaited<ReturnType<typeof ranRun>>,
    o: { lead: number; gps: boolean; hr: (i: number, f: number) => number; speed: (i: number) => number },
  ) {
    const start = new Date(run.ride.startedAt.getTime() - o.lead * 1000);
    const t: number[] = [];
    const hr: number[] = [];
    const cadence: number[] = [];
    const distance: number[] = [];
    const altitude: number[] = [];
    const lat: number[] = [];
    const lng: number[] = [];
    let d = 0;
    const end = (run.steps[run.steps.length - 1].endedAt - start.getTime()) / 1000;
    for (let sec = 0; sec < end; sec++) {
      const ms = start.getTime() + sec * 1000;
      const r = run.steps.find((x) => ms >= x.startedAt && ms < x.endedAt);
      const i = r?.index ?? 0;
      const f = r ? (ms - r.startedAt) / (r.endedAt - r.startedAt) : 0;
      const v = r ? o.speed(i) : 1.4;
      d += v;
      t.push(sec);
      hr.push(Math.round((r ? o.hr(i, f) : 105) + Math.sin(sec / 23) * 2));
      cadence.push(r ? (v > 3.4 ? 92 : 84) + (sec % 3) - 1 : 70);
      distance.push(Math.round(d * 100) / 100);
      altitude.push(Math.round((60 + 8 * Math.sin(d / 900)) * 10) / 10);
      lat.push(59.92 + d / 111_320);
      lng.push(10.75);
    }
    const total = t.length;
    await db.insert(s.garminActivities).values({
      userId: id, garminActivityId, startTimeLocal: new Date(start.getTime() + 3600_000), activityType: typeKey,
      data: { activityId: garminActivityId, startTimeGMT: start.toISOString().slice(0, 19).replace("T", " "), activityType: { typeKey }, duration: total, elapsedDuration: total, distance: Math.round(d) },
      filesFetchedAt: new Date(),
    });
    await db.insert(s.garminActivityStreams).values({
      userId: id, garminActivityId, parserVersion: 4, sport: "running", subSport: o.gps ? "street" : "treadmill",
      streams: { t, hr, cadence, distance, ...(o.gps && { altitude, lat, lng }) }, laps: [], sets: [], timeInZone: [],
      session: { startTime: start.toISOString(), totalElapsedTime: total, firstRecordTime: start.toISOString() }, lengths: [], events: [],
    });
  }
  async function runAccount(email: string, name: string, workout: Workout, ftp = false) {
    const id = await makeUser(email, name, true);
    const ctx: Ctx = { userId: id, writer: "user" };
    await db.insert(s.athleteThresholds).values([
      { userId: id, kind: "run_threshold_pace", value: runThresholds.run_threshold_pace, measuredOn: today, source: "manual" },
      { userId: id, kind: "lthr_run", value: runThresholds.lthr_run, measuredOn: today, source: "manual" },
      ...(ftp ? [{ userId: id, kind: "ftp" as const, value: 200, measuredOn: today, source: "manual" as const }] : []),
    ]);
    const programId = await stepProgram(ctx, workout.name, [{ exercise: "Run", workout }]);
    await weekdayCycle(ctx, "Base · Week 1", [{ dayOfWeek: dow(today), programId }], mondayOf(today));
    return { id, ctx, programId };
  }
  {
    // The steady step at 8.5 km/h from its second minute; heart rate rising from 124 to 146, strides with none.
    const { id, programId } = await runAccount(RUN_DONE, "Run Done Demo", BASE_RUN);
    const hr = [124, 146, ...Array(12).fill(null), 118];
    await ranRun(id, programId, BASE_RUN, "indoor", { agoMin: 10, belts: [{ at: 660, kmh: 8.5 }], hr: (i) => hr[i], rpe: 6 });
  }
  {
    const { id, programId } = await runAccount(RUN_EARLY, "Run Early Demo", PACE_RUN);
    await ranRun(id, programId, PACE_RUN, "outdoor", { agoMin: 10, endAfter: 600 + 900 });
  }
  {
    const { id, ctx, programId: runProgram } = await runAccount(RUN_BRICK, "Run Brick Demo", SHORT_BRICK_RUN, true);
    const rideProgram = await stepProgram(ctx, SHORT_BRICK_RIDE.name, [{ exercise: "Bike", workout: SHORT_BRICK_RIDE }]);
    const [pe] = await db.select().from(s.programExercises).where(eq(s.programExercises.programId, rideProgram));
    const sets = await db.select().from(s.programSets).where(eq(s.programSets.programExerciseId, pe.id)).orderBy(s.programSets.setNumber);
    const plan = buildRidePlan(SHORT_BRICK_RIDE, sets.map((x) => x.id), { ftp: 200 }, "indoor");
    const runSeconds = SHORT_BRICK_RUN.steps.reduce((a, x) => a + (x.type !== "repeat" && x.end.type === "time" ? x.end.seconds : 0), 0);
    const rideEnd = new Date(Date.now() - (5 * 60 + runSeconds + 72) * 1000);
    const rideStart = new Date(rideEnd.getTime() - 420 * 1000);
    const [session] = await db.insert(s.workoutSessions).values({ userId: id, programId: rideProgram, date: today, startTime: rideStart, endTime: rideEnd, isCompleted: true, rideMode: "indoor" }).returning();
    const [ride] = await db.insert(s.rides).values({ userId: id, sessionId: session.id, programExerciseId: pe.id, mode: "indoor", status: "finished", plan, seq: 1, startedAt: rideStart, endedAt: rideEnd }).returning();
    await db.insert(s.rideEvents).values({ rideId: ride.id, seq: 1, clientId: "seed-start", kind: "start", at: rideStart });
    for (const [n, st] of plan.steps.entries()) {
      await db.insert(s.workoutSets).values({
        sessionId: session.id, exerciseId: pe.exerciseId, programExerciseId: pe.id, programSetId: st.programSetId, setNumber: n + 1,
        actualReps: 0, weightKg: "0", restTimeSeconds: 0, durationSeconds: st.seconds, isCompleted: true, stepStatus: "done", targetOffsetW: 0, extendedSeconds: 0, sources: { durationSeconds: "clock" },
      });
    }
    const hr = [150, 162];
    await ranRun(id, runProgram, SHORT_BRICK_RUN, "indoor", { agoMin: 5, belts: [{ at: 30, kmh: 9 }, { at: 620, kmh: 10 }], hr: (i) => hr[i], rpe: 7, brickRideId: ride.id });
  }

  {
    // The rundone run with a Garmin treadmill run: heart rate rising slowly in the steady step (drift under 5%), strides hard.
    const { id, programId } = await runAccount(RUN_GARMIN, "Run Garmin Demo", BASE_RUN);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, id));
    const run = await ranRun(id, programId, BASE_RUN, "indoor", { agoMin: 10, belts: [{ at: 660, kmh: 8.5 }], rpe: 6 });
    const hrOf = (i: number, f: number) => (i === 0 ? 118 + 10 * f : i === 1 ? 141 + 5 * f : i === 14 ? 128 - 6 * f : i % 2 === 0 ? 158 + 6 * f : 150 - 8 * f);
    await garminRun(id, 990000101, "treadmill_running", run, { lead: 15, gps: false, hr: hrOf, speed: () => 2.3 });
    const { fillRidesFromGarmin } = await import("../src/lib/ride-garmin");
    console.log(`steps-rungarmin: ${await fillRidesFromGarmin(id)} run filled from Garmin`);
  }
  {
    // The tempo outdoors with GPS: each step near its pace, the threshold reps a little fast.
    const { id, programId } = await runAccount(RUN_GARMIN_OUT, "Run Garmin Outdoor Demo", PACE_RUN);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, id));
    const run = await ranRun(id, programId, PACE_RUN, "outdoor", { agoMin: 10, rpe: 7 });
    const thr = runThresholds.run_threshold_pace;
    const speed = (i: number) => (i === 0 || i === 8 ? thr * 0.78 : i === 1 ? thr * 0.9 : i % 2 === 0 ? thr * 1.03 : thr * 0.65);
    const hr = (i: number, f: number) => (i === 0 ? 128 + 10 * f : i === 1 ? 158 + 6 * f : i === 8 ? 150 - 15 * f : i % 2 === 0 ? 168 + 8 * f : 160 - 15 * f);
    await garminRun(id, 990000102, "running", run, { lead: 5, gps: true, hr, speed });
    const { fillRidesFromGarmin } = await import("../src/lib/ride-garmin");
    console.log(`steps-rungarmin-out: ${await fillRidesFromGarmin(id)} run filled from Garmin`);
  }
  {
    // Two Garmin runs over the same outdoor run (the watch and a second recording): the runner picks one.
    const { id, programId } = await runAccount(RUN_PICK, "Run Pick Demo", PACE_RUN);
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, id));
    const run = await ranRun(id, programId, PACE_RUN, "outdoor", { agoMin: 10, rpe: 7 });
    const thr = runThresholds.run_threshold_pace;
    await garminRun(id, 990000103, "running", run, { lead: 5, gps: true, hr: () => 150, speed: () => thr * 0.85 });
    await garminRun(id, 990000104, "running", run, { lead: 60, gps: true, hr: () => 151, speed: () => thr * 0.84 });
  }

  {
    // The treadmill run test (docs/plans/run-logger.md, 4.10): the belt up to 10.9 km/h a second into the test, kept into the 20 min.
    const test = runTestWorkout("treadmill");
    const { id, ctx, programId } = await runAccount(RUN_TEST, "Run Test Demo", test);
    // The numbers before the test are a week old, so the saved test (dated the day it was run) becomes the current one.
    await db.update(s.athleteThresholds).set({ measuredOn: addDaysStr(today, -7) }).where(eq(s.athleteThresholds.userId, id));
    await stepProgram(ctx, PACE_RUN.name, [{ exercise: "Run", workout: PACE_RUN }]);
    await ranRun(id, programId, test, "indoor", { agoMin: 10, belts: [{ at: 901, kmh: 10.9 }], hr: (i) => (i === 7 ? 170 : i === 8 ? 176 : null), rpe: 9 });
  }

  console.log(`Demo accounts ready (password "${DEMO_PASSWORD}"): ${TRI}, ${LIFT}, ${RIDE}, ${NOFTP}, ${HAND}, ${GARMIN}, ${FTP_TEST}, ${RUN}, ${RUN_NOPACE}, ${RUN_NOLTHR}, ${RUN_PACE}, ${RUN_MODE}, ${RUN_OUT}, ${BRICK}, ${BRICK_LIVE}, ${RUN_DONE}, ${RUN_EARLY}, ${RUN_BRICK}, ${RUN_GARMIN}, ${RUN_GARMIN_OUT}, ${RUN_PICK}, ${RUN_TEST}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
