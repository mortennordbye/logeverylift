import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_LAST_SESSION } from "@/components/features/home/samples";
import { Card, Label, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { MarkChip } from "@/components/features/session-check/SessionCheckSteps";
import type { LastSessionCard, LastSessionRow } from "@/lib/utils/last-session";
import { Gauge } from "lucide-react";
import Link from "next/link";
import { loadLastSession, type LastSessionData } from "./load";

/**
 * Last session (endurance): the last day with done bike or run sessions, one
 * card per session (a ride and its brick run are two). Each card names the
 * session and the Garmin activity it is matched to, and judges power, heart
 * rate, cadence or pace, and time over the work steps, with a link to the
 * step page (docs/plans/session-check.md, decision 9).
 */

const EMPTY_HREF = "/history";

function Row({ row }: { row: LastSessionRow }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-sm tabular-nums" data-testid="last-session-row">
      <span className="text-xs text-muted-foreground">{row.label}</span>
      <span className="truncate font-semibold">
        {row.value} <small className="text-xs font-normal text-muted-foreground">· {row.plan}</small>
      </span>
      <MarkChip mark={row.mark} />
    </div>
  );
}

function SessionCard({ card }: { card: LastSessionCard }) {
  return (
    <Card testId="last-session">
      <Label icon={<Gauge />}>Last session</Label>
      <p className="mt-1.5 truncate text-[15px] font-semibold">{card.title}</p>
      <p className="truncate text-xs text-muted-foreground" data-testid="last-session-match">
        {card.match}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {card.rows.map((r) => (
          <Row key={r.label} row={r} />
        ))}
        {card.time && <Row row={card.time} />}
      </div>
      {card.href && (
        <Link href={card.href} className="mt-auto inline-flex min-h-11 items-center self-start text-[15px] font-semibold text-brand active:opacity-60">
          See every step ›
        </Link>
      )}
    </Card>
  );
}

export const lastSessionWidget: Renderer<LastSessionData> = defineWidget<LastSessionData>({
  load: loadLastSession,
  View: ({ data }) => (
    <div className="flex flex-col gap-3">
      {data.cards.map((c) => (
        <SessionCard key={c.plannedSessionId} card={c} />
      ))}
    </div>
  ),
  Empty: () => (
    <Card href={EMPTY_HREF} testId="last-session">
      <Label icon={<Gauge />}>Last session</Label>
      <p className="mt-auto text-sm text-muted-foreground">No bike or run session done in the last 2 weeks.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Last session" size={size} lines={4} />,
  Sample: ({ size }) => lastSessionWidget.View({ data: SAMPLE_LAST_SESSION, size }),
});
