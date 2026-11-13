/**
 * The readiness swap (package D4, docs/plans/limits-strength-readiness.md,
 * section 5): on a low-readiness morning (HRV below the band two days and
 * resting HR up, from Garmin), suggest making today's first hard session an
 * easy one. The app and the assistant read the same suggestion from here,
 * and apply it through here, which reads it again first: a client never
 * sends the workout. Nothing changes until the user taps or the assistant
 * writes.
 */

import { db } from "@/db";
import { plannedSessions, trainingCycles, workoutSessions } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveCycles, livePlannedSessions } from "@/lib/plan-live";
import { PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { applySessionOp } from "@/lib/planned-sessions";
import { sessionCompliance } from "@/lib/session-compliance";
import { NO_OVERRIDE, limitContext, readinessToday, type LimitOverride } from "@/lib/training-limits";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { readinessSwap, type ReadinessSwap } from "@/lib/utils/training-limits";
import { and, eq, inArray } from "drizzle-orm";

/** Today's readiness swap for this user, or null (switch off, no Garmin, no flag, no hard session left today). */
export async function readinessSwapFor(userId: string): Promise<ReadinessSwap | null> {
  if (!(await enduranceEnabledFor(userId))) return null;
  const today = toDateStr(await userToday(userId));
  const flag = await readinessToday(userId, today);
  if (!flag || flag.day !== today) return null;
  const all = (await sessionCompliance(userId, today, today)).filter((s) => s.date === today && s.status === "planned");
  // A session with a workout in progress is being trained now: leave it alone.
  const open = all.length
    ? await db
        .select({ id: workoutSessions.plannedSessionId })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.isCompleted, false), inArray(workoutSessions.plannedSessionId, all.map((s) => s.id))))
    : [];
  const inProgress = new Set(open.map((o) => o.id));
  const rows = all.filter((s) => !inProgress.has(s.id)).sort((a, b) => a.position - b.position);
  const sessions = rows.map((s) => ({
    id: s.id,
    label: s.label ?? s.programName ?? s.workout?.name ?? "Session",
    sport: s.sport,
    hard: s.hard,
    plannedDurationS: s.planned.durationSeconds ?? null,
    done: s.state === "done",
    version: s.version,
  }));
  const swap = readinessSwap({ flag, today, sessions, taper: false });
  if (!swap) return null;
  const cycleId = rows.find((s) => s.id === swap.sessionId)!.cycleId;
  const [cycle] = await db.select({ phaseType: trainingCycles.phaseType }).from(trainingCycles).where(and(eq(trainingCycles.id, cycleId), liveCycles));
  return cycle?.phaseType === "taper" ? readinessSwap({ flag, today, sessions, taper: true }) : swap;
}

/** The suggestion no longer holds for this session (the reading, the plan or the day changed). */
export const STALE_SWAP = "Readiness changed: there is no swap to make for this session now.";

/**
 * Make the session easy, as the suggestion says. The user's tap writes as
 * `apply` (T2, a wearable suggestion) with the limits as warnings (T4); the
 * assistant writes as `assistant` with the limits checked like any session
 * change. A revision of the session holds the program or workout before.
 */
export async function applyReadinessSwap(ctx: PlanWriteContext, sessionId: number, override: LimitOverride = NO_OVERRIDE, expectedVersion?: number) {
  const swap = await readinessSwapFor(ctx.userId);
  if (!swap || swap.sessionId !== sessionId) throw new PlanStateError(STALE_SWAP);
  const lc = await limitContext(ctx.userId);
  // A stored key priority goes with the hard content, so the easy session is
  // not read as key (heavy legs); a brick keeps its link (review nit).
  const [row] = await db
    .select({ priority: plannedSessions.priority, programId: plannedSessions.programId, workout: plannedSessions.workout })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, sessionId), eq(plannedSessions.userId, ctx.userId), livePlannedSessions));
  if (!row) throw new PlanStateError(STALE_SWAP);
  const done = await applySessionOp(
    { ...ctx, reason: ctx.reason ?? `Readiness: ${swap.flag.text}; hard session made easy` },
    {
      op: "set_workout",
      id: sessionId,
      workout: swap.workout,
      expectedVersion,
      ...(row.priority === "key" && { priority: null }),
      // Two taps (two devices) read the same suggestion; the app's writes keep the
      // version, so the second is refused by what the session runs now (review item 7).
      ifStill: { programId: row.programId, workout: row.workout, message: STALE_SWAP },
    },
    { lc, override, mode: ctx.writer === "assistant" ? "check" : "warn" },
  );
  return { ...done, swap };
}
