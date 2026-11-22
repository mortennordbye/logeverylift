import { enduranceEnabledFor } from "@/lib/endurance";
import type { HomeContext } from "@/lib/home/core";
import { plannedSessionCheck } from "@/lib/session-check";
import { sessionCompliance } from "@/lib/session-compliance";
import { sessionMatch } from "@/lib/session-match";
import { getUserSettings } from "@/lib/user-settings";
import { lastDaySessions, matchLine, metricRows, timeRow, type LastSessionCard, type LastSessionData } from "@/lib/utils/last-session";
import { addDaysStr } from "@/lib/utils/planned-sessions";
import { shortDay } from "@/lib/utils/seasons";
import { sessionCheckHref } from "@/lib/utils/session-match";

export type { LastSessionData } from "@/lib/utils/last-session";

/** How far back the widget looks for a done bike or run session. */
export const WINDOW_DAYS = 14;

/**
 * The last day of the last 14 that has done bike or run sessions, one card
 * per session in the day's order (docs/plans/session-check.md, decision 9).
 * Read only, and every read is the user's: `sessionCompliance` for the
 * sessions, `plannedSessionCheck` for the judged steps and `sessionMatch` for
 * the match (Garmin parts only where `garminAllowedFor` is true). Returns
 * words and marks only. Null when there is no such session, for the empty
 * state.
 */
export async function loadLastSession(ctx: HomeContext): Promise<LastSessionData | null> {
  if (!(await enduranceEnabledFor(ctx.userId))) return null;
  const all = await sessionCompliance(ctx.userId, addDaysStr(ctx.today, -(WINDOW_DAYS - 1)), ctx.today);
  const day = lastDaySessions(all);
  if (!day.length) return null;
  const { units } = await getUserSettings(ctx.userId);
  const cards = await Promise.all(
    day.map(async (s): Promise<LastSessionCard> => {
      const [check, match] = await Promise.all([plannedSessionCheck(ctx.userId, s.id, s), sessionMatch(ctx.userId, s.id, s)]);
      const sport = s.sport === "run" ? "run" : "bike";
      const steps = (check?.parts ?? []).filter((p) => p.sport === sport).flatMap((p) => p.steps);
      return {
        plannedSessionId: s.id,
        title: `${s.label ?? s.programName ?? (sport === "run" ? "Run" : "Ride")} · ${shortDay(s.date)}`,
        match: matchLine(match, units),
        rows: metricRows(sport, steps),
        time: timeRow(steps, { done: s.done?.durationSeconds ?? null, planned: s.planned.durationSeconds }),
        href: steps.length ? sessionCheckHref(s.id) : null,
      };
    }),
  );
  return { cards };
}
