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
import { trainingCycles } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { liveCycles } from "@/lib/plan-live";
import { PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { applySessionOp } from "@/lib/planned-sessions";
import { sessionCompliance } from "@/lib/session-compliance";
import { NO_OVERRIDE, limitContext, readinessToday, type LimitOverride } from "@/lib/training-limits";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { readinessSwap, type ReadinessSwap } from "@/lib/utils/training-limits";
import { and, eq } from "drizzle-orm";

/** Today's readiness swap for this user, or null (switch off, no Garmin, no flag, no hard session left today). */
export async function readinessSwapFor(userId: string): Promise<ReadinessSwap | null> {
  if (!(await enduranceEnabledFor(userId))) return null;
  const today = toDateStr(await userToday(userId));
  const flag = await readinessToday(userId, today);
  if (!flag || flag.day !== today) return null;
  const rows = (await sessionCompliance(userId, today, today)).filter((s) => s.date === today && s.status === "planned").sort((a, b) => a.position - b.position);
  const sessions = rows.map((s) => ({
    id: s.id,
    label: s.label ?? s.programName ?? s.workout?.name ?? "Session",
    sport: s.sport,
    hard: s.hard,
    plannedDurationS: s.planned.durationSeconds ?? null,
    done: s.state === "done",
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
  const done = await applySessionOp(
    { ...ctx, reason: ctx.reason ?? `Readiness: ${swap.flag.text}; hard session made easy` },
    { op: "set_workout", id: sessionId, workout: swap.workout, expectedVersion },
    { lc, override, mode: ctx.writer === "assistant" ? "check" : "warn" },
  );
  return { ...done, swap };
}
