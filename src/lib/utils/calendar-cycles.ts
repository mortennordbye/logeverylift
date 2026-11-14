/**
 * The calendar places a cycle by its start date. A draft has none until it
 * starts, so the plan ahead did not show. A scheduled draft gets its
 * scheduled day; a later phase of a season gets its start from the season
 * timeline (`seasonTimeline`, src/lib/utils/seasons.ts). Started cycles keep
 * their real start. Only for showing: nothing is stored.
 */
export function withPlannedStarts<T extends { id: number; status: string; startDate: string | null; scheduledStartDate: string | null }>(
  cycles: T[],
  phaseStarts: ReadonlyMap<number, string>,
): T[] {
  return cycles.map((c) => {
    if (c.status !== "draft") return c;
    const start = c.scheduledStartDate ?? phaseStarts.get(c.id) ?? null;
    return start ? { ...c, startDate: start } : c;
  });
}
