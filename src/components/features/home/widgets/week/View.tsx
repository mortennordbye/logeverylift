import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_WEEK_CORE } from "@/components/features/home/samples";
import { Card, Label, PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { weekDayMarks } from "@/lib/utils/planned-sessions";
import { CalendarDays, Check, X } from "lucide-react";
import { GoalLeft, GoalRing } from "./GoalRing";

/**
 * The week: the day strip (day-of-week cycle, no cycle) or the rotation, in
 * the locked look. L (the default) has the weekly goal ring beside the days
 * and a legend; M is the days alone. It stretches to fill the screen when it
 * is the last widget. The whole card opens the calendar.
 */

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_LABELS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type WeekData = { core: HomeCore };
type DayState = "done" | "missed" | "today" | "planned" | "rest";

const STATE_TEXT: Record<DayState, string> = { done: "done", missed: "missed", today: "today", planned: "planned", rest: "rest" };

function Dot({ state, label, inner }: { state: DayState; label: string; inner?: string }) {
  const base = "relative grid h-8 w-8 place-items-center rounded-full text-xs font-bold";
  const look: Record<DayState, string> = {
    done: "bg-brand-fill text-white",
    missed: "bg-widget-2 text-muted-foreground",
    today: "home-today-dot text-brand ring-2 ring-inset ring-brand",
    planned: "text-muted-foreground ring-[1.5px] ring-inset ring-muted-foreground/55",
    rest: "",
  };
  return (
    <span className={`${base} ${look[state]}`} role="img" aria-label={label}>
      {state === "done" && <Check className="h-[15px] w-[15px]" strokeWidth={3} aria-hidden />}
      {state === "missed" && <X className="h-[15px] w-[15px]" strokeWidth={3} aria-hidden />}
      {(state === "today" || state === "planned") && inner}
      {state === "rest" && <span className="h-[5px] w-[5px] rounded-full bg-muted-foreground/45" aria-hidden />}
    </span>
  );
}

function Days({ states }: { states: { date: string; state: DayState; count: number }[] }) {
  return (
    <div className="grid flex-1 grid-cols-7 gap-0.5 text-center">
      {states.map(({ date, state, count }, i) => (
        <div key={date} className="flex flex-col items-center gap-1.5">
          <small className={`text-[11px] font-semibold ${state === "today" ? "text-brand" : "text-muted-foreground"}`} aria-hidden>
            {DAY_LETTERS[i]}
          </small>
          <Dot
            state={state}
            label={`${DAY_LABELS_FULL[i]}: ${STATE_TEXT[state]}${count > 1 ? `, ${count} sessions` : ""}`}
            inner={state === "today" ? String(Number(date.slice(8))) : count > 1 ? String(count) : undefined}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The legend's words come from CSS (`content: attr(...)`): it is decoration
 * (aria-hidden), and as DOM text "Done" would clash with Today's "Done" chip
 * for anyone finding that by its text.
 */
function Legend() {
  const item = "flex items-center gap-[5px] text-[11px] font-medium text-muted-foreground after:content-[attr(data-label)]";
  return (
    <div className="mt-2.5 flex gap-3" aria-hidden>
      <span className={item} data-label="Done">
        <i className="h-2 w-2 rounded-full bg-brand-fill" />
      </span>
      <span className={item} data-label="Missed">
        <i className="h-2 w-2 rounded-full bg-muted-foreground" />
      </span>
      <span className={item} data-label="Planned">
        <i className="h-2 w-2 rounded-full ring-[1.5px] ring-inset ring-muted-foreground" />
      </span>
    </div>
  );
}

/** Each day's state: done, missed (a past planned day not done), today, planned, or rest. */
function dayStates(core: HomeCore): { date: string; state: DayState; count: number }[] {
  const { info, weekDates, todayStr, completedDates, weekPlanned } = core;
  const dow = info?.cycle.scheduleType === "day_of_week" ? info : null;
  const blockStart = dow?.cycle.startDate ?? "";
  const blockEnd = dow?.endDate ?? "";
  const slotByDay = dow ? Object.fromEntries(dow.cycle.slots.filter((s) => s.dayOfWeek !== null).map((s) => [s.dayOfWeek!, s])) : {};
  return weekDates.map((date, i) => {
    let hasProgram = false;
    let count = 0;
    if (dow) {
      const planned = weekPlanned ? weekPlanned.filter((p) => p.date === date) : null;
      const inBlock = date >= blockStart && date < blockEnd;
      ({ hasProgram, count } = weekDayMarks({ planned, inBlock, templateHasProgram: !!slotByDay[i + 1]?.program }));
    }
    const state: DayState = completedDates.has(date)
      ? "done"
      : date === todayStr
        ? "today"
        : hasProgram && date < todayStr
          ? "missed"
          : hasProgram
            ? "planned"
            : "rest";
    return { date, state, count };
  });
}

function WeekView({ core, ring }: { core: HomeCore; ring: boolean }) {
  const { info } = core;
  const done = core.stats.thisWeekWorkouts;
  const goalRing = ring && <GoalRing done={done} size={68} stroke={8} />;

  if (info?.cycle.scheduleType === "rotation") {
    return (
      <Card href="/more/calendar" testId="rotation-strip" className="flex-1">
        <Label icon={<CalendarDays />} more={ring ? <GoalLeft done={done} short /> : undefined}>
          Rotation
        </Label>
        <div className="mt-2 flex flex-1 items-center gap-3.5">
          {goalRing}
          <div className="flex flex-wrap gap-2">
            {[...info.cycle.slots]
              .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
              .map((slot) => (
                <span
                  key={slot.id}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    slot.id === info.todaySlot?.id ? "bg-brand-fill text-white" : "bg-widget-2 text-muted-foreground"
                  }`}
                >
                  {slot.program?.name ?? slot.label ?? "Rest"}
                </span>
              ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card href="/more/calendar" testId="week-strip" className="flex-1">
      <Label icon={<CalendarDays />} more={ring ? <GoalLeft done={done} short /> : undefined}>
        This week
      </Label>
      <div className="mt-2 flex flex-1 items-center gap-3.5">
        {goalRing}
        <Days states={dayStates(core)} />
      </div>
      {ring && info && <Legend />}
    </Card>
  );
}

export const weekWidget: Renderer<WeekData> = defineWidget<WeekData>({
  select: (core) => ({ core }),
  View: ({ data, size }) => <WeekView core={data.core} ring={size === "l"} />,
  Empty: ({ size }) => <PreviewBox title="Week" size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Week" size={size} />,
  Preview: ({ size }) => weekWidget.View({ data: { core: SAMPLE_WEEK_CORE }, size }),
});
