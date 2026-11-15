/**
 * Local demo accounts for the Plan tab (docs/plans/plan-tab-redesign.md).
 *
 * Makes three accounts that each show one state of the Plan tab:
 *   plan-gym@demo.local   rotation cycle in week 3, a scheduled draft, past and deleted cycles
 *   plan-goal@demo.local  a goal season (no race) whose first phase is the running rotation
 *   plan-race@demo.local  endurance on: a triathlon season, phase 1 running this week
 *   plan-edge@demo.local  endurance on: edge cases (long names, three sessions a day,
 *                         a season to re-plan, a paused season, missed key sessions)
 *   plan-edge2@demo.local a rotation with a skipped and a swapped position, long names
 *   plan-empty@demo.local no plan at all (first open)
 *
 * Dates are relative to the run day, so the states hold on later days; run it
 * again to move them. Each run deletes the demo accounts (and with them
 * all their data) and makes them again. No other account is touched.
 *
 * Writes go through the app's plan libraries (planWrite, activateCycle,
 * scheduleCycle, deleteCycles, createSeason, addPhase, applySessionOp,
 * writeLoggedSession) so versions, revisions and phase chaining match what
 * the app writes. The triathlon season is made by createTriathlonPlan, the
 * library behind the generateTriathlonPlan Server Action.
 *
 * Local databases only:
 *   docker exec logeverylift-app pnpm db:seed-plan-demo
 */

import { inArray } from "drizzle-orm";

const DEMO_PASSWORD = "plan-demo-password";
const GYM = "plan-gym@demo.local";
const GOAL = "plan-goal@demo.local";
const RACE = "plan-race@demo.local";
const EDGE = "plan-edge@demo.local";
const EDGE2 = "plan-edge2@demo.local";
const EMPTY = "plan-empty@demo.local";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
// Every demo user lives here. Dates and times are built in this zone, not the
// zone the script runs in, so a run near midnight matches what the app shows.
const DEMO_TZ = "Europe/Oslo";

