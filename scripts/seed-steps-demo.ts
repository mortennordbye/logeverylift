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
  const { eq, isNull, and } = await import("drizzle-orm");

  type Ctx = { userId: string; writer: "user" };

  const old = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.email, [TRI, LIFT]));
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
          .values({ programId: p.id, exerciseId: await sportExercise(part.exercise), orderIndex: i, progressionAdvance: "manual", poolLengthM: part.workout.poolLengthM ?? null })
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

  console.log(`Demo accounts ready (password "${DEMO_PASSWORD}"): ${TRI}, ${LIFT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
