import { EnduranceTodayCard, type EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import { SAMPLE_ENDURANCE } from "@/components/features/home/samples";
import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { CARD, PreviewBox } from "@/components/features/home/widget-ui";
import Link from "next/link";

/**
 * Endurance today: the old card, as is. Critical: the guided player starts
 * here, so its error state links to /new-workout.
 *
 * With no session today the card renders nothing, as it did before the widget
 * system: an empty line here would change the home of every endurance user on
 * a rest day. Edit mode shows the static preview, so the widget is still
 * there to move.
 */

export const enduranceTodayWidget: Renderer<EnduranceTodayRow[]> = defineWidget<EnduranceTodayRow[]>({
  select: (core) => (core.endurance && core.endurance.today.length > 0 ? core.endurance.today : null),
  View: ({ data }) => <EnduranceTodayCard rows={data} />,
  Empty: () => null,
  Skeleton: ({ size }) => <PreviewBox title="Endurance today" size={size} />,
  Preview: ({ size }) => enduranceTodayWidget.View({ data: SAMPLE_ENDURANCE, size }),
  Error: () => (
    <div className={CARD} role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground mb-3">Couldn&apos;t load this.</p>
      <div className="flex gap-2 flex-wrap">
        <Link href="/week" className="inline-flex min-h-11 items-center rounded-[14px] bg-widget-2 px-4 text-sm font-semibold active:scale-[0.97] transition-transform">
          This week
        </Link>
        <Link
          href="/new-workout"
          className="inline-flex min-h-11 items-center rounded-[14px] bg-brand-fill px-4 text-sm font-semibold text-white active:scale-[0.97] transition-transform"
        >
          Start a Workout
        </Link>
      </div>
    </div>
  ),
});
