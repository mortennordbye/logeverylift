/**
 * "Did you do it?" (docs/plans/workouts-and-compliance.md, 6.5 and 6.6;
 * decisions D11, D19): the answers to a dated session whose day has passed,
 * and what the home card shows. A "Yes" writes a normal logged workout linked
 * to the session; "Missed" stores the answer; a missed key session gets one
 * suggested day in the same week, which the user taps to move it.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { exercises } from "@/db/schema";
import { writeLoggedSession } from "@/lib/logged-sessions";
import { PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { sessionCompliance, illnessOf, type SessionCompliance } from "@/lib/session-compliance";
import { athleteProfiles } from "@/db/schema";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { instantInZone } from "@/lib/utils/user-date";
import { PROMPT_DAYS, mondayOf, returnInfo, suggestMoveDay, type MoveSuggestion, type ReturnInfo, type Sport } from "@/lib/utils/session-compliance";
import { addDaysStr } from "@/lib/utils/seasons";
import { and, asc, eq, isNull } from "drizzle-orm";

/** The built-in exercise of a discipline: the lowest id that is not custom. */
export async function sportExerciseId(sport: Sport): Promise<number | null> {
  const [row] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.discipline, sport), isNull(exercises.userId)))
    .orderBy(asc(exercises.id))
    .limit(1);
  return row?.id ?? null;
}

/** One dated session with its state, or null when it is not the user's or not live. */
export async function oneSession(userId: string, id: number): Promise<SessionCompliance | null> {
  const { plannedSessions } = await import("@/db/schema");
  const [row] = await db
    .select({ date: plannedSessions.date })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId), isNull(plannedSessions.deletedAt)));
  if (!row?.date) return null;
  const all = await sessionCompliance(userId, row.date, row.date);
  return all.find((s) => s.id === id) ?? null;
}

export type DoneAnswer = { durationSeconds: number; distanceMeters?: number | null; rpe?: number | null; notes?: string | null };

/**
 * "Yes, I did it": a completed workout on the session's day, linked to it,
 * with one set on the sport's built-in exercise. Written through the module
 * MCP log_session uses (lock, duplicate check, PR rebuild).
 */
export async function confirmDone(ctx: PlanWriteContext, plannedSessionId: number, answer: DoneAnswer, source: "app" | "assistant"): Promise<{ sessionId: number }> {
  const s = await oneSession(ctx.userId, plannedSessionId);
  if (!s) throw new PlanStateError("Session not found");
  const today = toDateStr(await userToday(ctx.userId));
  if (s.date > today) throw new PlanStateError("This session's day has not come yet.");
  if (s.state === "done") throw new PlanStateError("This session is already done.");
  if (s.state === "skipped") throw new PlanStateError("This session was skipped; plan it again first.");
  if (!s.sport) throw new PlanStateError("Log a strength session in the app or with log_session.");
  const exerciseId = await sportExerciseId(s.sport);
  if (exerciseId == null) throw new PlanStateError("No built-in exercise for this sport.");
  const { timeZone } = await getUserSettings(ctx.userId);
  const start = new Date(Math.min(instantInZone(s.date, 12, 0, timeZone).getTime(), Date.now()));
  const row = await writeLoggedSession(ctx.userId, {
    date: s.date,
    start,
    programId: s.programId,
    plannedSessionId,
    durationMinutes: Math.max(1, Math.round(answer.durationSeconds / 60)),
    notes: answer.notes ?? null,
    source,
    sets: [
      {
        exerciseId,
        setNumber: 1,
        durationSeconds: answer.durationSeconds,
        ...(answer.distanceMeters != null && { distanceMeters: answer.distanceMeters }),
        ...(answer.rpe != null && { rpe: answer.rpe }),
      },
    ],
  });
  return { sessionId: row.id };
}

/** The days the athlete trains (athlete profile), or null for any day. */
async function availableDays(userId: string): Promise<number[] | null> {
  const [p] = await db.select({ days: athleteProfiles.availableDays }).from(athleteProfiles).where(and(eq(athleteProfiles.userId, userId), isNull(athleteProfiles.deletedAt)));
  return p?.days ?? null;
}

/** The suggested day for a missed key session (D19), or null when it is not a missed key session. */
export async function moveSuggestion(userId: string, s: SessionCompliance, week?: SessionCompliance[]): Promise<MoveSuggestion | null> {
  if (s.state !== "missed" || s.priority !== "key" || s.status !== "missed") return null;
  const today = toDateStr(await userToday(userId));
  const monday = mondayOf(s.date);
  const sessions = week ?? (await sessionCompliance(userId, monday, addDaysStr(monday, 6)));
  // Every session that holds a place in the day's cap; an unanswered one may still be done, so it loads its day (review 13).
  const load = sessions
    .filter((x) => x.id !== s.id && x.status === "planned")
    .map((x) => ({ date: x.date, keyOrHard: (x.state === "planned" || x.state === "done" || x.state === "unconfirmed") && (x.priority === "key" || x.hard) }));
  return suggestMoveDay({ missedDate: s.date, today, load, availableDays: await availableDays(userId), illness: await illnessOf(userId) });
}

export type HomeEndurance = {
  /** Sessions whose day passed with no match and no answer, newest first. */
  unconfirmed: SessionCompliance[];
  /** Missed key sessions of this week and last, each with its suggested day. */
  missedKey: { session: SessionCompliance; suggestion: MoveSuggestion }[];
  returnInfo: ReturnInfo | null;
};

/** What the home screen shows an endurance user (section 7). */
export async function homeEndurance(userId: string): Promise<HomeEndurance> {
  const today = toDateStr(await userToday(userId));
  const from = addDaysStr(today, -PROMPT_DAYS);
  const sessions = await sessionCompliance(userId, from < mondayOf(today) ? from : mondayOf(today), addDaysStr(mondayOf(today), 6));
  const unconfirmed = sessions.filter((s) => s.state === "unconfirmed").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.position - b.position));
  const missedKey: HomeEndurance["missedKey"] = [];
  for (const s of sessions.filter((x) => x.status === "missed" && x.state === "missed" && x.priority === "key" && x.date >= mondayOf(today))) {
    const suggestion = await moveSuggestion(userId, s, sessions);
    if (suggestion) missedKey.push({ session: s, suggestion });
  }
  const illness = await illnessOf(userId);
  const done = sessions.filter((s) => s.state === "done" && s.sport != null).map((s) => s.date);
  return { unconfirmed, missedKey, returnInfo: returnInfo(illness, today, done) };
}
