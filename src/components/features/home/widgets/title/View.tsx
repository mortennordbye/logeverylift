import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";
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
    date: `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    cycleWeek: core.info ? `Week ${core.info.currentWeek} of ${core.info.cycle.durationWeeks}` : null,
  };
}

const H1 = <h1 className="text-2xl font-bold tracking-tight text-center" data-testid="home-title">LogEveryLift</h1>;

export const titleWidget = defineWidget<TitleData>({
  select: selectTitle,
  View: ({ data, size }) =>
    size === "l" ? (
      <div className="text-center">
        {H1}
        <p className="text-sm text-muted-foreground mt-0.5">
          {data.date}
          {data.cycleWeek && ` · ${data.cycleWeek}`}
        </p>
      </div>
    ) : (
      H1
    ),
  Empty: () => H1,
  Skeleton: () => H1,
  Preview: ({ size }) => <PreviewBox title="LogEveryLift" size={size} lines={0} />,
});
