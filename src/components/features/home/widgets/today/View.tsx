import { SkipAutoDayButton } from "@/components/features/SkipAutoDayButton";
import { SAMPLE_TODAY } from "@/components/features/home/samples";
import { TodaySessionsList } from "@/components/features/TodaySessionsList";
import { WorkoutInsightBanner } from "@/components/features/WorkoutInsightBanner";
import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { CARD, PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { todayActions, type TodayAction } from "@/lib/home/today-actions";
import type { WidgetSize } from "@/lib/home/widgets/types";
import { ArrowLeftRight, Check, Play, Sparkles } from "lucide-react";
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
    <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-white/20 px-2 py-0.5 rounded-full shrink-0">
      <Check className="w-3 h-3" strokeWidth={3} aria-hidden />
      {automatic ? "Done · automatic" : "Done"}
    </span>
  );
}

/** The hero surface: the brand fill, white text, and the hero token mapping for the shared parts inside. */
const HERO = "home-hero relative flex flex-col h-full overflow-hidden rounded-widget bg-brand-fill p-4 ring-1 ring-inset ring-white/5";
/** The white start button (54 px), and the quieter white-on-blue ones. */
const START =
  "flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[18px] bg-white px-4 text-[17px] font-bold text-brand-fill transition-transform active:scale-[0.97]";
const SOFT =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-white/15 px-4 text-[15px] font-semibold text-white transition-transform active:scale-[0.97]";
const GHOST = "flex min-h-11 items-center justify-center gap-1 text-[15px] font-semibold text-white/85 active:opacity-60";

