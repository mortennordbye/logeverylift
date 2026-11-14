import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_PRS } from "@/components/features/home/samples";
import { Cap, Card, Label, Num, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { Trophy } from "lucide-react";
import { loadRecentPrs, type RecentPr } from "./load";

/** Recent PRs: S the newest, M the last 3, L the last 6. The whole card opens the Records tab. */

const COUNT = { s: 1, m: 3, l: 6 } as const;
const HREF = "/more/metrics?tab=records";

/** "82.5 kg" as a number and a unit, for the big figure; anything else stays one string. */
function splitValue(value: string): { n: string; unit: string } | null {
  const m = /^([\d.,]+) (kg|km|mi|m|yd)$/.exec(value);
  return m ? { n: m[1], unit: m[2] } : null;
}

const TrophyChip = ({ small = false }: { small?: boolean }) => (
  <span className={`grid shrink-0 place-items-center bg-widget-2 text-brand ${small ? "h-[30px] w-[30px] rounded-[10px]" : "h-[38px] w-[38px] rounded-xl"}`} aria-hidden>
    <Trophy className={small ? "h-4 w-4" : "h-[22px] w-[22px]"} />
  </span>
);

export const recentPrsWidget: Renderer<RecentPr[]> = defineWidget<RecentPr[]>({
  load: loadRecentPrs,
  View: ({ data, size }) => {
    if (size === "s") {
      const pr = data[0];
      const big = splitValue(pr.value);
      return (
        <Card href={HREF} testId="recent-prs">
          <div className="flex items-start justify-between">
            <TrophyChip />
            <Cap>{pr.date}</Cap>
          </div>
          <div className="mt-auto min-w-0">
            <p className="text-xs font-semibold text-pos">New PR</p>
            <p className="mt-px mb-1 truncate text-sm font-semibold">{pr.exercise}</p>
            {big ? (
              <Num size={38} unit={big.unit}>
                {big.n}
              </Num>
            ) : (
              <p className="home-display truncate text-[26px]">{pr.value}</p>
            )}
          </div>
        </Card>
      );
    }
    return (
      <Card href={HREF} testId="recent-prs">
        <Label icon={<Trophy />} more="All">
          Recent PRs
        </Label>
        <ul className="mt-1.5 flex flex-col">
          {data.slice(0, COUNT[size]).map((pr) => (
            <li key={pr.id} className="flex items-center gap-2.5 border-t border-hairline py-[7px] first:border-t-0">
              <TrophyChip small />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{pr.exercise}</span>
                <Cap className="truncate">
                  {pr.kind} · {pr.date}
                </Cap>
              </span>
              <span className="home-display shrink-0 text-[19px]">{pr.value}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  },
  Empty: () => (
    <Card testId="recent-prs">
      <Label icon={<Trophy />}>Recent PRs</Label>
      <p className="mt-2 text-sm text-muted-foreground">No PRs yet. Log a workout to set your first.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Recent PRs" size={size} lines={3} />,
  Sample: ({ size }) => recentPrsWidget.View({ data: SAMPLE_PRS, size }),
});
