import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import { TodaySessionsList } from "@/components/features/TodaySessionsList";
import { WorkoutInsightBanner } from "@/components/features/WorkoutInsightBanner";
import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { todayActions, type TodayAction } from "@/lib/home/today-actions";
import type { WidgetSize } from "@/lib/home/widgets/types";
import Link from "next/link";
import { TodayMore } from "./TodayMore";

/**
 * Today (docs/home-widgets-audit.md, 6.7). L is the old home card, moved
 * unchanged; M is that card without the cycle header; S is the name, the
 * primary action and a "More" button with every other action. Critical: it
 * holds the start buttons, so its error state still links to /new-workout.
 */

export type TodayData = {
  cycle: { name: string; currentWeek: number; durationWeeks: number; progressPct: number; endFormatted: string } | null;
  todayProgram: { id: number; name: string } | null;
  todaySessions: HomeCore["todaySessions"];
  severalToday: boolean;
  completedToday: boolean;
  todayAutoSession: { id: number } | null;
  isRestDay: boolean;
  rotationOverdueDays: number;
  insight: HomeCore["insight"];
};

export function selectToday(core: HomeCore): TodayData {
  const info = core.info;
  return {
    cycle: info
      ? {
          name: info.cycle.name,
          currentWeek: info.currentWeek,
          durationWeeks: info.cycle.durationWeeks,
          progressPct: core.progressPct,
          endFormatted: core.endFormatted ?? "",
        }
      : null,
    todayProgram: core.todayProgram ? { id: core.todayProgram.id, name: core.todayProgram.name } : null,
    todaySessions: core.todaySessions,
    severalToday: core.severalToday,
    completedToday: core.completedToday,
    todayAutoSession: core.todayAutoSession,
    isRestDay: core.isRestDay,
    rotationOverdueDays: core.rotationOverdueDays,
    insight: core.insight,
  };
}

function DoneChip({ automatic }: { automatic: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded-full shrink-0">
      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {automatic ? "Done · automatic" : "Done"}
    </span>
  );
}

/** L and M with a cycle: the old home card; the cycle header only at L. */
function TodayCard({ data, size }: { data: TodayData; size: WidgetSize }) {
  const { cycle, todayProgram, todaySessions, severalToday, completedToday, todayAutoSession, isRestDay, rotationOverdueDays, insight } = data;
  if (!cycle) return null;
  return (
    <div className={`rounded-2xl p-4 shrink-0 ${completedToday ? "bg-emerald-500/10" : "bg-muted"}`} data-testid="today-card">
      {size === "l" && (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold">{cycle.name}</span>
            <span className="text-xs text-muted-foreground">Week {cycle.currentWeek}/{cycle.durationWeeks}</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${cycle.progressPct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">ends {cycle.endFormatted}</span>
          </div>
        </>
      )}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <p className="text-xl font-bold">
          {severalToday ? `${todaySessions.length} sessions today` : (todayProgram?.name ?? (isRestDay ? "Rest Day" : "No program today"))}
        </p>
        {completedToday && <DoneChip automatic={!!todayAutoSession} />}
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
  );
}

const SET_UP_LINK = (
  <Link
    href="/cycles"
    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary active:opacity-70"
  >
    Set up a Cycle →
  </Link>
);

/** No cycle. L: the preview of the cycle layout, as before; M and S: the prompt and the link. */
function NoCycle({ size }: { size: WidgetSize }) {
  if (size !== "l") {
    return (
      <div className="rounded-2xl bg-muted p-4 shrink-0 h-full" data-testid="cycle-setup">
        <p className="text-sm text-muted-foreground">
          {size === "s" ? "No training cycle yet." : "Set up a training cycle to plan which program you run each day."}
        </p>
        {SET_UP_LINK}
      </div>
    );
  }
  return (
    // Mirrors the shape of the real today card so the screen shows what a
    // cycle gives you instead of sitting empty. The cycle name, week counter
    // and program line are placeholders: aria-hidden keeps that invented text
    // out of the accessibility tree, and the prompt below carries the meaning.
    <div className="rounded-2xl bg-muted p-4 shrink-0" data-testid="cycle-setup">
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
        {SET_UP_LINK}
      </div>
    </div>
  );
}

function ActionLink({ a }: { a: Extract<TodayAction, { kind: "link" }> }) {
  return (
    <Link
      href={a.href}
      prefetch={a.href.startsWith("/programs/")}
      aria-label={a.ariaLabel}
      className={
        a.primary
          ? "inline-flex min-h-11 min-w-0 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
          : "inline-flex min-h-11 min-w-0 items-center rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground active:opacity-70"
      }
    >
      <span className="truncate">{a.label}</span>
    </Link>
  );
}

/** S with a cycle: the name, the primary action, and "More". */
function TodaySmall({ data }: { data: TodayData }) {
  const { primary, more } = todayActions({ ...data, hasCycle: true });
  const name = data.severalToday
    ? `${data.todaySessions.length} sessions today`
    : (data.todayProgram?.name ?? (data.isRestDay ? "Rest Day" : "No program today"));
  return (
    <div className={`rounded-2xl p-3 h-full flex flex-col justify-between gap-2 ${data.completedToday ? "bg-emerald-500/10" : "bg-muted"}`} data-testid="today-card">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today</p>
        <p className="text-base font-bold truncate">{name}</p>
        {data.completedToday && <DoneChip automatic={!!data.todayAutoSession} />}
      </div>
      <div className="flex items-center gap-2">
        {primary?.kind === "link" && <ActionLink a={primary} />}
        {more.length > 0 && <TodayMore actions={more} />}
      </div>
    </div>
  );
}

export function TodayError() {
  return (
    <div className="rounded-2xl bg-muted p-4 h-full" role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground mb-3">Couldn&apos;t load this.</p>
      <Link
        href="/new-workout"
        className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-80"
      >
        Start a Workout
      </Link>
    </div>
  );
}

export const todayWidget = defineWidget<TodayData>({
  select: selectToday,
  View: ({ data, size }) => {
    if (!data.cycle) return <NoCycle size={size} />;
    return size === "s" ? <TodaySmall data={data} /> : <TodayCard data={data} size={size} />;
  },
  // Today always has data: the no-cycle variant is part of View.
  Empty: ({ size }) => <NoCycle size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Today" size={size} lines={3} />,
  Preview: ({ size }) => <PreviewBox title="Today" size={size} lines={3} />,
  Error: TodayError,
});
