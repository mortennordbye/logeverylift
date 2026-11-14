import { EnduranceTodayCard, type EnduranceTodayRow } from "@/components/features/guided/EnduranceTodayCard";
import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";
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

export const enduranceTodayWidget = defineWidget<EnduranceTodayRow[]>({
  select: (core) => (core.endurance && core.endurance.today.length > 0 ? core.endurance.today : null),
  View: ({ data }) => <EnduranceTodayCard rows={data} />,
  Empty: () => null,
  Skeleton: ({ size }) => <PreviewBox title="Endurance today" size={size} />,
  Preview: ({ size }) => <PreviewBox title="Endurance today" size={size} />,
  Error: () => (
    <div className="rounded-2xl bg-muted p-4" role="status" data-testid="widget-error">
      <p className="text-sm text-muted-foreground mb-3">Couldn&apos;t load this.</p>
      <div className="flex gap-2 flex-wrap">
        <Link href="/week" className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium active:opacity-70">
          This week
        </Link>
        <Link
          href="/new-workout"
          className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-80"
        >
          Start a Workout
        </Link>
      </div>
    </div>
  ),
});
