"use client";

import { afterTrainingRow, toRows, type ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { Fragment, type ReactNode } from "react";

/**
 * The home screen's layout (docs/home-widgets-audit.md, 6.9). Widget content
 * is rendered on the server and arrives in `slots`; this places it. Rows: two
 * consecutive S widgets share a row, M and L take a full row, and the last
 * widget stretches to fill the screen when its def says so (Week), as the old
 * page did. The content scrolls when it is taller than the screen.
 */
export type HomeGridProps = {
  items: ResolvedItem[];
  /** The title widget, rendered. */
  title: ReactNode;
  slots: Partial<Record<WidgetId, ReactNode>>;
  topNotices: ReactNode;
  afterTraining: ReactNode;
  /** The pinned start bar, or null when the user has a cycle. */
  startBar: ReactNode;
};

const SR_TITLE = (
  <h1 className="sr-only" data-testid="home-title">
    LogEveryLift
  </h1>
);

export function HomeGrid({ items, title, slots, topNotices, afterTraining, startBar }: HomeGridProps) {
  const titleShown = items.some((i) => i.id === "title" && !i.hidden);
  // A widget with nothing to show today (Endurance today on a rest day) takes no row.
  const rows = toRows(items.filter((i) => slots[i.id] != null));
  const after = afterTrainingRow(rows);

  return (
    <>
      {titleShown ? <div className="px-6 pt-6 pb-3 shrink-0">{title}</div> : <div className="pt-6 shrink-0">{SR_TITLE}</div>}

      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 overflow-y-auto pb-4" data-testid="home-content">
        {topNotices}
        {after < 0 && afterTraining}
        {rows.map((row, n) => {
          const last = n === rows.length - 1;
          const stretch = last && !row.half && widgetDef(row.ids[0]).stretch;
          return (
            <Fragment key={row.ids.join("+")}>
              {row.half ? (
                <div className="grid grid-cols-2 gap-3 shrink-0">
                  {row.ids.map((id) => (
                    <div key={id} className="min-w-0" data-widget={id}>
                      {slots[id]}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={stretch ? "grow shrink-0 basis-auto flex flex-col" : "shrink-0 flex flex-col"} data-widget={row.ids[0]}>
                  {slots[row.ids[0]]}
                </div>
              )}
              {n === after && afterTraining}
            </Fragment>
          );
        })}
      </div>

      {startBar}
    </>
  );
}
