import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import type { HomeCore } from "@/lib/home/core";
import { selectTitle } from "../title/View";

/**
 * Date (owner decision B, 2026-11-14): today's date in the user's zone, as
 * the locked design's eyebrow, "SATURDAY, 14 NOVEMBER". The label is built on
 * the server with fixed names (selectTitle), never Intl or toLocale*.
 */

type DateData = { label: string };

const Line = ({ label }: { label: string }) => (
  <p className="px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground" data-testid="date-widget">
    {label}
  </p>
);

export const dateWidget: Renderer<DateData> = defineWidget<DateData>({
  select: (core: HomeCore) => ({ label: selectTitle(core).date }),
  View: ({ data }) => <Line label={data.label} />,
  Empty: () => null,
  Skeleton: () => null,
  // Never a made-up date on the user's own home: an empty bar in edit mode.
  Preview: () => <div className="mx-1 h-3 w-40 rounded-full bg-widget-2" aria-hidden="true" />,
  // A fixed sample date for the gallery, the same for every user.
  Sample: () => <Line label="Friday, 13 November" />,
});
