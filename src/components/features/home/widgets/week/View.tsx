import { WeeklyGoalProgress } from "@/components/features/WeeklyGoalProgress";
import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { weekDayMarks } from "@/lib/utils/planned-sessions";
import Link from "next/link";

/**
 * The week: the old week strip, rotation strip or no-cycle strip, moved
 * unchanged. L (the default) has the weekly goal ring under it, M is the
 * strip alone. It stretches to fill the screen when it is the last widget.
 */

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_LABELS_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type WeekData = { core: HomeCore };

function Goal({ core, center = false }: { core: HomeCore; center?: boolean }) {
  return (
    <div className={center ? "border-t border-border/30 pt-3 flex-1 flex flex-col justify-center min-h-0" : "border-t border-border/30 pt-3"}>
      <WeeklyGoalProgress thisWeekWorkouts={core.stats.thisWeekWorkouts} />
    </div>
  );
}

function WeekView({ core, ring }: { core: HomeCore; ring: boolean }) {
  const { info, weekDates, todayStr, completedDates, weekPlanned } = core;

  if (info?.cycle.scheduleType === "day_of_week") {
    const blockStart = info.cycle.startDate ?? "";
    const blockEnd = info.endDate ?? "";
    const plannedOn = (date: string) => (weekPlanned ? weekPlanned.filter((p) => p.date === date) : null);
    const slotByDay = Object.fromEntries(
      info.cycle.slots.filter((s) => s.dayOfWeek !== null).map((s) => [s.dayOfWeek!, s]),
    );
    return (
      <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden" data-testid="week-strip">
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
        {ring && <Goal core={core} />}
      </div>
    );
  }

  if (info?.cycle.scheduleType === "rotation") {
    return (
      <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden" data-testid="rotation-strip">
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
        {ring && <Goal core={core} />}
      </div>
    );
  }

  // No cycle: days a cycle would schedule are dashed placeholders, but a day
  // the user has actually trained still reads as completed — real progress
  // must not disappear behind the preview.
  return (
    <div className="rounded-2xl bg-muted px-4 pt-3 pb-5 flex-1 flex flex-col gap-3 overflow-hidden" data-testid="week-strip">
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
      {/* Centred in the leftover space: without a cycle this card has less to
          show, so a top-aligned ring leaves a void beneath it. */}
      {ring && <Goal core={core} center />}
    </div>
  );
}

export const weekWidget = defineWidget<WeekData>({
  select: (core) => ({ core }),
  View: ({ data, size }) => <WeekView core={data.core} ring={size === "l"} />,
  Empty: ({ size }) => <PreviewBox title="Week" size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Week" size={size} />,
  Preview: ({ size }) => <PreviewBox title="Week" size={size} lines={1} />,
});