function assertLocal() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run against database host "${host}": local hosts only`);
}

// Checked before the app modules load: src/db opens its pool on import.
assertLocal();

async function main() {
  const { auth } = await import("../src/lib/auth");
  const { db } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { LEGAL_VERSION } = await import("../src/lib/constants/legal");
  const rev = await import("../src/lib/plan-revisions");
  const seasonsLib = await import("../src/lib/seasons");
  const sessionsLib = await import("../src/lib/planned-sessions");
  const { saveAthleteProfile } = await import("../src/lib/athlete-profile");
  const { writeLoggedSession } = await import("../src/lib/logged-sessions");
  const { sessionCompliance } = await import("../src/lib/session-compliance");
  const { confirmDone, moveSuggestion } = await import("../src/lib/session-answers");
  const { mondayOf } = await import("../src/lib/utils/session-compliance");
  const { userToday } = await import("../src/lib/user-settings");
  const { instantInZone } = await import("../src/lib/utils/user-date");
  const { toDateStr } = await import("../src/lib/utils/cycle-position");
  const { addDaysStr } = await import("../src/lib/utils/seasons");
  const { createTriathlonPlan } = await import("../src/lib/triathlon-plan");
  const { and, eq, isNotNull, isNull } = await import("drizzle-orm");

  type Ctx = { userId: string; writer: "user" };
  type Lift = { name: string; sets: number; reps?: number; kg?: number; seconds?: number; zone?: number };

  // ── Accounts ──────────────────────────────────────────────────────────────

  const emails = [GYM, GOAL, RACE, EDGE, EDGE2, EMPTY];
  const old = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.email, emails));
  if (old.length) {
    const ids = old.map((u) => u.id);
    // Plan revisions have no FK to the user's plans; the rest cascades from the user.
    await db.delete(s.planRevisions).where(inArray(s.planRevisions.userId, ids));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    console.log(`Deleted ${old.length} old demo account(s)`);
  }

  async function makeUser(email: string, name: string, endurance: boolean): Promise<string> {
    // Called without headers, the admin plugin's createUser skips its session check (as create-e2e-user.ts).
    const res = await auth.api.createUser({ body: { name, email, password: DEMO_PASSWORD } });
    const id = res.user.id;
    await db
      .update(s.users)
      .set({
        tutorialDismissedAt: new Date(),
        termsVersion: LEGAL_VERSION,
        policySeenVersion: LEGAL_VERSION,
        termsAcceptedAt: new Date(),
        healthConsentAt: new Date(),
        timeZone: DEMO_TZ,
        enduranceEnabled: endurance,
      })
      .where(eq(s.users.id, id));
    return id;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  const exerciseIds = new Map(
    (await db.select({ id: s.exercises.id, name: s.exercises.name }).from(s.exercises).where(isNull(s.exercises.userId))).map((e) => [e.name, e.id]),
  );
  const exerciseId = (name: string) => {
    const id = exerciseIds.get(name);
    if (id == null) throw new Error(`Exercise "${name}" is not in the library. Run pnpm db:seed first.`);
    return id;
  };

  const UPPER_A: Lift[] = [
    { name: "Bench Press", sets: 4, reps: 8, kg: 90 },
    { name: "Barbell Row", sets: 4, reps: 8, kg: 70 },
    { name: "Overhead Press", sets: 3, reps: 10, kg: 45 },
    { name: "Lat Pulldown", sets: 3, reps: 12, kg: 60 },
    { name: "Dumbbell Curl", sets: 3, reps: 12, kg: 14 },
  ];
  const LOWER_A: Lift[] = [
    { name: "Squat", sets: 4, reps: 6, kg: 110 },
    { name: "Romanian Deadlift", sets: 3, reps: 8, kg: 90 },
    { name: "Leg Press", sets: 3, reps: 12, kg: 160 },
    { name: "Lying Leg Curl", sets: 3, reps: 12, kg: 40 },
    { name: "Calf Raise", sets: 3, reps: 15, kg: 60 },
  ];
  const UPPER_B: Lift[] = [
    { name: "Incline Bench Press", sets: 4, reps: 10, kg: 70 },
    { name: "Pull-up", sets: 4, reps: 8, kg: 0 },
    { name: "Dumbbell Shoulder Press", sets: 3, reps: 10, kg: 22 },
    { name: "Seated Cable Row", sets: 3, reps: 12, kg: 60 },
    { name: "Tricep Pushdown", sets: 3, reps: 12, kg: 30 },
  ];
  const LOWER_B: Lift[] = [
    { name: "Deadlift", sets: 3, reps: 5, kg: 140 },
    { name: "Front Squat", sets: 3, reps: 8, kg: 80 },
    { name: "Bulgarian Split Squat", sets: 3, reps: 10, kg: 20 },
    { name: "Leg Extension", sets: 3, reps: 12, kg: 50 },
    { name: "Hanging Leg Raise", sets: 3, reps: 12, kg: 0 },
  ];

  /** A program with its exercises and sets, as the app's program writes make it. */
  async function makeProgram(ctx: Ctx, name: string, lifts: Lift[]): Promise<number> {
    const { result } = await rev.planWrite(ctx, async (w) => {
      const [p] = await w.tx.insert(s.programs).values({ userId: ctx.userId, name }).returning({ id: s.programs.id });
      w.create({ type: "program", id: p.id });
      for (const [i, l] of lifts.entries()) {
        const [pe] = await w.tx
          .insert(s.programExercises)
          .values({ programId: p.id, exerciseId: exerciseId(l.name), orderIndex: i })
          .returning({ id: s.programExercises.id });
        await w.tx.insert(s.programSets).values(
          Array.from({ length: l.sets }, (_, n) => ({
            programExerciseId: pe.id,
            setNumber: n + 1,
            targetReps: l.reps ?? null,
            weightKg: l.kg != null ? String(l.kg) : null,
            durationSeconds: l.seconds ?? null,
            targetHeartRateZone: l.zone ?? null,
            restTimeSeconds: l.seconds != null ? 0 : 120,
          })),
        );
      }
      return p.id;
    });
    return result;
  }

  type SlotSpec = {
    dayOfWeek?: number;
    daySlot?: number;
    orderIndex?: number;
    programId: number | null;
    label?: string;
    priority?: "key" | "support" | "optional";
  };

  /** A draft cycle with its template slots, as manage_training_cycle create and edit_cycle_slot write it. */
  async function makeCycle(
    ctx: Ctx,
    name: string,
    weeks: number,
    scheduleType: "day_of_week" | "rotation",
    slots: SlotSpec[],
  ): Promise<number> {
    const { result: id } = await rev.planWrite(ctx, async (w) => {
      const [row] = await w.tx
        .insert(s.trainingCycles)
        .values({ userId: ctx.userId, name, durationWeeks: weeks, scheduleType, endAction: "none" })
        .returning({ id: s.trainingCycles.id });
      w.create({ type: "cycle", id: row.id });
      return row.id;
    });
    await addSlots(ctx, id, slots);
    return id;
  }

  async function addSlots(ctx: Ctx, cycleId: number, slots: SlotSpec[]) {
    await rev.planWrite(ctx, async (w) => {
      await w.touch({ type: "cycle", id: cycleId });
      for (const sl of slots) {
        await sessionsLib.upsertSlotInTx(
          w.tx,
          cycleId,
          { dayOfWeek: sl.dayOfWeek ?? null, orderIndex: sl.orderIndex ?? null, daySlot: sl.daySlot },
          { programId: sl.programId, label: sl.label ?? null, ...(sl.priority && { priority: sl.priority }) },
        );
      }
    });
  }

  /** Log a finished workout of a program, one set per planned set, through the app's log path. */
  async function logWorkout(userId: string, programId: number, lifts: Lift[], date: string, plannedSessionId: number | null = null) {
    await writeLoggedSession(userId, {
      date,
      start: instantInZone(date, 17, 0, DEMO_TZ),
      programId,
      plannedSessionId,
      durationMinutes: 60,
      feeling: "Good",
      source: "app",
      sets: lifts.flatMap((l) =>
        Array.from({ length: l.sets }, (_, n) => ({ exerciseId: exerciseId(l.name), setNumber: n + 1, reps: l.reps, weightKg: l.kg, rir: 2 })),
      ),
    });
  }

  /**
   * Log the rotation Upper A, Lower A, Rest, Upper B, Lower B from `start` up
   * to yesterday, with a few missed days, so that yesterday was Upper A and
   * today is Lower A. The walk repeats a missed session the next day, and each
   * day advances one position unless it is missed, so the misses needed are
   * (days - 1) mod 5.
   */
  async function logRotation(userId: string, start: string, today: string, order: { programId: number | null; lifts: Lift[] }[]) {
    let days = 0;
    while (addDaysStr(start, days) < today) days++;
    let missesLeft = (((days - 1) % order.length) + order.length) % order.length;
    let nextMissAt = 2;
    let position = 0;
    for (let i = 0; i < days; i++) {
      const slot = order[position % order.length];
      const date = addDaysStr(start, i);
      if (slot.programId == null) {
        position++;
        continue;
      }
      if (missesLeft > 0 && i >= nextMissAt && i < days - 1) {
        missesLeft--;
        nextMissAt = i + 3;
        continue;
      }
      await logWorkout(userId, slot.programId, slot.lifts, date);
      position++;
    }
    if (missesLeft > 0 || position % order.length !== 1) throw new Error("Rotation walk did not land on Lower A");
  }

  const rotationOrder = (ua: number, la: number, ub: number, lb: number) => [
    { programId: ua, lifts: UPPER_A },
    { programId: la, lifts: LOWER_A },
    { programId: null, lifts: [] },
    { programId: ub, lifts: UPPER_B },
    { programId: lb, lifts: LOWER_B },
  ];
  const rotationSlots = (ua: number, la: number, ub: number, lb: number): SlotSpec[] => [
    { orderIndex: 1, programId: ua },
    { orderIndex: 2, programId: la },
    { orderIndex: 3, programId: null, label: "Rest" },
    { orderIndex: 4, programId: ub },
    { orderIndex: 5, programId: lb },
  ];
  const weekdaySlots = (ua: number, la: number, ub: number, lb: number): SlotSpec[] => [
    { dayOfWeek: 1, programId: ua },
    { dayOfWeek: 2, programId: la },
    { dayOfWeek: 3, programId: null, label: "Rest" },
    { dayOfWeek: 4, programId: ub },
    { dayOfWeek: 5, programId: lb },
    { dayOfWeek: 6, programId: null, label: "Rest" },
    { dayOfWeek: 7, programId: null, label: "Rest" },
  ];

  async function liftPrograms(ctx: Ctx) {
    return {
      ua: await makeProgram(ctx, "Upper A", UPPER_A),
      la: await makeProgram(ctx, "Lower A", LOWER_A),
      ub: await makeProgram(ctx, "Upper B", UPPER_B),
      lb: await makeProgram(ctx, "Lower B", LOWER_B),
    };
  }

  // ── 1. Gym user, no season ────────────────────────────────────────────────

  {
    const userId = await makeUser(GYM, "Plan Gym Demo", false);
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    const p = await liftPrograms(ctx);

    // Today is day 15 of the rotation block: week 3 of 6.
    const ulStart = addDaysStr(today, -14);
    const fiveStart = addDaysStr(ulStart, -8 * 7);
    const introStart = addDaysStr(fiveStart, -7 - 4 * 7);

    const intro = await makeCycle(ctx, "Intro", 4, "day_of_week", weekdaySlots(p.ua, p.la, p.ub, p.lb));
    const five = await makeCycle(ctx, "Strength 5×5", 8, "day_of_week", weekdaySlots(p.ua, p.la, p.ub, p.lb));
    const ul = await makeCycle(ctx, "Upper / Lower hypertrophy", 6, "rotation", rotationSlots(p.ua, p.la, p.ub, p.lb));
    // Each start completes the cycle before it.
    await rev.activateCycle(ctx, intro, undefined, introStart);
    await rev.activateCycle(ctx, five, undefined, fiveStart);
    await rev.activateCycle(ctx, ul, undefined, ulStart);
    await logRotation(userId, ulStart, today, rotationOrder(p.ua, p.la, p.ub, p.lb));

    const peak = await makeCycle(ctx, "Strength peak", 4, "day_of_week", weekdaySlots(p.ua, p.la, p.ub, p.lb));
    await rev.scheduleCycle(ctx, peak, addDaysStr(ulStart, 6 * 7));

    const gone = await makeCycle(ctx, "Push / Pull / Legs", 6, "day_of_week", weekdaySlots(p.ua, p.la, p.ub, p.lb));
    await rev.deleteCycles(ctx, [gone]);
    console.log(`${GYM}: rotation week 3 from ${ulStart}, Strength peak on ${addDaysStr(ulStart, 42)}`);
  }

  // ── 2. Gym user with a goal season ────────────────────────────────────────

  {
    const userId = await makeUser(GOAL, "Plan Goal Demo", false);
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    const p = await liftPrograms(ctx);

    const start = addDaysStr(today, -14);
    const pastStart = addDaysStr(start, -7 - 8 * 7);
    const past = await makeCycle(ctx, "Strength 5×5", 8, "day_of_week", weekdaySlots(p.ua, p.la, p.ub, p.lb));
    await rev.activateCycle(ctx, past, undefined, pastStart);

    // Phases 6 + 4 + 3 weeks from two weeks ago: the season ends in about 11 weeks.
    const { season } = await seasonsLib.createSeason(ctx, {
      name: "Bench 120 kg by February",
      goal: "Bench press 120 kg for one rep",
      startDate: start,
      endDate: addDaysStr(start, 13 * 7 - 1),
      nextGoal: "Hold it through the spring",
    });
    // Phase types are endurance only (PHASE_TYPE_OFF), so the phases have none.
    const ph1 = await seasonsLib.addPhase(ctx, season.id, { name: "Upper / Lower hypertrophy", scheduleType: "rotation", durationWeeks: 6 });
    await addSlots(ctx, ph1.cycleId, rotationSlots(p.ua, p.la, p.ub, p.lb));
    const ph2 = await seasonsLib.addPhase(ctx, season.id, { name: "Strength peak", scheduleType: "day_of_week", durationWeeks: 4 });
    await addSlots(ctx, ph2.cycleId, weekdaySlots(p.ua, p.la, p.ub, p.lb));
    const ph3 = await seasonsLib.addPhase(ctx, season.id, { name: "Peak and test", scheduleType: "day_of_week", durationWeeks: 3 });
    await addSlots(ctx, ph3.cycleId, weekdaySlots(p.ua, p.la, p.ub, p.lb));
    // Starting phase 1 completes the past cycle and chains phase 2.
    await rev.activateCycle(ctx, ph1.cycleId, undefined, start);
    await logRotation(userId, start, today, rotationOrder(p.ua, p.la, p.ub, p.lb));
    console.log(`${GOAL}: season ${start} to ${addDaysStr(start, 90)}`);
  }

  // ── 3. Endurance user with a triathlon season ─────────────────────────────

  {
    const userId = await makeUser(RACE, "Plan Race Demo", true);
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    await saveAthleteProfile(ctx, {
      enduranceLevel: "intermediate",
      // Every day: the plan keeps its recovery swim, a second past session to confirm.
      availableDays: [1, 2, 3, 4, 5, 6, 7],
      hoursPerWeek: 9,
      longestDayMinutes: 240,
      longDay: 7,
      strengthGoal: "keep_muscle",
      completeInterview: true,
    });

    // Phase 1 starts on this week's Monday when that is at least three days
    // ago, else on last week's, so this week has past days.
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const seasonStart = addDaysStr(today, dow - 1 >= 3 ? -(dow - 1) : -(dow - 1) - 7);

    const full = await makeProgram(ctx, "Full body", [
      { name: "Goblet Squat", sets: 3, reps: 10, kg: 24 },
      { name: "Push-up", sets: 3, reps: 12, kg: 0 },
      { name: "Dumbbell Row", sets: 3, reps: 10, kg: 22 },
      { name: "Plank", sets: 3, seconds: 45 },
    ]);
    const intro = await makeCycle(ctx, "Intro", 4, "day_of_week", [
      { dayOfWeek: 1, programId: full },
      { dayOfWeek: 4, programId: full },
    ]);
    await rev.activateCycle(ctx, intro, undefined, addDaysStr(seasonStart, -6 * 7));

    // "Make a triathlon plan" for this user, as the app writes it (createTriathlonPlan).
    const { seasonId } = await createTriathlonPlan(ctx, {
      name: "Jevnaker Half 2027",
      goal: "Finish the half in under 6 hours",
      startDate: seasonStart,
      race: { name: "Jevnaker Halv Full Distanse", raceDate: "2027-08-29", distance: "half" },
    });

    // Phase 1 runs from the season start; this completes Intro and chains phase 2.
    const [phase1] = await db
      .select({ id: s.trainingCycles.id })
      .from(s.trainingCycles)
      .where(and(eq(s.trainingCycles.seasonId, seasonId), eq(s.trainingCycles.phaseOrder, 1)));
    await rev.activateCycle(ctx, phase1.id, undefined, seasonStart);
    await sessionsLib.ensureCycleSessions(userId, phase1.id);

    // This week and next, as the hero reads them.
    const monday = addDaysStr(today, -(dow - 1));
    const rows = await sessionCompliance(userId, monday, addDaysStr(monday, 13), { cycleId: phase1.id });
    const thisWeek = rows.filter((r) => r.date <= addDaysStr(monday, 6));

    // Programs by the endurance exercises in them: strength ones have none.
    const disciplineRows = await db
      .select({ programId: s.programExercises.programId, name: s.exercises.name })
      .from(s.programExercises)
      .innerJoin(s.exercises, eq(s.exercises.id, s.programExercises.exerciseId))
      .where(and(inArray(s.programExercises.programId, rows.map((r) => r.programId!).filter((id) => id != null)), isNotNull(s.exercises.discipline)));
    const has = (r: { programId: number | null }, name?: string) =>
      disciplineRows.some((d) => d.programId === r.programId && (name == null || d.name === name));

    // The past strength sessions of this week were logged; the past endurance
    // ones were not, so they ask "Did you do it?".
    for (const r of thisWeek.filter((x) => x.date < today && x.programId != null && !has(x))) {
      const lifts = await db
        .select({ name: s.exercises.name })
        .from(s.programExercises)
        .innerJoin(s.exercises, eq(s.exercises.id, s.programExercises.exerciseId))
        .innerJoin(s.programSets, eq(s.programSets.programExerciseId, s.programExercises.id))
        .where(eq(s.programExercises.programId, r.programId!));
      const names = [...new Set(lifts.map((l) => l.name))];
      await logWorkout(userId, r.programId!, names.map((name) => ({ name, sets: lifts.filter((l) => l.name === name).length, reps: 8, kg: 20 })), r.date, r.id);
    }

    // A brick: a short run linked to this week's last bike session, today or later when there is one.
    const bikes = thisWeek.filter((r) => has(r, "Bike"));
    const ride = [...bikes].reverse().find((r) => r.date >= today) ?? bikes.at(-1);
    if (ride) {
      const brickRun = await makeProgram(ctx, "Brick run", [{ name: "Run", sets: 1, seconds: 20 * 60, zone: 3 }]);
      const { row: run } = await sessionsLib.applySessionOp(ctx, { op: "add", cycleId: phase1.id, date: ride.date, programId: brickRun, position: ride.position + 1, label: "Brick run" });
      await sessionsLib.applySessionOp(ctx, { op: "link_brick", id: run.id, brickParentId: ride.id });
    }

    // One future session skipped and one moved a day later (to a free day of its week when there is one).
    const future = rows.filter((r) => r.date > today && r.programId != null && r.date !== ride?.date);
    const skip = future[0];
    if (skip) await sessionsLib.applySessionOp(ctx, { op: "skip", id: skip.id, reason: "Work trip" });
    const move = future.find((r) => r.id !== skip?.id && r.date !== skip?.date && r.date !== future.at(-1)?.date);
    const used = new Set(rows.map((r) => r.date));
    const weekStart = move && move.date >= addDaysStr(monday, 7) ? addDaysStr(monday, 7) : monday;
    const moveTo = move
      ? ([0, 1, 2, 3, 4, 5, 6].map((d) => addDaysStr(weekStart, d)).find((d) => d > today && !used.has(d)) ?? addDaysStr(move.date, 1))
      : null;
    if (move && moveTo) await sessionsLib.applySessionOp(ctx, { op: "move", id: move.id, date: moveTo });
    console.log(`${RACE}: season from ${seasonStart}, skipped ${skip?.date ?? "none"}, moved ${move ? `${move.date} to ${moveTo}` : "none"}, brick ${ride?.date ?? "none"}`);
  }


  // ── 4. Edge cases, endurance on ───────────────────────────────────────────

  {
    const userId = await makeUser(EDGE, "Plan Edge Demo", true);
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    await saveAthleteProfile(ctx, {
      enduranceLevel: "intermediate",
      availableDays: [1, 2, 3, 4, 5, 6, 7],
      hoursPerWeek: 10,
      longestDayMinutes: 180,
      longDay: 6,
      strengthGoal: "keep_muscle",
      completeInterview: true,
    });
    const monday = mondayOf(today);
    const nextMonday = addDaysStr(monday, 7);
    // The running cycle started last week's Monday: last week and this week have past days.
    const blockStart = addDaysStr(monday, -7);

    const CORE: Lift[] = [
      { name: "Hanging Leg Raise", sets: 3, reps: 12, kg: 0 },
      { name: "Calf Raise", sets: 3, reps: 15, kg: 40 },
    ];
    const strength = await makeProgram(ctx, "Strength A with heavy compound lifts and a long accessory finisher", UPPER_A);
    const core = await makeProgram(ctx, "Core", CORE);
    const bikeIntervals = await makeProgram(ctx, "Bike intervals 5 × 6 min", [{ name: "Bike", sets: 5, seconds: 6 * 60, zone: 4 }]);
    const swim = await makeProgram(ctx, "Swim technique", [{ name: "Swim", sets: 1, seconds: 45 * 60, zone: 2 }]);
    const runEasy = await makeProgram(ctx, "Run easy", [{ name: "Run", sets: 1, seconds: 40 * 60, zone: 2 }]);
    const runTempo = await makeProgram(ctx, "Run tempo", [{ name: "Run", sets: 3, seconds: 10 * 60, zone: 4 }]);
    const ride = await makeProgram(ctx, "Easy ride", [{ name: "Bike", sets: 1, seconds: 60 * 60, zone: 2 }]);
    const liftsOf = new Map([
      [strength, UPPER_A],
      [core, CORE],
    ]);
    const keyIds = new Set([bikeIntervals, runTempo]);
    const simpleWeek: SlotSpec[] = [
      { dayOfWeek: 2, programId: runEasy },
      { dayOfWeek: 4, programId: strength },
      { dayOfWeek: 6, programId: ride },
    ];

    // A finished standalone block, then a season whose first phase ran until
    // the running cycle started: its chain is paused (Resume). The first phase
    // runs its whole 8 weeks and ends the day before the running block starts,
    // so the two never overlap.
    const pausedStart = addDaysStr(blockStart, -8 * 7);
    const spring = await makeCycle(ctx, "Spring run block", 4, "day_of_week", simpleWeek);
    await rev.activateCycle(ctx, spring, undefined, addDaysStr(pausedStart, -5 * 7));
    const { season: paused } = await seasonsLib.createSeason(ctx, {
      name: "Winter run base",
      goal: "Run 10 km easy without walking",
      startDate: pausedStart,
      endDate: addDaysStr(pausedStart, 19 * 7 - 1),
      nextGoal: null,
    });
    const pb1 = await seasonsLib.addPhase(ctx, paused.id, { name: "Aerobic base", scheduleType: "day_of_week", durationWeeks: 8, phaseType: "base" });
    await addSlots(ctx, pb1.cycleId, simpleWeek);
    const pb2 = await seasonsLib.addPhase(ctx, paused.id, { name: "Run build", scheduleType: "day_of_week", durationWeeks: 8, phaseType: "build" });
    await addSlots(ctx, pb2.cycleId, simpleWeek);
    await rev.activateCycle(ctx, pb1.cycleId, undefined, pausedStart);

    // The running weekday cycle: three sessions on Wednesday, a labelled day with no program, two key sessions.
    const running = await makeCycle(
      ctx,
      "Base block with three sessions on Wednesdays and a long easy ride every Saturday morning",
      6,
      "day_of_week",
      [
        { dayOfWeek: 1, programId: strength },
        { dayOfWeek: 2, programId: bikeIntervals, priority: "key" },
        { dayOfWeek: 3, daySlot: 1, programId: swim },
        { dayOfWeek: 3, daySlot: 2, programId: core },
        { dayOfWeek: 3, daySlot: 3, programId: runEasy },
        { dayOfWeek: 4, programId: runTempo, priority: "key" },
        { dayOfWeek: 5, programId: null, label: "Mobility, stretching and the long drive home" },
        { dayOfWeek: 6, programId: ride, priority: "support" },
        { dayOfWeek: 7, programId: null, label: "Rest" },
      ],
    );
    await rev.activateCycle(ctx, running, undefined, blockStart);
    await sessionsLib.ensureCycleSessions(userId, running);

    // A season with a long name whose A race moved two weeks: the re-plan banner, and the taper no longer ends on race day.
    const aStart = addDaysStr(nextMonday, 7 * 7);
    const raceDay = addDaysStr(aStart, 25 * 7 - 1);
    const { season: replan } = await seasonsLib.createSeason(ctx, {
      name: "Oslo Triathlon and the long build toward the Lanzarote half distance in early summer",
      goal: "Finish the half distance strong and run the whole half marathon",
      startDate: aStart,
      endDate: raceDay,
      nextGoal: null,
      race: { name: "Lanzarote Half Distance Triathlon presented by the island council", raceDate: raceDay, discipline: "triathlon", distance: "half", priority: "A" },
    });
    await seasonsLib.addPhase(ctx, replan.id, { name: "Base", scheduleType: "day_of_week", durationWeeks: 10, phaseType: "base" });
    await seasonsLib.addPhase(ctx, replan.id, { name: "Swim, intervals and long bricks on Sundays", scheduleType: "day_of_week", durationWeeks: 13, phaseType: "build" });
    await seasonsLib.addPhase(ctx, replan.id, { name: "Taper", scheduleType: "day_of_week", durationDays: 14, phaseType: "taper" });
    const replanDetail = await seasonsLib.getSeasonDetail(userId, replan.id);
    await seasonsLib.updateRace(ctx, replan.id, replanDetail!.races[0].id, { raceDate: addDaysStr(raceDay, 14) });

    // Drafts: one scheduled after the running block, one not started.
    const upkeep = await makeCycle(ctx, "Strength upkeep", 4, "day_of_week", simpleWeek);
    await rev.scheduleCycle(ctx, upkeep, addDaysStr(blockStart, 6 * 7));
    await makeCycle(ctx, "Hill strength, stairs and long walks before the mountain trip in March", 3, "day_of_week", simpleWeek);

    // Recently deleted: a cycle and a season.
    await rev.deleteCycles(ctx, [await makeCycle(ctx, "Old swim block", 4, "day_of_week", simpleWeek)]);
    const { season: oldSeason } = await seasonsLib.createSeason(ctx, {
      name: "Old goal season",
      goal: null,
      startDate: nextMonday,
      endDate: addDaysStr(nextMonday, 8 * 7 - 1),
      nextGoal: null,
    });
    await seasonsLib.deleteSeason(ctx, oldSeason.id);

    // Last week: all done but Saturday's ride (unconfirmed). This week: strength
    // done, key sessions missed, the swim unconfirmed, the rest done. Next week:
    // the bike skipped, the swim moved to Friday, the tempo run changed.
    const rows = await sessionsLib.listPlanned(userId, blockStart, addDaysStr(nextMonday, 6), running);
    const lastSaturday = addDaysStr(blockStart, 5);
    for (const r of rows.filter((x) => x.id != null && x.programId != null && x.date < today)) {
      const id = r.id!;
      const lifts = liftsOf.get(r.programId!);
      if (lifts) await logWorkout(userId, r.programId!, lifts, r.date, id);
      else if (r.date < monday) {
        if (r.date !== lastSaturday) await confirmDone(ctx, id, { durationSeconds: 45 * 60, rpe: 5 }, "app");
      } else if (keyIds.has(r.programId!)) await sessionsLib.applySessionOp(ctx, { op: "miss", id, reason: "Long day at work" });
      else if (r.programId !== swim) await confirmDone(ctx, id, { durationSeconds: 40 * 60, rpe: 4 }, "app");
    }
    const next = rows.filter((x) => x.id != null && x.date >= nextMonday);
    const nextOf = (pid: number) => next.find((x) => x.programId === pid);
    const skip = nextOf(bikeIntervals);
    if (skip) await sessionsLib.applySessionOp(ctx, { op: "skip", id: skip.id!, reason: "Work trip" });
    const moved = nextOf(swim);
    if (moved) await sessionsLib.applySessionOp(ctx, { op: "move", id: moved.id!, date: addDaysStr(nextMonday, 4) });
    const changed = nextOf(runTempo);
    if (changed) await sessionsLib.applySessionOp(ctx, { op: "change", id: changed.id!, label: "Hill repeats", notes: "Find a hill of about 6 percent. Walk down." });

    const week = await sessionCompliance(userId, monday, addDaysStr(monday, 6));
    const missed = [];
    for (const c of week.filter((x) => x.status === "missed")) missed.push(`${c.date} ${JSON.stringify(await moveSuggestion(userId, c, week))}`);
    console.log(`${EDGE}: block from ${blockStart}, re-plan race ${raceDay} moved 14 days, missed key ${missed.join(", ") || "none"}`);
  }

  // ── 5. Rotation with a skipped and a swapped position, gym only ───────────

  {
    const userId = await makeUser(EDGE2, "Plan Edge Two Demo", false);
    const ctx: Ctx = { userId, writer: "user" };
    const today = toDateStr(await userToday(userId));
    const ua = await makeProgram(ctx, "Upper body strength with a long accessory finisher", UPPER_A);
    const la = await makeProgram(ctx, "Lower body strength and single-leg work", LOWER_A);
    const ub = await makeProgram(ctx, "Upper B", UPPER_B);
    const lb = await makeProgram(ctx, "Lower B", LOWER_B);
    const express = await makeProgram(ctx, "Full body express", [...UPPER_A.slice(0, 2), ...LOWER_A.slice(0, 2)]);

    const start = addDaysStr(today, -11);
    const cycle = await makeCycle(ctx, "Upper / Lower rotation for the busy autumn weeks before the holidays", 4, "rotation", rotationSlots(ua, la, ub, lb));
    await rev.activateCycle(ctx, cycle, undefined, start);
    await logRotation(userId, start, today, rotationOrder(ua, la, ub, lb));

    const ahead = (await sessionsLib.listPlanned(userId, today, addDaysStr(today, 14), cycle)).filter(
      (v) => v.rotationPosition != null && v.date > today && v.programId != null,
    );
    if (ahead.length < 2) throw new Error("Rotation has too few sessions ahead");
    await sessionsLib.applyRotationOp(ctx, { op: "skip", cycleId: cycle, rotationPosition: ahead[0].rotationPosition!, reason: "Travel" });
    await sessionsLib.applyRotationOp(ctx, { op: "change", cycleId: cycle, rotationPosition: ahead[1].rotationPosition!, programId: express });
    console.log(`${EDGE2}: rotation from ${start}, skipped position ${ahead[0].rotationPosition}, swapped position ${ahead[1].rotationPosition}`);
  }

  // ── 6. No plan at all ─────────────────────────────────────────────────────

  await makeUser(EMPTY, "Plan Empty Demo", false);
  console.log(`${EMPTY}: no cycles, no seasons`);

  console.log("");
  console.log("Demo logins (password for all):", DEMO_PASSWORD);
  for (const e of emails) console.log(`  ${e}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-plan-demo] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
