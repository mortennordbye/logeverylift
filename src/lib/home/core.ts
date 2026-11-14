/**
 * The home screen's page-level data (docs/home-widgets-audit.md, 6.4).
 *
 * Every write the home makes runs here, at page level, before any Suspense
 * boundary: `getActiveCycleForUser` can start a scheduled block, end one and
 * write auto sessions, and the week read can make a cycle's sessions. The
 * completed-sessions read runs after them, so the week strip sees today's auto
 * session. Widget loaders only read, and take cycle data from `HomeCore`,
 * never by calling `getActiveCycleForUser` again.
 *
 * The values below are the ones the home page computed inline before the
 * widget system, moved unchanged.
 */

import { answerSession } from "@/components/features/answer-session";
import type { EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import { getPendingCheckin } from "@/lib/actions/ai-checkin";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { getCompletedSessions, getWorkoutInsight, getWorkoutStats } from "@/lib/actions/workout-sets";
import { needsPolicyNotice } from "@/lib/consent";
import { enduranceEnabledFor } from "@/lib/endurance";
import { homeWeekPlanned } from "@/lib/home-week";
import { listIllness } from "@/lib/illness";
import { distanceLabel } from "@/lib/planned-view";
import { readinessSwapFor } from "@/lib/readiness-swap";
import { homeEndurance } from "@/lib/session-answers";
import { sessionCompliance } from "@/lib/session-compliance";
import { getUserSettings, type UserSettings } from "@/lib/user-settings";
import { parseDateStr } from "@/lib/utils/cycle-position";
import type { requireSession } from "@/lib/utils/session";
import { weekDatesOf } from "@/lib/utils/user-date";
import { db } from "@/db";
import { exercises, programExercises, programSets, programs } from "@/db/schema";
import { todayPlanFrom } from "@/lib/home/today-plan";
import { liveProgramExercises, livePrograms, liveProgramSets } from "@/lib/plan-live";
import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

type Session = Awaited<ReturnType<typeof requireSession>>;
type CycleResult = Awaited<ReturnType<typeof getActiveCycleForUser>>;

/** The active cycle, once per request. Writes (see the file comment). */
export const activeCycle = cache(() => getActiveCycleForUser());

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's sessions with a structured workout (docs/plans/endurance-app.md, 4.1). */
async function enduranceToday(userId: string, today: string): Promise<EnduranceTodayRow[]> {
  const [sessions, { units }] = await Promise.all([sessionCompliance(userId, today, today), getUserSettings(userId)]);
  return sessions
    .filter((s) => s.workout && s.sport && s.status === "planned")
    .map((s) => {
      const a = answerSession(s);
      const parts = [
        s.planned.durationSeconds ? `${Math.round(s.planned.durationSeconds / 60)} min` : null,
        s.planned.distanceMeters ? distanceLabel(s.planned.distanceMeters, s.sport!, units) : null,
      ].filter(Boolean);
      return { id: s.id, name: a.name, sport: s.sport!, summary: a.summary, amount: parts.length ? parts.join(" · ") : null, done: s.state === "done" };
    });
}

/**
 * Today's program for the Today widget: its exercises and sets in one read,
 * filtered by the program's owner, deleted rows left out (owner decision A,
 * 2026-11-14).
 */
export async function readTodayPlan(userId: string, programId: number) {
  const rows = await db
    .select({
      programExerciseId: programExercises.id,
      name: exercises.name,
      setType: programSets.setType,
      targetReps: programSets.targetReps,
      repRangeMin: programSets.repRangeMin,
      repRangeMax: programSets.repRangeMax,
      weightKg: programSets.weightKg,
      durationSeconds: programSets.durationSeconds,
      distanceMeters: programSets.distanceMeters,
      restTimeSeconds: programSets.restTimeSeconds,
    })
    .from(programExercises)
    .innerJoin(programs, and(eq(programs.id, programExercises.programId), eq(programs.userId, userId), livePrograms))
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .leftJoin(programSets, and(eq(programSets.programExerciseId, programExercises.id), liveProgramSets))
    .where(and(eq(programExercises.programId, programId), liveProgramExercises))
    .orderBy(asc(programExercises.orderIndex), asc(programExercises.id), asc(programSets.setNumber));
  return todayPlanFrom(rows);
}

/**
 * The endurance part of home (docs/plans/workouts-and-compliance.md, 7): null
 * for a lifter, so their home renders nothing new. A failed read hides it.
 * `enabled` is the switch itself, for the widget audience.
 */
async function enduranceHome(userId: string, today: string) {
  if (!(await enduranceEnabledFor(userId))) return { enabled: false, home: null };
  try {
    const [home, todayRows] = await Promise.all([homeEndurance(userId), enduranceToday(userId, today)]);
    const info = home.returnInfo;
    const sick = info?.phase === "sick" ? ((await listIllness(userId)).find((p) => p.id === info.periodId) ?? null) : null;
    const swap = await readinessSwapFor(userId);
    return {
      enabled: true,
      home: {
        readinessSwap: swap ? { sessionId: swap.sessionId, label: swap.label, minutes: swap.minutes, text: swap.text, version: swap.version } : null,
        unconfirmed: home.unconfirmed.map(answerSession),
        missedKey: home.missedKey.map((m) => ({
          session: answerSession(m.session),
          moveTo: m.suggestion.date,
          reason: m.suggestion.date === null ? m.suggestion.reason : null,
        })),
        sick: sick ? { id: sick.id, startedOn: sick.startedOn } : null,
        returning: info?.phase === "returning" ? info.rule : null,
        today: todayRows,
      },
    };
  } catch (e) {
    console.error("[Home] endurance_read_failed", { error: e instanceof Error ? e.name : "unknown" });
    return { enabled: true, home: null };
  }
}

/**
 * Everything the home's core widgets and notices render from, read in one
 * pass. `settings` and `today` come from the page, which read them before the
 * cycle; `cycleResult` is the page's `activeCycle()`.
 */
export async function loadHomeCore(session: Session, settings: UserSettings, today: Date, cycleResult: CycleResult) {
  const todayStr = toDateStr(today);
  const weekDates = weekDatesOf(todayStr);
  // Sessions are matched to the week by their date below. The query filters
  // by start time, so start a day early: the user's Monday can begin on the
  // server's Sunday.
  const monday = parseDateStr(weekDates[0]);
  monday.setDate(monday.getDate() - 1);

  const info = cycleResult.success ? cycleResult.data : null;
  const todayProgram = info?.todaySlot?.program ?? null;

  const [statsResult, sessionsResult, insight, checkinResult, policyNotice, enduranceRead, todayPlan] = await Promise.all([
    getWorkoutStats(),
    getCompletedSessions(monday),
    todayProgram
      ? getWorkoutInsight(todayProgram.id, cycleResult).catch(() => undefined)
      : Promise.resolve(undefined),
    getPendingCheckin(),
    needsPolicyNotice(session),
    enduranceHome(session.user.id, todayStr),
    // A day with several sessions lists them instead (TodaySessionsList).
    todayProgram && (info?.todaySessions.length ?? 0) <= 1 ? readTodayPlan(session.user.id, todayProgram.id) : Promise.resolve(null),
  ]);
  const checkin = checkinResult.success ? checkinResult.data : null;
  const endurance = enduranceRead.home;

  const stats = statsResult.success
    ? statsResult.data
    : { totalWorkouts: 0, totalReps: 0, totalSets: 0, thisWeekWorkouts: 0 };
  const completedDates = new Set(
    sessionsResult.success ? sessionsResult.data.map((s) => s.date) : [],
  );

  // A day with several sessions (docs/plans/sessions.md, 5) lists them; a day
  // with one keeps the card exactly as it was.
  const todaySessions = info?.todaySessions ?? [];
  const severalToday = todaySessions.length > 1;
  const completedToday = severalToday ? todaySessions.every((s) => s.done) : completedDates.has(todayStr);
  // Today's session written by the cycle for a day tracked outside the app.
  const todayAutoSession =
    todayProgram && sessionsResult.success
      ? (sessionsResult.data.find(
          (s) => s.date === todayStr && s.source === "auto" && s.programId === todayProgram.id,
        ) ?? null)
      : null;

  const isRestDay = info !== null && info.todaySlot !== null && !todayProgram;

  // Rotation mode: if missedSlots is non-empty, today's slot is overdue.
  // Use the earliest miss date to compute "days overdue."
  const rotationOverdueDays =
    info?.cycle.scheduleType === "rotation" && info.missedSlots.length > 0
      ? Math.max(
          1,
          Math.floor(
            (today.getTime() -
              new Date(info.missedSlots[0].date + "T00:00:00").getTime()) /
              86400000,
          ),
        )
      : 0;

  // Day-of-week mode: missed workouts to surface as make-up prompts.
  const dowMissed =
    info?.cycle.scheduleType === "day_of_week" ? info.missedSlots : [];

  // This week's dated sessions, so a moved session shows on its new day and a
  // day with several shows how many. Outside the block the template shows, as before.
  // A failed read falls back to the template's week (review 5).
  const weekPlanned =
    info?.cycle.scheduleType === "day_of_week"
      ? await homeWeekPlanned(session.user.id, weekDates[0], weekDates[6], info.cycle.id)
      : [];

  const progressPct = info
    ? Math.min(((info.currentWeek - 1) / info.cycle.durationWeeks) * 100, 100)
    : 0;
  const endFormatted = info
    ? parseDateStr(info.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return {
    userId: session.user.id,
    today,
    todayStr,
    weekDates,
    info,
    todayProgram,
    todayPlan,
    stats,
    completedDates,
    todaySessions,
    severalToday,
    completedToday,
    todayAutoSession: todayAutoSession ? { id: todayAutoSession.id } : null,
    isRestDay,
    rotationOverdueDays,
    dowMissed,
    weekPlanned,
    progressPct,
    endFormatted,
    insight,
    checkin,
    policyNotice,
    endurance,
    enduranceEnabled: enduranceRead.enabled,
  };
}

export type HomeCore = Awaited<ReturnType<typeof loadHomeCore>>;

/** What a streamed widget's loader gets. Ids and primitives only; it reads, never writes. */
export type HomeContext = {
  userId: string;
  role: string | null;
  /** Today in the user's zone, YYYY-MM-DD. */
  today: string;
};
