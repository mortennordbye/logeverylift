import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_STREAK } from "@/components/features/home/samples";
import { Cap, Card, Label, Num, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { Zap } from "lucide-react";
import { loadStreak, type StreakData } from "./load";

/** Streak: S the weeks in a row with a flame; M adds sessions per week for the last 8. Opens Progress. */

const HREF = "/more/metrics";

/** The flame from the locked design, in the brand colour; it flickers unless motion is reduced. */
function Flame() {
  return (
    <svg className="h-14 w-[46px] shrink-0" viewBox="0 0 32 40" aria-hidden>
      <defs>
        <linearGradient id="home-flame-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: "var(--brand)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--brand) 55%, #fff)" }} />
        </linearGradient>
      </defs>
      <path
        className="home-flame"
        d="M16 1.5c1.2 6.5 9.5 10.5 9.5 20a9.5 9.5 0 0 1-19 0c0-4.6 2.2-7.8 4.6-10 0 3.4 1.2 5.6 3.4 6.8C13.6 12 14.6 6.6 16 1.5z"
        fill="url(#home-flame-grad)"
      />
      <path
        className="home-flame"
        d="M16 19c3.4 3 5.6 5.6 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-3 1.8-5 3.2-6.2 0 2 .9 3.2 2.2 3.4-.2-2.2-.2-4.4.2-6.6z"
        style={{ fill: "color-mix(in oklab, var(--brand) 25%, #fff)", animationDuration: "1.1s" }}
      />
    </svg>
  );
}

function Head({ weeks }: { weeks: number }) {
  return (
    <div className="mt-1.5 flex items-end gap-2.5">
      <Flame />
      <Num size={54}>{weeks}</Num>
    </div>
  );
}

const unit = (n: number) => (n === 1 ? "week in a row" : "weeks in a row");

export const streakWidget: Renderer<StreakData> = defineWidget<StreakData>({
  load: loadStreak,
  View: ({ data, size }) => {
    if (size === "s") {
      return (
        <Card href={HREF} testId="streak">
          <Label icon={<Zap />}>Streak</Label>
          <Head weeks={data.weeks} />
          <div className="mt-auto">
            <p className="text-sm font-semibold">{unit(data.weeks)}</p>
            <Cap>Train this week to keep it.</Cap>
          </div>
        </Card>
      );
    }
    const max = Math.max(1, ...data.perWeek);
    return (
      <Card href={HREF} testId="streak">
        <Label icon={<Zap />}>Streak</Label>
        <div className="flex flex-1 items-stretch gap-4">
          <div>
            <Head weeks={data.weeks} />
            <p className="mt-1.5 text-sm font-semibold">{unit(data.weeks)}</p>
          </div>
          <div className="flex flex-1 flex-col pt-2">
            <div className="flex flex-1 items-end gap-1" role="img" aria-label={`Sessions per week, last 8 weeks: ${data.perWeek.join(", ")}`}>
              {data.perWeek.map((n, i) => (
                <i
                  key={i}
                  className="home-grow block flex-1 rounded bg-brand"
                  style={{ height: `${Math.max(4, (n / max) * 100)}%`, opacity: n === 0 ? 0.25 : i === data.perWeek.length - 1 ? 0.55 : 1, ["--i" as string]: i }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs font-medium text-muted-foreground" aria-hidden>
              <span>8 wk ago</span>
              <span>Now</span>
            </div>
          </div>
        </div>
      </Card>
    );
  },
  Empty: () => (
    <Card href={HREF} testId="streak">
      <Label icon={<Zap />}>Streak</Label>
      <p className="mt-auto text-sm text-muted-foreground">No streak yet. Train this week to start one.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Streak" size={size} />,
  Sample: ({ size }) => streakWidget.View({ data: SAMPLE_STREAK, size }),
});
