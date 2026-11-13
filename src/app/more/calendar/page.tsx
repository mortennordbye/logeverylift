import { answerSession } from "@/components/features/answer-session";
import { CycleCalendarClient, type CalendarCompliance } from "@/components/features/CycleCalendarClient";
import { getProgramsWithExercises } from "@/lib/actions/programs";
import { getAllCyclesWithSlots } from "@/lib/actions/training-cycles";
import { getCompletedSessions } from "@/lib/actions/workout-sets";
import { enduranceEnabledFor } from "@/lib/endurance";
import { listPlanned } from "@/lib/planned-sessions";
import { sessionCompliance } from "@/lib/session-compliance";
import { heavyLegsNotes } from "@/lib/training-limits";
import { heavyLegsLines } from "@/lib/utils/training-limits";
import { addDaysStr } from "@/lib/utils/planned-sessions";
import { cycleLengthDays } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import { listWorkouts } from "@/lib/workouts";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export default async function CalendarPage() {
  const session = await requireSession();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [cyclesResult, sessionsResult] = await Promise.all([
    getAllCyclesWithSlots(),
    getCompletedSessions(oneYearAgo),
  ]);

  const cycles = cyclesResult.success ? cyclesResult.data : [];
  const completedDates = sessionsResult.success
    ? sessionsResult.data.map((s) => s.date)
    : [];

  // Collect all unique programIds referenced by cycle slots
  const programIds = new Set<number>();
  for (const cycle of cycles) {
    for (const slot of cycle.slots) {
      if (slot.programId) programIds.add(slot.programId);
    }
  }

  // The dated sessions of weekday cycles with dates (docs/plans/sessions.md, 5):
  // moved and skipped sessions show where they are. Rotation days stay as before.
  const dated = cycles.filter((c) => c.scheduleType === "day_of_week" && (c.startDate || c.scheduledStartDate) && c.status !== "completed");
  const starts = dated.map((c) => (c.status === "active" ? c.startDate! : c.scheduledStartDate ?? c.startDate!));
  const range =
    dated.length > 0
      ? { from: starts.reduce((a, b) => (a < b ? a : b)), to: dated.map((c, i) => addDaysStr(starts[i], cycleLengthDays(c))).reduce((a, b) => (a > b ? a : b)) }
      : null;
  const planned = range ? (await listPlanned(session.user.id, range.from, range.to)).filter((p) => p.rotationPosition == null && p.id != null) : [];

  // Endurance users see each session's band and answer past ones here
  // (docs/plans/workouts-and-compliance.md, 7). Lifters get neither.
  const endurance = range != null && (await enduranceEnabledFor(session.user.id));
  const [compliance, library] = endurance
    ? await Promise.all([sessionCompliance(session.user.id, range.from, range.to), listWorkouts(session.user.id)])
    : [[], []];
  const complianceById: Record<number, CalendarCompliance> | undefined = endurance
    ? Object.fromEntries(compliance.map((c) => [c.id, { ...answerSession(c), state: c.state, band: c.band }]))
    : undefined;
  // D3: heavy leg work 1-2 days before a key bike or run, by the limits' own rule.
  const heavyLegs = endurance && range ? heavyLegsLines(await heavyLegsNotes(session.user.id, range.from, range.to)) : undefined;
  for (const p of planned) if (p.programId) programIds.add(p.programId);

  // Pre-fetch all referenced programs in a single batched query
  const programsMap = await getProgramsWithExercises([...programIds]);

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>

      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
      </div>

      <CycleCalendarClient
        cycles={cycles}
        completedDates={completedDates}
        programsMap={programsMap}
        planned={planned}
        compliance={complianceById}
        heavyLegs={heavyLegs}
        library={endurance ? library.map((w) => ({ id: w.id, name: w.name, sport: w.sport, summary: w.summary })) : undefined}
      />
    </div>
  );
}
