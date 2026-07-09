import { DeclineMakeupButton } from "@/components/features/DeclineMakeupButton";
import { WeeklyGoalProgress } from "@/components/features/WeeklyGoalProgress";
import { WorkoutInsightBanner } from "@/components/features/WorkoutInsightBanner";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { closeStaleOpenSessions } from "@/lib/actions/workout-sessions";
import { getCompletedSessions, getWorkoutInsight, getWorkoutStats } from "@/lib/actions/workout-sets";
import { requireSession } from "@/lib/utils/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_LABELS_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dowLabel(dateStr: string): string {
  // dateStr is YYYY-MM-DD; build a local Date to avoid TZ shifts.
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const jsDay = date.getDay();
  const dow = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon … 6=Sun
  return DAY_LABELS_FULL[dow];
}

function getThisWeekDates(): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d);
  });
}

export default async function Home() {
  await requireSession();

  // Failsafe: close out any workout left open for >10h before rendering.
  await closeStaleOpenSessions();

  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  // Fetch cycle first — needed to know today's program before we can fetch insight
  const cycleResult = await getActiveCycleForUser();
  const info = cycleResult.success ? cycleResult.data : null;
  const todayProgram = info?.todaySlot?.program ?? null;

  // Batch remaining queries in parallel, including insight now that we know todayProgram
  const [statsResult, sessionsResult, insight] = await Promise.all([
    getWorkoutStats(),
    getCompletedSessions(monday),
    todayProgram
      ? getWorkoutInsight(todayProgram.id, cycleResult).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const stats = statsResult.success
    ? statsResult.data
    : { totalWorkouts: 0, totalReps: 0, totalSets: 0, thisWeekWorkouts: 0 };
  const completedDates = new Set(
    sessionsResult.success ? sessionsResult.data.map((s) => s.date) : [],
  );

  const todayStr = toDateStr(new Date());
  const weekDates = getThisWeekDates();
  const completedToday = completedDates.has(todayStr);

  const isRestDay = info !== null && info.todaySlot !== null && !todayProgram;

  // Rotation mode: if missedSlots is non-empty, today's slot is overdue.
  // Use the earliest miss date to compute "days overdue."
  const todayLocal = new Date();
  todayLocal.setHours(0, 0, 0, 0);
  const rotationOverdueDays =
    info?.cycle.scheduleType === "rotation" && info.missedSlots.length > 0
      ? Math.max(
          1,
          Math.floor(
            (todayLocal.getTime() -
              new Date(info.missedSlots[0].date + "T00:00:00").getTime()) /
              86400000,
          ),
        )
      : 0;

  // Day-of-week mode: missed workouts to surface as make-up prompts.
  const dowMissed =
    info?.cycle.scheduleType === "day_of_week" ? info.missedSlots : [];

  const slotByDay =
    info?.cycle.scheduleType === "day_of_week"
      ? Object.fromEntries(
          info.cycle.slots
            .filter((s) => s.dayOfWeek !== null)
            .map((s) => [s.dayOfWeek!, s]),
        )
      : {};

  const progressPct = info
    ? Math.min(((info.currentWeek - 1) / info.cycle.durationWeeks) * 100, 100)
    : 0;
  const endFormatted = info
    ? new Date(info.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">

      {/* Header */}
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-center">LogEveryLift</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 overflow-hidden pb-4">

        {/* ── Today card ─────────────────────────────────── */}
        {info ? (
          <div className={`rounded-2xl p-4 shrink-0 ${completedToday ? "bg-emerald-500/10" : "bg-muted"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">{info.cycle.name}</span>
              <span className="text-xs text-muted-foreground">Week {info.currentWeek}/{info.cycle.durationWeeks}</span>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">ends {endFormatted}</span>
            </div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-xl font-bold">
                {todayProgram?.name ?? (isRestDay ? "Rest Day" : "No program today")}
              </p>
              {completedToday && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded-full shrink-0">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Done
                </span>
              )}
              {!completedToday && rotationOverdueDays > 0 && todayProgram && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full shrink-0">
                  {rotationOverdueDays === 1 ? "1 day overdue" : `${rotationOverdueDays} days overdue`}
                </span>
              )}
            </div>
            {insight && <WorkoutInsightBanner insight={insight} />}
            {todayProgram ? (
              <div className="flex gap-2 flex-wrap">
                {completedToday ? (
                  <Link
                    href={`/programs/${todayProgram.id}/workout`}
                    prefetch={true}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                  >
                    Do Again
                  </Link>
                ) : (
                  <Link
                    href={`/programs/${todayProgram.id}/workout`}
                    prefetch={true}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80"
                  >
                    Start Today&apos;s Workout
                  </Link>
                )}
                <Link
                  href="/new-workout"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                >
                  Different Program
                </Link>
              </div>
            ) : (
              <Link
                href="/new-workout"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
              >
                {completedToday ? "Do Another Workout →" : "Start a Workout →"}
              </Link>
            )}
          </div>
        ) : null}

        {/* ── Missed this week (day-of-week mode) ───────── */}
        {dowMissed.length > 0 && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-2">
              Missed this week
            </p>
            <ul className="flex flex-col divide-y divide-amber-500/20">
              {dowMissed.map((m) =>
                m.slot.program ? (
                  <li key={m.date} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm min-w-0">
                      <span className="text-muted-foreground">{dowLabel(m.date)} — </span>
                      <span className="font-medium">{m.slot.program.name}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/programs/${m.slot.program.id}/workout?makeup=${m.date}`}
                        prefetch={true}
                        className="text-xs font-semibold text-primary px-3 py-1.5 rounded-full bg-primary/10 active:opacity-70"
                      >
                        Make up
                      </Link>
                      <DeclineMakeupButton date={m.date} />
                    </div>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}

        {/* ── Week strip ─────────────────────────────────── */}
        {info?.cycle.scheduleType === "day_of_week" && (
          <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden">
            <div>
              <Link href="/more/calendar" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1 active:opacity-60">
                This Week ›
              </Link>
              <div className="grid grid-cols-7 gap-0.5">
                {weekDates.map((dateStr, i) => {
                  const slot = slotByDay[i + 1];
                  const hasProgram = !!slot?.program;
                  const isToday = dateStr === todayStr;
                  const isPast = dateStr < todayStr;
                  const isCompleted = completedDates.has(dateStr);

                  return (
                    <div key={dateStr} className="flex flex-col items-center gap-1">
                      <span className={`text-[10px] font-bold ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                        {DAY_LETTERS[i]}
                      </span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center
                        ${isToday ? "ring-2 ring-primary ring-offset-1 ring-offset-muted" : ""}
                        ${isCompleted ? "bg-primary" : hasProgram ? "border-2 border-primary/50 bg-primary/10" : "border-2 border-border/30"}`}
                      >
                        {isCompleted && (
                          <svg className="w-3.5 h-3.5 text-primary-foreground" viewBox="0 0 14 14" fill="none">
                            <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-[9px] ${isToday ? "text-primary font-semibold" : isPast ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                        {DAY_LABELS_FULL[i]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-border/30 pt-3">
              <WeeklyGoalProgress thisWeekWorkouts={stats.thisWeekWorkouts} />
            </div>
          </div>
        )}

        {/* Rotation strip */}
        {info?.cycle.scheduleType === "rotation" && (
          <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rotation
            </p>
            <div className="flex gap-2 flex-wrap">
              {[...info.cycle.slots]
                .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
                .map((slot) => (
                  <span
                    key={slot.id}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium
                      ${slot.id === info.todaySlot?.id ? "bg-primary text-primary-foreground" : "bg-border/50 text-muted-foreground"}`}
                  >
                    {slot.program?.name ?? slot.label ?? "Rest"}
                  </span>
                ))}
            </div>
            <div className="border-t border-border/30 pt-3">
              <WeeklyGoalProgress thisWeekWorkouts={stats.thisWeekWorkouts} />
            </div>
          </div>
        )}

        {/* ── No cycle: progress ring ───────────────────── */}
        {!info && (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0">
            <WeeklyGoalProgress thisWeekWorkouts={stats.thisWeekWorkouts} size="lg" />
          </div>
        )}

      </div>

      {/* No-cycle actions — pinned above nav bar */}
      {!info && (
        <div className="px-6 pb-4 space-y-3 shrink-0">
          <Link
            href="/new-workout"
            className="flex items-center justify-center w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground active:opacity-80"
          >
            Start a Workout
          </Link>
          <Link
            href="/cycles"
            className="flex items-center justify-center w-full rounded-2xl bg-muted py-4 text-sm font-medium text-foreground active:opacity-70"
          >
            Set up a Training Cycle
          </Link>
        </div>
      )}

    </div>
  );
}
