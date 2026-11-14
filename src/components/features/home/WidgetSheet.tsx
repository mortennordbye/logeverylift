"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetSize } from "@/lib/home/widgets/types";
import { ArrowDown, ArrowUp, Lock, Minus } from "lucide-react";
import { HOME_UI } from "./fonts";

/**
 * What a tap on a widget opens in edit mode: its size (the grid behind
 * changes at once), Move up and Move down (the single-pointer alternative to
 * dragging, WCAG 2.5.7), and Hide. The title cannot move; Today and Endurance
 * today cannot be hidden.
 */
export function WidgetSheet({
  item,
  index,
  count,
  onClose,
  onResize,
  onMove,
  onHide,
}: {
  item: ResolvedItem | null;
  /** Place among the movable widgets, or -1 for the title. */
  index: number;
  count: number;
  onClose: () => void;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  onMove: (id: WidgetId, dir: "up" | "down") => void;
  onHide: (id: WidgetId) => void;
}) {
  const def = item ? widgetDef(item.id) : null;
  const btn =
    "min-h-12 inline-flex items-center justify-center gap-1.5 rounded-[14px] bg-widget ring-1 ring-inset ring-hairline px-3 text-[15px] font-semibold active:opacity-60 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";
  return (
    <BottomSheet open={item !== null} onClose={onClose}>
      {item && def && (
        <div className={`${HOME_UI} bg-sheet rounded-t-[28px] px-4 pt-2 pb-8`} data-testid="widget-sheet">
          <div className="mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-muted-foreground/50" aria-hidden />
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="home-display text-[24px]">{def.title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-full bg-widget-2 px-4 text-[15px] font-semibold active:scale-[0.94] transition-transform"
            >
              Close
            </button>
          </div>

          {def.sizes.length > 1 && (
            <div className="mb-3.5">
              <p className="mb-2 text-xs font-medium text-muted-foreground" id="widget-size">
                Size
              </p>
              <div className="grid grid-cols-3 gap-2.5" role="group" aria-labelledby="widget-size">
                {SIZES.map((s) => {
                  const offered = def.sizes.includes(s);
                  const on = item.size === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      disabled={!offered}
                      onClick={() => onResize(item.id, s)}
                      className={`min-h-24 flex flex-col items-center justify-center gap-2 rounded-2xl bg-widget text-[13px] font-semibold ring-inset disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                        on ? "ring-2 ring-brand text-brand" : "ring-1 ring-hairline"
                      }`}
                    >
                      <Glyph size={s} on={on} />
                      {SIZE_LABEL[s]}
                      {!offered && <span className="text-[10px] font-medium text-muted-foreground">Not offered</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {index >= 0 && (
            <div className="mb-2.5 grid grid-cols-2 gap-2.5">
              <button type="button" disabled={index === 0} onClick={() => onMove(item.id, "up")} className={btn}>
                <ArrowUp className="h-4 w-4" aria-hidden />
                Move up
              </button>
              <button type="button" disabled={index === count - 1} onClick={() => onMove(item.id, "down")} className={btn}>
                <ArrowDown className="h-4 w-4" aria-hidden />
                Move down
              </button>
            </div>
          )}

          {def.critical ? (
            <p className="flex items-center justify-center gap-1.5 p-1.5 text-xs font-medium text-muted-foreground" data-testid="cant-hide">
              <Lock className="h-4 w-4" aria-hidden />
              Can&apos;t be hidden: it holds the start buttons.
            </p>
          ) : (
            <button type="button" onClick={() => onHide(item.id)} className={`${btn} w-full text-muted-foreground`}>
              <Minus className="h-4 w-4" aria-hidden />
              Hide
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

const SIZES: WidgetSize[] = ["s", "m", "l"];

/** The size's shape on a two-column grid: S one cell, M a row, L a tall row. */
function Glyph({ size, on }: { size: WidgetSize; on: boolean }) {
  const fill = on ? "bg-current" : "bg-muted-foreground";
  const faint = "bg-muted-foreground/30";
  return (
    <span className="grid w-11 grid-cols-2 gap-[3px]" aria-hidden>
      {size === "s" ? (
        <>
          <i className={`h-3.5 rounded ${fill}`} />
          <i className={`h-3.5 rounded ${faint}`} />
        </>
      ) : (
        <i className={`col-span-2 rounded ${fill} ${size === "l" ? "h-[31px]" : "h-3.5"}`} />
      )}
    </span>
  );
}
