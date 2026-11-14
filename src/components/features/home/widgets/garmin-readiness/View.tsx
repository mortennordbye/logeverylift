import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_READINESS } from "@/components/features/home/samples";
import { Card, Cap, Label, Num, Ring, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { CONTRIBUTOR_LABEL, READINESS_BAND_LABEL, type Readiness } from "@/lib/garmin/analytics/readiness";
import { Activity } from "lucide-react";
import Link from "next/link";
import { loadGarminReadiness, type GarminReadinessData } from "./load";

/**
 * Garmin readiness (admins only): S the score ring, the word and two
 * contributors; M a bigger ring and up to four. The one place besides PR
 * gains that uses the "good" colour.
 */

const HREF = "/more/garmin?tab=day";
const SHORT: Partial<Record<keyof typeof CONTRIBUTOR_LABEL, string>> = { restingHr: "RHR", sleep: "Sleep" };

/** One contributor: its score out of 100 as a bar, good above the middle. */
function Bars({ r, n }: { r: Readiness; n: number }) {
  return (
    <ul className="flex flex-col gap-[7px]">
      {r.contributors.slice(0, n).map((c) => {
        const label = CONTRIBUTOR_LABEL[c.key];
        return (
          <li key={c.key} className="grid grid-cols-[44px_1fr_28px] items-center gap-2 text-xs font-semibold">
            <span className="truncate text-muted-foreground">{SHORT[c.key] ?? label}</span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-widget-2" role="img" aria-label={`${label} ${c.score} of 100`}>
              <i className={`home-growx block h-full rounded-full ${c.score >= 50 ? "bg-pos" : "bg-muted-foreground"}`} style={{ width: `${c.score}%` }} />
            </span>
            <span className="text-right">{c.score}</span>
          </li>
        );
      })}
    </ul>
  );
}

const good = (r: Readiness) => r.band === "go_hard" || r.band === "as_planned";

export const garminReadinessWidget: Renderer<GarminReadinessData> = defineWidget<GarminReadinessData>({
  load: loadGarminReadiness,
  View: ({ data, size }) => {
    if (!data.connected) {
      return (
        <Card testId="garmin-readiness">
          <Label icon={<Activity />}>Readiness</Label>
          <Link href="/more/garmin" className="mt-auto min-h-11 inline-flex items-center text-[15px] font-semibold text-brand active:opacity-60">
            Connect Garmin
          </Link>
        </Card>
      );
    }
    const r = data.readiness;
    if (!r) {
      return (
        <Card href={HREF} testId="garmin-readiness">
          <Label icon={<Activity />}>Readiness</Label>
          <p className="mt-auto text-sm text-muted-foreground">Not enough signals for today yet.</p>
        </Card>
      );
    }
    const band = <p className={`text-sm font-bold ${good(r) ? "text-pos" : "text-muted-foreground"}`}>{READINESS_BAND_LABEL[r.band]}</p>;
    if (size === "s") {
      return (
        <Card href={HREF} testId="garmin-readiness">
          <Label icon={<Activity />}>Readiness</Label>
          <div className="mt-2 mb-2.5 flex items-center gap-2.5">
            <Ring size={62} stroke={7} pct={r.score / 100} color="var(--pos)">
              <Num size={26}>{r.score}</Num>
            </Ring>
            <div className="min-w-0">{band}</div>
          </div>
          <div className="mt-auto">
            <Bars r={r} n={2} />
          </div>
        </Card>
      );
    }
    return (
      <Card href={HREF} testId="garmin-readiness">
        <Label icon={<Activity />} more="Garmin">
          Readiness
        </Label>
        <div className="mt-1.5 flex flex-1 items-center gap-4">
          <Ring size={96} stroke={9} pct={r.score / 100} color="var(--pos)">
            <Num size={38}>{r.score}</Num>
          </Ring>
          <div className="min-w-0 flex-1 space-y-2">
            {band}
            <Bars r={r} n={4} />
            <Cap>
              {r.signals} of 6 signals{r.capped ? " · capped" : ""}
            </Cap>
          </div>
        </div>
      </Card>
    );
  },
  Empty: () => null,
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => garminReadinessWidget.View({ data: SAMPLE_READINESS, size }),
});