/** One bar segment per cycle week: done weeks white, this week half, the rest faint. A long cycle gets one bar. */
function WeekSegments({ current, total }: { current: number; total: number }) {
  if (total > 16) {
    return (
      <div className="mt-2 mb-3.5 h-[5px] rounded-[3px] bg-white/20 overflow-hidden" aria-hidden>
        <div className="h-full bg-white" style={{ width: `${Math.min(100, ((current - 0.5) / total) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div className="mt-2 mb-3.5 flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`relative h-[5px] flex-1 overflow-hidden rounded-[3px] ${i < current - 1 ? "bg-white" : "bg-white/20"}`}>
          {i === current - 1 && <span className="absolute inset-y-0 left-0 w-1/2 rounded-[3px] bg-white" />}
        </i>
      ))}
    </div>
  );
}

function todayName(d: TodayData): string {
  return d.severalToday ? `${d.todaySessions.length} sessions today` : (d.todayProgram?.name ?? (d.isRestDay ? "Rest Day" : "No program today"));
}

/** L and M with a cycle. L has the cycle header with a segment per week; M starts at the name. */
function TodayCard({ data, size }: { data: TodayData; size: WidgetSize }) {
  const { cycle, todayProgram, todaySessions, severalToday, completedToday, todayAutoSession, rotationOverdueDays, insight } = data;
  if (!cycle) return null;
  const startNow = !severalToday && todayProgram && !completedToday;
  return (
    <div className={HERO} data-testid="today-card">
      {size === "l" && (
        <>
          <div className="flex items-center justify-between gap-2 text-[13px] font-semibold opacity-90">
            <span className="truncate">{cycle.name}</span>
            <span className="shrink-0">
              Week {cycle.currentWeek} of {cycle.durationWeeks}
            </span>
          </div>
          <WeekSegments current={cycle.currentWeek} total={cycle.durationWeeks} />
        </>
      )}
      <p className="text-[13px] font-semibold uppercase tracking-[0.05em] opacity-75">Today</p>
      <div className="flex items-center gap-2 flex-wrap mt-0.5 mb-1">
        <p className="home-display text-[34px] uppercase leading-[1.05] min-w-0 break-words">{todayName(data)}</p>
        {completedToday && <DoneChip automatic={!!todayAutoSession} />}
        {!completedToday && rotationOverdueDays > 0 && todayProgram && (
          <span className="inline-flex items-center text-xs font-bold text-white bg-white/20 px-2 py-0.5 rounded-full shrink-0">
            {rotationOverdueDays === 1 ? "1 day overdue" : `${rotationOverdueDays} days overdue`}
          </span>
        )}
      </div>
      {size === "l" && cycle.endFormatted && <p className="text-sm font-medium opacity-80">Cycle ends {cycle.endFormatted}</p>}
      {insight && (
        <div className="mt-3 [&>div]:mb-0">
          <WorkoutInsightBanner insight={insight} />
        </div>
      )}
      <div className="flex-1 min-h-3" />
      {severalToday ? (
        <>
          <div className="mt-3">
            <TodaySessionsList sessions={todaySessions} />
          </div>
          <Link href="/new-workout" className={GHOST}>
            Different Program
          </Link>
        </>
      ) : todayProgram ? (
        <div className="flex flex-col gap-1">
          {size === "m" && startNow ? (
            <div className="flex items-center gap-2.5">
              <Link href={`/programs/${todayProgram.id}/workout`} prefetch={true} className={START}>
                <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
                Start Today&apos;s Workout
              </Link>
              <Link href="/new-workout" aria-label="Different Program" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/85 active:opacity-60">
                <ArrowLeftRight className="h-5 w-5" aria-hidden />
              </Link>
            </div>
          ) : (
            <>
              {completedToday ? (
                <Link href={`/programs/${todayProgram.id}/workout`} prefetch={true} className={SOFT}>
                  {todayAutoSession ? "Log in app" : "Do Again"}
                </Link>
              ) : (
                <Link href={`/programs/${todayProgram.id}/workout`} prefetch={true} className={START}>
                  <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
                  Start Today&apos;s Workout
                </Link>
              )}
              {todayAutoSession && (
                <div className="flex justify-center [&>button]:min-h-11">
                  <SkipAutoDayButton sessionId={todayAutoSession.id} />
                </div>
              )}
              <Link href="/new-workout" className={GHOST}>
                Different Program
              </Link>
            </>
          )}
        </div>
      ) : (
        <Link href="/new-workout" className={SOFT}>
          {completedToday ? "Do Another Workout →" : "Start a Workout →"}
        </Link>
      )}
    </div>
  );
}

/** The no-cycle picture from the locked design: a calendar with three days done and a plus. */
function PlanArt({ width }: { width: number }) {
  return (
    <svg width={width} viewBox="0 0 132 96" fill="none" aria-hidden="true">
      <rect x="18" y="14" width="96" height="74" rx="16" fill="var(--widget-2)" />
      <rect x="18" y="14" width="96" height="20" rx="10" fill="var(--brand)" opacity=".9" />
      <rect x="18" y="26" width="96" height="8" fill="var(--brand)" opacity=".9" />
      {[0, 1, 2, 3].flatMap((c) =>
        [0, 1].map((r) => (
          <rect
            key={`${c}-${r}`}
            x={30 + c * 20}
            y={44 + r * 20}
            width="12"
            height="12"
            rx="4"
            fill={c + r * 4 < 3 ? "var(--brand)" : "color-mix(in oklab, var(--muted-foreground) 30%, transparent)"}
            opacity={c + r * 4 < 3 ? 0.85 : 1}
          />
        )),
      )}
      <circle cx="112" cy="16" r="13" fill="var(--foreground)" />
      <path d="M112 9.5v13M105.5 16h13" stroke="var(--widget)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M10 60l3 3M8 70h4" stroke="var(--muted-foreground)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const SET_UP_CLASS =
  "inline-flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-brand-fill px-[22px] text-base font-bold text-white transition-transform active:scale-[0.97]";

/** No cycle: the plan-a-block prompt, at each size. The only action is the cycle setup; the start bar below carries "Start a Workout". */
function NoCycle({ size }: { size: WidgetSize }) {
  if (size === "s") {
    return (
      <div className={`${CARD} items-center justify-center text-center p-3!`} data-testid="cycle-setup">
        <PlanArt width={84} />
        <p className="my-2 text-sm font-semibold">Plan your first block</p>
        <Link href="/cycles" aria-label="Set up a Cycle →" className={`${SET_UP_CLASS} w-full min-h-11! text-sm!`}>
          Set up
        </Link>
      </div>
    );
  }
  return (
    <div className={`${CARD} items-center justify-center text-center p-5!`} data-testid="cycle-setup">
      <PlanArt width={size === "l" ? 132 : 84} />
      <h2 className="home-display mt-3.5 mb-1.5 text-[30px]">Plan your first block</h2>
      <p className="mb-[18px] max-w-[270px] text-[15px] leading-snug text-muted-foreground">
        Set up a training cycle: it plans which program you run each day and tracks the weeks as you go.
      </p>
      <Link href="/cycles" className={SET_UP_CLASS}>
        <Sparkles className="h-[18px] w-[18px]" aria-hidden />
        Set up a Cycle →
      </Link>
    </div>
  );
}

function ActionLink({ a }: { a: Extract<TodayAction, { kind: "link" }> }) {
  return (
    <Link
      href={a.href}
      prefetch={a.href.startsWith("/programs/")}
      aria-label={a.ariaLabel ?? (a.short ? a.label : undefined)}
      className={
        a.primary
          ? "inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[16px] bg-white px-3 text-[15px] font-bold text-brand-fill active:scale-[0.97] transition-transform"
          : "inline-flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-[16px] bg-white/15 px-3 text-[15px] font-semibold text-white active:scale-[0.97] transition-transform"
      }
    >
      {a.primary && <Play className="h-4 w-4 shrink-0 fill-current" aria-hidden />}
      <span className="truncate">{a.short ?? a.label}</span>
    </Link>
  );
}

/** S with a cycle: the name, the primary action, and "More". */
function TodaySmall({ data }: { data: TodayData }) {
  const { primary, more } = todayActions({ ...data, hasCycle: true });
  return (
    <div className={`${HERO} p-3.5! gap-2`} data-testid="today-card">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold uppercase tracking-[0.05em] opacity-75">Today</p>
        <p className="home-display text-[24px] uppercase leading-[1.05] break-words line-clamp-2">{todayName(data)}</p>
        {data.completedToday && (
          <div className="mt-1">
            <DoneChip automatic={!!data.todayAutoSession} />
          </div>
        )}
      </div>
      <div className="mt-auto flex items-center gap-2">
        {primary?.kind === "link" && <ActionLink a={primary} />}
        {more.length > 0 && <TodayMore actions={more} />}
      </div>
    </div>
  );
}

export function TodayError() {
  return (
    <div className={CARD} role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground mb-3">Couldn&apos;t load this.</p>
      <Link
        href="/new-workout"
        className="inline-flex min-h-11 items-center self-start rounded-[14px] bg-brand-fill px-4 text-sm font-semibold text-white active:scale-[0.97] transition-transform"
      >
        Start a Workout
      </Link>
    </div>
  );
}

export const todayWidget: Renderer<TodayData> = defineWidget<TodayData>({
  select: selectToday,
  View: ({ data, size }) => {
    if (!data.cycle) return <NoCycle size={size} />;
    return size === "s" ? <TodaySmall data={data} /> : <TodayCard data={data} size={size} />;
  },
  // Today always has data: the no-cycle variant is part of View.
  Empty: ({ size }) => <NoCycle size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Today" size={size} lines={3} />,
  Preview: ({ size }) => todayWidget.View({ data: SAMPLE_TODAY, size }),
  Error: TodayError,
});
