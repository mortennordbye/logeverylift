/** Counts consecutive weeks with workouts, starting from the most recent week. */
export function computeStreakWeeks(weekStarts: string[]): number {
  if (weekStarts.length === 0) return 0;

  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(today);
  currentMonday.setDate(today.getDate() + diff);
  const currentMondayStr = currentMonday.toISOString().split("T")[0];

  let streak = 0;
  let expectedMonday = currentMondayStr;

  for (const weekStart of weekStarts) {
    if (weekStart === expectedMonday) {
      streak++;
      const d = new Date(expectedMonday + "T00:00:00");
      d.setDate(d.getDate() - 7);
      expectedMonday = d.toISOString().split("T")[0];
    } else if (expectedMonday === currentMondayStr) {
      // Current week not yet trained — try previous week
      const d = new Date(expectedMonday + "T00:00:00");
      d.setDate(d.getDate() - 7);
      expectedMonday = d.toISOString().split("T")[0];
      if (weekStart === expectedMonday) {
        streak++;
        const d2 = new Date(expectedMonday + "T00:00:00");
        d2.setDate(d2.getDate() - 7);
        expectedMonday = d2.toISOString().split("T")[0];
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return streak;
}
