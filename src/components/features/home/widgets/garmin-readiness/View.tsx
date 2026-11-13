import { defineWidget } from "@/components/features/home/define-widget";
import { Contributors } from "@/components/features/garmin/GarminUi";
import { PreviewBox, WidgetCard, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { READINESS_BAND_LABEL } from "@/lib/garmin/analytics/readiness";
import Link from "next/link";
import { loadGarminReadiness, type GarminReadinessData } from "./load";

/** Garmin readiness (admins only): S the score and word, M with the contributor bars. */

const HREF = "/more/garmin?tab=day";

export const garminReadinessWidget = defineWidget<GarminReadinessData>({
  load: loadGarminReadiness,
  View: ({ data, size }) => {
    if (!data.connected) {
      return (
        <WidgetCard title="Readiness" testId="garmin-readiness">
          <Link href="/more/garmin" className="min-h-11 inline-flex items-center text-sm text-primary active:opacity-70">
            Connect Garmin
          </Link>
        </WidgetCard>
      );
    }
    const r = data.readiness;
    if (!r) {
      return (
        <WidgetCard title="Readiness" href={HREF} linkLabel="Today →" testId="garmin-readiness">
          <p className="text-sm text-muted-foreground">Not enough signals for today yet.</p>
        </WidgetCard>
      );
    }
    if (size === "s") {
      return (
        <Link href={HREF} className="rounded-2xl bg-muted p-3 h-full flex flex-col justify-between active:opacity-70" data-testid="garmin-readiness">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Readiness</span>
          <span className="text-4xl font-semibold leading-none tabular-nums">{r.score}</span>
          <span className="text-sm font-semibold">{READINESS_BAND_LABEL[r.band]}</span>
        </Link>
      );
    }
    return (
      <WidgetCard title="Readiness" href={HREF} linkLabel="Today →" testId="garmin-readiness">
        <div className="flex items-end gap-3">
          <span className="text-5xl font-semibold leading-none tabular-nums">{r.score}</span>
          <span className="pb-1 text-base font-semibold">{READINESS_BAND_LABEL[r.band]}</span>
          <span className="pb-1 ml-auto text-[11px] text-muted-foreground">
            {r.signals} of 6 signals{r.capped ? " · capped" : ""}
          </span>
        </div>
        <Contributors readiness={r} />
      </WidgetCard>
    );
  },
  Empty: () => null,
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Garmin readiness" size={size} />,
});
