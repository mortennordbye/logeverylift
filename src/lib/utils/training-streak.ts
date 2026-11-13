/** The date `days` days before or after `dateStr` ("YYYY-MM-DD"), in UTC calendar dates. */
function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Counts consecutive weeks with workouts, starting from the most recent week.
 * `weekStarts` are Postgres `date_trunc('week', startTime)::date` values,
 * newest first: Mondays of weeks cut on the stored UTC timestamps. So this
 * week is the UTC week of `now`, and all date math is on UTC dates, which
 * keeps the result the same whatever the server's own zone is.
 */
export function computeStreakWeeks(weekStarts: string[], now: Date = new Date()): number {
  if (weekStarts.length === 0) return 0;

  const todayStr = now.toISOString().slice(0, 10);
  const currentMondayStr = shiftDays(todayStr, -((now.getUTCDay() + 6) % 7));

  let streak = 0;
  let expectedMonday = currentMondayStr;

  for (const weekStart of weekStarts) {
    if (weekStart === expectedMonday) {
      streak++;
      expectedMonday = shiftDays(expectedMonday, -7);
    } else if (expectedMonday === currentMondayStr) {
      // Current week not yet trained — try previous week
      expectedMonday = shiftDays(expectedMonday, -7);
      if (weekStart === expectedMonday) {
        streak++;
        expectedMonday = shiftDays(expectedMonday, -7);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return streak;
}
