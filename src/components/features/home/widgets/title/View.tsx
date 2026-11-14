import { defineWidget } from "@/components/features/home/define-widget";
import type { HomeCore } from "@/lib/home/core";

/**
 * The title row (header kind). M is the old "LogEveryLift" heading; L adds
 * today's date and the cycle week. Labels are built here, on the server, with
 * fixed names rather than toLocale*, so the client never formats a date.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type TitleData = { date: string; cycleWeek: string | null };

export function selectTitle(core: HomeCore): TitleData {
  const d = core.today;
  return {
    date: `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    cycleWeek: core.info ? `Week ${core.info.currentWeek} of ${core.info.cycle.durationWeeks}` : null,
  };
}

/** The heading: Big Shoulders, in capitals (CSS only, so its name stays "LogEveryLift"). */
const H1 = (
  <h1 className="home-display text-[38px] uppercase leading-[1.1]" data-testid="home-title">
    LogEveryLift
  </h1>
);

export const titleWidget = defineWidget<TitleData>({
  select: selectTitle,
  View: ({ data, size }) =>
    size === "l" ? (
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {data.date}
          {data.cycleWeek && ` · ${data.cycleWeek}`}
        </p>
        {H1}
      </div>
    ) : (
      H1
    ),
  Empty: () => H1,
  Skeleton: () => H1,
  Preview: ({ size }) => (
    <div aria-hidden="true" className="px-1">
      {size === "l" && <div className="mb-1.5 h-2.5 w-36 rounded-full bg-widget-2" />}
      <p className="home-display text-[38px] uppercase leading-[1.1]">LogEveryLift</p>
    </div>
  ),  Sample: ({ size }) => (
    <div aria-hidden="true" className="px-1">
      {size === "l" && <div className="mb-1.5 h-2.5 w-36 rounded-full bg-widget-2" />}
      <p className="home-display text-[38px] uppercase leading-[1.1]">LogEveryLift</p>
    </div>
  ),
});
