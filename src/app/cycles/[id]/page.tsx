/**
 * Cycle Detail Page (docs/plans/plan-tab-redesign.md, P2)
 *
 * A weekday cycle shows its dated sessions a week at a time; a rotation shows
 * its order and the next session; a completed cycle shows what comes next.
 * The template is edited on /cycles/[id]/template.
 */

import { answerSession } from "@/components/features/answer-session";
import { CycleCompletionBanner, type NextCycle } from "@/components/features/CycleCompletionBanner";
import { CycleMenu, StartCycleButton } from "@/components/features/CycleDetailClient";
import { CycleWeek, RotationOrder, TemplateWeek } from "@/components/features/CycleSessionsClient";
import { HOME_UI } from "@/components/features/home/fonts";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { BackLink } from "@/components/ui/BackLink";
import { getProgramsWithExercises } from "@/lib/actions/programs";
import { getPrograms } from "@/lib/actions/programs";
import { getActiveCycleForUser, getCyclePeriodization, getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { cycleStartContext } from "@/lib/cycle-start";
import { enduranceEnabledFor } from "@/lib/endurance";
import { ownDeletedCycle } from "@/lib/plan-deleted";
import { listPlanned } from "@/lib/planned-sessions";
import { seasonOfCycle } from "@/lib/seasons";
import { moveSuggestion } from "@/lib/session-answers";
import { sessionCompliance } from "@/lib/session-compliance";
import { syncLimitWarnings } from "@/lib/training-limits";
import { userToday } from "@/lib/user-settings";
import { type DetailSession, blockWeeks, cycleSubLine, dayLabels, dayMonth, rotationRows, weekIndexOf } from "@/lib/utils/cycle-detail";
import { cycleLengthDays, cycleWeek, parseDateStr, toDateStr } from "@/lib/utils/cycle-position";
import { formatPeriodizationSummary } from "@/lib/utils/periodization";
import { addDaysStr } from "@/lib/utils/planned-sessions";
import { mondayOf } from "@/lib/utils/session-compliance";
import { PHASE_TYPE_LABELS, lengthFromDays, lengthLabel, runLengthDays, shortDay } from "@/lib/utils/seasons";
import { requireSession } from "@/lib/utils/session";
import { listWorkouts } from "@/lib/workouts";
import type { ProgramWithExercises } from "@/types/workout";
import Link from "next/link";
import { notFound } from "next/navigation";

/** The first three exercise names of a program, for a session row. */
function exerciseNames(program: ProgramWithExercises | undefined): string | null {
  if (!program || program.programExercises.length === 0) return null;
  return program.programExercises
    .slice(0, 3)
    .map((pe) => pe.exercise.name)
    .join(", ");
}

export default async function CycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  const auth = await requireSession();
  const userId = auth.user.id;
  // Like home: a block whose day has come starts, and one that is over completes, before the cycle is read.
  await getActiveCycleForUser();
  const [cycleResult, programsResult, periodizationResult] = await Promise.all([
    getTrainingCycleWithSlots(cycleId),
    getPrograms(),
    getCyclePeriodization(cycleId),
  ]);
  // Delete in the menu renders this page again in its response.
  const deleted = cycleResult.success ? null : await ownDeletedCycle(userId, cycleId);
  if (deleted) return <PlanItemDeleted item={deleted} />;
  if (!cycleResult.success) notFound();

  const cycle = cycleResult.data;
  // A phase of a season shows where it sits (D8).
  const season = await seasonOfCycle(userId, cycle);
  // T4: limits this week's sync broke (only an endurance user's sync stores any).
  const limitWarnings = cycle.status === "active" ? await syncLimitWarnings(userId, cycle.id, cycle.lastSyncedWeek) : [];
  const programs = (programsResult.success ? programsResult.data : []).map((p) => ({ id: p.id, name: p.name }));
  const periodization = periodizationResult.success ? periodizationResult.data : null;
  const today = toDateStr(await userToday(userId));
  const endurance = await enduranceEnabledFor(userId);

  // A start names what it ends or drops: the running cycle and the draft scheduled next.
  const { running, scheduled } = await cycleStartContext(userId, today);
  const otherRunning = running && running.id !== cycle.id ? running : null;
  const otherScheduled = scheduled && scheduled.id !== cycle.id ? scheduled : null;

  const lengthDays = cycleLengthDays(cycle);
  // A running block shows the length it runs: a draft scheduled inside it ends it the day before.
  const runDays = cycle.status === "active" && cycle.startDate ? runLengthDays(cycle.startDate, lengthDays, otherScheduled?.day ?? null) : lengthDays;
  const totalWeeks = Math.ceil(runDays / 7);
  const weekday = cycle.scheduleType === "day_of_week";
  // The block's first day: a running block's start, or the day a scheduled draft starts.
  const blockStart = cycle.status === "active" ? cycle.startDate : cycle.status === "draft" ? cycle.scheduledStartDate : null;
  const lastDay = blockStart ? addDaysStr(blockStart, lengthDays - 1) : null;
  const currentWeek = cycle.status === "active" && cycle.startDate ? cycleWeek(parseDateStr(cycle.startDate), cycle.durationWeeks, parseDateStr(today), cycle.durationDays).currentWeek : null;

  const planned = blockStart && lastDay && cycle.status !== "completed" ? await listPlanned(userId, blockStart, lastDay, cycle.id) : [];
  const dated = planned.filter((p) => p.rotationPosition == null && p.id != null);
  const walk = planned.filter((p) => p.rotationPosition != null);

  const programIds = new Set<number>();
  for (const s of cycle.slots) if (s.programId) programIds.add(s.programId);
  for (const p of planned) if (p.programId) programIds.add(p.programId);
  const programsMap = await getProgramsWithExercises([...programIds]);

  // Endurance users see key sessions, bricks and "Did you do it?"; lifters get none of them (D18).
  const showEndurance = endurance && weekday && blockStart != null && lastDay != null && cycle.status !== "completed";
  const [compliance, library] = showEndurance ? await Promise.all([sessionCompliance(userId, blockStart, lastDay, { cycleId: cycle.id }), listWorkouts(userId)]) : [[], []];
  const complianceById = new Map(compliance.map((c) => [c.id, c]));
  // A missed key session of this week gets the day home suggests for it (D19).
  const moveTo = new Map(
    await Promise.all(
      compliance.filter((c) => c.priority === "key" && c.status === "missed" && c.date >= mondayOf(today)).map(async (c) => [c.id, await moveSuggestion(userId, c)] as const),
    ),
  );
  const sessions: DetailSession[] = dated.map((p) => {
    const c = complianceById.get(p.id!);
    return {
      id: p.id!,
      date: p.date,
      position: p.position,
      name: p.label ?? c?.workout?.name ?? p.programName ?? "Session",
      label: p.label,
      notes: p.notes,
      summary: c?.workoutSummary ?? null,
      exercises: p.programId != null ? exerciseNames(programsMap[p.programId]) : null,
      programId: p.programId,
      status: p.status,
      touched: p.touched,
      templateDate: p.templateDate,
      key: c?.priority === "key",
      brick: c?.brickParentId != null,
      answer: c?.state === "unconfirmed" ? answerSession(c) : null,
      moveTo: moveTo.get(p.id!) ?? null,
    };
  });

  // A completed cycle names the cycle scheduled next, if there is one. A
  // completed phase names its season's next phase, even when the chain is
  // paused and another cycle holds the scheduled start (J8-09).
  let next: NextCycle | null = null;
  const following = season?.following ?? null;
  if (cycle.status === "completed" && following) {
    next = {
      id: following.id,
      name: following.name,
      startsLabel: following.day ? shortDay(following.day) : null,
      startsTomorrow: following.day != null && following.day <= addDaysStr(today, 1),
    };
  } else if (cycle.status === "completed" && otherScheduled) {
    next = { id: otherScheduled.id, name: otherScheduled.name, startsLabel: shortDay(otherScheduled.day), startsTomorrow: otherScheduled.day <= addDaysStr(today, 1) };
  }
  const plannedLast = cycle.startDate ? addDaysStr(cycle.startDate, lengthDays - 1) : null;
  const endedLabel = plannedLast && plannedLast < today ? `ended ${dayMonth(plannedLast)}` : "ended early";

  const { headline: periodizationHeadline, note: periodizationNote } = periodization ? formatPeriodizationSummary(periodization) : { headline: "", note: "" };
  const subLine = cycleSubLine(cycle.scheduleType, runDays === lengthDays ? lengthLabel(cycle) : lengthLabel(lengthFromDays(runDays)), currentWeek, totalWeeks);
  const phaseLine = season ? `Phase ${season.position}${cycle.phaseType ? ` · ${PHASE_TYPE_LABELS[cycle.phaseType]}` : ""}` : null;
  const templateHref = `/cycles/${cycle.id}/template`;
  // Days the template names with no session, such as "Mobility" (only a weekday cycle has days).
  const labels = weekday ? dayLabels(cycle.slots) : {};
  const slotPrograms = [...new Map(cycle.slots.filter((s) => s.program).map((s) => [s.program!.id, s.program!.name])).entries()];

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <header className="flex items-center justify-between px-4 pt-4 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Plan" }} />
        <CycleMenu cycle={cycle} running={otherRunning} />
      </header>

      <div className="flex flex-col gap-4 px-4 pt-2 pb-nav-safe">
        <div className="flex flex-col gap-1.5">
          <h1 className="home-display text-[34px] leading-9 uppercase break-words">{cycle.name}</h1>
          <span className="text-sm text-muted-foreground">{subLine}</span>
          {season && (
            <Link
              href={`/seasons/${season.id}`}
              data-testid="cycle-season"
              className="self-start flex items-center min-h-11 px-3.5 mt-1 rounded-full bg-widget text-sm active:opacity-70"
            >
              Phase {season.position} of {season.phaseCount} · {season.name}&nbsp;
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
            </Link>
          )}
          {season?.replan.flagged && <p className="text-[13px] text-muted-foreground">The season&apos;s races changed. Its phases are not planned again yet.</p>}
        </div>

        {limitWarnings.length > 0 && (
          <div className="rounded-[20px] bg-widget px-4 py-3" data-testid="sync-limit-warning">
            <p className="text-xs font-semibold tracking-[1px] uppercase text-muted-foreground mb-1">This week breaks a training limit</p>
            {limitWarnings.map((w) => (
              <p key={w.rule} className="text-sm">
                {w.message}
              </p>
            ))}
          </div>
        )}

        {periodization && cycle.status !== "completed" && (
          <div className="rounded-[20px] bg-widget px-4 py-3.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{periodizationHeadline}</p>
              <span className="text-xs font-semibold text-brand">{Math.round(periodization.multiplier * 100)}%</span>
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">{periodizationNote}</p>
          </div>
        )}

        {cycle.status === "completed" && (
          <>
            <CycleCompletionBanner cycle={cycle} lengthLabel={lengthLabel(cycle)} endedLabel={endedLabel} next={next} running={otherRunning} />
            {slotPrograms.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="mx-1 text-xs font-semibold tracking-[1px] uppercase text-muted-foreground">Programs in this cycle</h2>
                <div className="flex flex-col rounded-[20px] bg-widget overflow-hidden">
                  {slotPrograms.map(([pid, name]) => (
                    <Link key={pid} href={`/programs/${pid}/history`} className="flex items-center justify-between gap-3 px-4 min-h-[52px] border-b border-hairline last:border-b-0 text-[15px] active:bg-foreground/5">
                      <span className="truncate">{name}</span>
                      <span className="shrink-0 text-sm text-brand">See history ›</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {cycle.status === "draft" && (
          <StartCycleButton
            cycle={cycle}
            skippedPhases={season?.skippedPhases ?? 0}
            scheduledFor={cycle.scheduledStartDate}
            running={otherRunning}
            otherScheduled={otherScheduled}
          />
        )}

        {!weekday && cycle.status === "active" && currentWeek != null && (
          <div className="flex flex-col gap-2 rounded-[20px] bg-widget p-4" data-testid="cycle-progress">
            <div className="grid gap-1 h-2.5" style={{ gridTemplateColumns: `repeat(${totalWeeks}, minmax(0, 1fr))` }} aria-label={`Week ${currentWeek} of ${totalWeeks}`} role="img">
              {Array.from({ length: totalWeeks }, (_, i) => (
                <div
                  key={i}
                  className={`rounded ${i + 1 <= currentWeek ? "bg-brand" : "bg-[#707076]"} ${i + 1 === currentWeek ? "ring-2 ring-brand ring-offset-2 ring-offset-widget" : ""}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[13px] text-muted-foreground">
              <span>Started {dayMonth(cycle.startDate!)}</span>
              <span>Ends {dayMonth(lastDay!)}</span>
            </div>
          </div>
        )}

        {weekday && cycle.status !== "completed" && blockStart && lastDay && (
          <CycleWeek
            weeks={blockWeeks(blockStart, runDays)}
            initialWeek={weekIndexOf(blockWeeks(blockStart, runDays), today)}
            sessions={sessions}
            today={today}
            phaseLine={phaseLine}
            programs={programs}
            library={showEndurance ? library.map((w) => ({ id: w.id, name: w.name, sport: w.sport, summary: w.summary })) : undefined}
            programsMap={programsMap}
            templateHref={templateHref}
            dayLabels={labels}
          />
        )}

        {weekday && cycle.status === "draft" && !blockStart && (
          <TemplateWeek
            templateHref={templateHref}
            days={[1, 2, 3, 4, 5, 6, 7].map((dow) => ({
              dow,
              sessions: cycle.slots
                .filter((s) => s.dayOfWeek === dow && s.programId != null)
                .sort((a, b) => (a.daySlot ?? 1) - (b.daySlot ?? 1))
                .map((s) => ({ name: s.label ?? s.program?.name ?? "Session", sub: exerciseNames(programsMap[s.programId!]) ?? "" })),
              label: labels[dow] ?? null,
            }))}
          />
        )}

        {!weekday && cycle.status !== "completed" && (
          <RotationOrder
            cycleId={cycle.id}
            rows={rotationRows(
              cycle.slots.map((s) => ({ id: s.id, orderIndex: s.orderIndex ?? null, programId: s.programId ?? null, label: s.label ?? null, programName: s.program?.name ?? null })),
              walk,
              today,
            )}
            today={today}
            programs={programs}
            programsMap={programsMap}
            editHref={templateHref}
            active={cycle.status === "active"}
          />
        )}
      </div>
    </div>
  );
}
