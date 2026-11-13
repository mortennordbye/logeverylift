import { AiCheckinCard } from "@/components/features/AiCheckinCard";
import { DeclineMakeupButton } from "@/components/features/DeclineMakeupButton";
import { DidYouDoItCard, IllnessBanner } from "@/components/features/DidYouDoIt";
import { EnduranceTodayCard, type EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import { answerSession } from "@/components/features/answer-session";
import { PolicyUpdateNotice } from "@/components/features/PolicyUpdateNotice";
import { ReadinessSwapCard } from "@/components/features/ReadinessSwapCard";
import { SharePromptLoader } from "@/components/features/SharePromptLoader";
import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import { TodaySessionsList } from "@/components/features/TodaySessionsList";
import { WeeklyGoalProgress } from "@/components/features/WeeklyGoalProgress";
import { WorkoutInsightBanner } from "@/components/features/WorkoutInsightBanner";
import { getPendingCheckin } from "@/lib/actions/ai-checkin";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { closeStaleOpenSessions } from "@/lib/actions/workout-sessions";
import { getCompletedSessions, getWorkoutInsight, getWorkoutStats } from "@/lib/actions/workout-sets";
import { needsPolicyNotice, needsTermsConsent } from "@/lib/consent";
import { enduranceEnabledFor } from "@/lib/endurance";
import { listIllness } from "@/lib/illness";
import { homeEndurance } from "@/lib/session-answers";
import { sessionCompliance } from "@/lib/session-compliance";
import { distanceLabel } from "@/lib/planned-view";
import { getUserSettings } from "@/lib/user-settings";
import { homeWeekPlanned } from "@/lib/home-week";
import { readinessSwapFor } from "@/lib/readiness-swap";
import { weekDayMarks } from "@/lib/utils/planned-sessions";
import { userToday } from "@/lib/user-settings";
import { parseDateStr } from "@/lib/utils/cycle-position";
import { weekDatesOf } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

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

/**
 * The endurance part of home (docs/plans/workouts-and-compliance.md, 7): null
 * for a lifter, so their home renders nothing new. A failed read hides it.
 */
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

async function enduranceHome(userId: string, today: string) {
  if (!(await enduranceEnabledFor(userId))) return null;
  try {
    const [home, todayRows] = await Promise.all([homeEndurance(userId), enduranceToday(userId, today)]);
    const info = home.returnInfo;
    const sick = info?.phase === "sick" ? ((await listIllness(userId)).find((p) => p.id === info.periodId) ?? null) : null;
    const swap = await readinessSwapFor(userId);
    return {
      readinessSwap: swap ? { sessionId: swap.sessionId, label: swap.label, minutes: swap.minutes, text: swap.text } : null,
      unconfirmed: home.unconfirmed.map(answerSession),
      missedKey: home.missedKey.map((m) => ({
        session: answerSession(m.session),
        moveTo: m.suggestion.date,
        reason: m.suggestion.date === null ? m.suggestion.reason : null,
      })),
      sick: sick ? { id: sick.id, startedOn: sick.startedOn } : null,
      returning: info?.phase === "returning" ? info.rule : null,
      today: todayRows,
    };
  } catch (e) {
    console.error("[Home] endurance_read_failed", { error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}

export default async function Home() {
  const session = await requireSession();
  // New accounts and anyone behind on the terms accept them first. Asked here,
  // not on every route, so it never interrupts a workout in progress.
  if (await needsTermsConsent(session)) redirect("/consent");

  // Failsafe: close out any workout left open for >10h before rendering.
  await closeStaleOpenSessions();

  // Today and this week in the user's zone (src/lib/utils/user-date.ts).
  const today = await userToday(session.user.id);
  const todayStr = toDateStr(today);
  const weekDates = weekDatesOf(todayStr);
  // Sessions are matched to the week by their date below. The query filters
  // by start time, so start a day early: the user's Monday can begin on the
  // server's Sunday.
  const monday = parseDateStr(weekDates[0]);
  monday.setDate(monday.getDate() - 1);

  // Fetch cycle first — needed to know today's program before we can fetch insight
  const cycleResult = await getActiveCycleForUser();
  const info = cycleResult.success ? cycleResult.data : null;
  const todayProgram = info?.todaySlot?.program ?? null;

  // Batch remaining queries in parallel, including insight now that we know todayProgram
  const [statsResult, sessionsResult, insight, checkinResult, policyNotice, endurance] = await Promise.all([
    getWorkoutStats(),
    getCompletedSessions(monday),
    todayProgram
      ? getWorkoutInsight(todayProgram.id, cycleResult).catch(() => undefined)
      : Promise.resolve(undefined),
    getPendingCheckin(),
    needsPolicyNotice(session),
    enduranceHome(session.user.id, todayStr),
  ]);
  const checkin = checkinResult.success ? checkinResult.data : null;

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
  const todayLocal = today;
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

  // This week's dated sessions, so a moved session shows on its new day and a
  // day with several shows how many. Outside the block the template shows, as before.
  // A failed read falls back to the template's week (review 5).
  const weekPlanned =
    info?.cycle.scheduleType === "day_of_week"
      ? await homeWeekPlanned(session.user.id, weekDates[0], weekDates[6], info.cycle.id)
      : [];
  const blockStart = info?.cycle.startDate ?? "";
  const blockEnd = info?.endDate ?? "";
  const plannedOn = (date: string) => (weekPlanned ? weekPlanned.filter((p) => p.date === date) : null);

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
    ? parseDateStr(info.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">

      {/* Header */}
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-center">LogEveryLift</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 overflow-hidden pb-4">

        {policyNotice && <PolicyUpdateNotice />}

        {checkin && <AiCheckinCard id={checkin.id} cycleName={checkin.cycleName} />}

        {endurance && <IllnessBanner sick={endurance.sick} returning={endurance.returning} today={todayStr} />}

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
                {severalToday ? `${todaySessions.length} sessions today` : (todayProgram?.name ?? (isRestDay ? "Rest Day" : "No program today"))}
              </p>
              {completedToday && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded-full shrink-0">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {todayAutoSession ? "Done · automatic" : "Done"}
                </span>
              )}
              {!completedToday && rotationOverdueDays > 0 && todayProgram && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full shrink-0">
                  {rotationOverdueDays === 1 ? "1 day overdue" : `${rotationOverdueDays} days overdue`}
                </span>
              )}
            </div>
            {insight && <WorkoutInsightBanner insight={insight} />}
            {severalToday ? (
              <>
                <TodaySessionsList sessions={todaySessions} />
                <Link
                  href="/new-workout"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                >
                  Different Program
                </Link>
              </>
            ) : todayProgram ? (
              <div className="flex gap-2 flex-wrap">
                {completedToday ? (
                  <Link
                    href={`/programs/${todayProgram.id}/workout`}
                    prefetch={true}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground active:opacity-70"
                  >
                    {todayAutoSession ? "Log in app" : "Do Again"}
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
                {todayAutoSession && <SkipAutoDayButton sessionId={todayAutoSession.id} />}
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

        {/* ── Endurance today (endurance switch only) ── */}
        {endurance && <EnduranceTodayCard rows={endurance.today} />}
        {/* ── Readiness swap (endurance switch and Garmin only) ── */}
        {endurance?.readinessSwap && <ReadinessSwapCard swap={endurance.readinessSwap} />}

        {/* ── Did you do these? (endurance switch only) ── */}
        {endurance && <DidYouDoItCard unconfirmed={endurance.unconfirmed} missedKey={endurance.missedKey} today={todayStr} />}

        {/* ── Missed this week (day-of-week mode) ───────── */}
        {dowMissed.length > 0 && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-2">
              Missed this week
            </p>
            <ul className="flex flex-col divide-y divide-amber-500/20">
              {dowMissed.map((m) =>
                m.slot.program ? (
                  <li key={`${m.date}-${m.plannedSessionId ?? m.slot.id}`} className="flex items-center justify-between gap-2 py-2">
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
                      <DeclineMakeupButton date={m.date} plannedSessionId={m.plannedSessionId} />
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
                  const inBlock = dateStr >= blockStart && dateStr < blockEnd;
                  const { hasProgram, count } = weekDayMarks({ planned: plannedOn(dateStr), inBlock, templateHasProgram: !!slot?.program });
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
                        {!isCompleted && count > 1 && (
                          <span className="text-[10px] font-bold text-primary" aria-label={`${count} sessions`}>
                            {count}
                          </span>
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

        {/* ── No cycle: preview of the cycle layout ─────── */}
        {/* Mirrors the shape of the real today card above so the screen shows
            what a cycle gives you instead of sitting empty. The cycle name,
            week counter and program line are placeholders — aria-hidden keeps
            that invented text out of the accessibility tree, and the prompt
            below it carries the actual meaning. */}
        {!info && (
          <div className="rounded-2xl bg-muted p-4 shrink-0">
            <div aria-hidden="true" className="opacity-40 select-none">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold">Your training cycle</span>
                <span className="text-xs text-muted-foreground">Week 1/8</span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: "12%" }} />
                </div>
                <span className="text-xs text-muted-foreground shrink-0">ends —</span>
              </div>
              <p className="text-xl font-bold">Today&apos;s program</p>
            </div>

            <div className="mt-3 border-t border-border/40 pt-3">
              <p className="text-sm text-muted-foreground">
                Set up a training cycle to fill this in — it schedules which program
                you run each day and tracks the weeks as you go.
              </p>
              <Link
                href="/cycles"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary active:opacity-70"
              >
                Set up a Cycle →
              </Link>
            </div>
          </div>
        )}

        {/* ── No cycle: week strip with unfilled days ───── */}
        {/* Days a cycle would schedule are dashed placeholders, but a day the
            user has actually trained still reads as completed — real progress
            must not disappear behind the preview. */}
        {!info && (
          <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden">
            <div>
              <Link href="/more/calendar" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1 active:opacity-60">
                This Week ›
              </Link>
              <div className="grid grid-cols-7 gap-0.5">
                {weekDates.map((dateStr, i) => {
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
                        ${isCompleted ? "bg-primary" : "border-2 border-dashed border-border/50"}`}
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
            {/* Centred in the leftover space: without a cycle this card has
                less to show, so a top-aligned ring leaves a void beneath it. */}
            <div className="border-t border-border/30 pt-3 flex-1 flex flex-col justify-center min-h-0">
              <WeeklyGoalProgress thisWeekWorkouts={stats.thisWeekWorkouts} />
            </div>
          </div>
        )}

      </div>

      {/* No-cycle action — pinned above nav bar. The cycle CTA lives in the
          preview card above, so only the train-now action is pinned here. */}
      {!info && (
        <div className="px-6 pb-4 shrink-0">
          <Link
            href="/new-workout"
            className="flex items-center justify-center w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground active:opacity-80"
          >
            Start a Workout
          </Link>
        </div>
      )}

      <Suspense fallback={null}>
        <SharePromptLoader />
      </Suspense>

    </div>
  );
}
