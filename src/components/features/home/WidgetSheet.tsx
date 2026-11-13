"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetSize } from "@/lib/home/widgets/types";
import { ArrowDown, ArrowUp, Lock, Minus } from "lucide-react";

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
    "min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium active:opacity-70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return (
    <BottomSheet open={item !== null} onClose={onClose}>
      {item && def && (
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4" data-testid="widget-sheet">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{def.title}</h2>
            <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold text-primary active:opacity-60">
              Close
            </button>
          </div>

          {def.sizes.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" id="widget-size">
                Size
              </p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="widget-size">
                {def.sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={item.size === s}
                    onClick={() => onResize(item.id, s)}
                    className={`${btn} ${item.size === s ? "bg-primary text-primary-foreground border-primary" : ""}`}
                  >
                    {SIZE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {index >= 0 && (
            <div className="grid grid-cols-2 gap-2">
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
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="cant-hide">
              <Lock className="h-4 w-4" aria-hidden />
              Can&apos;t be hidden: it holds the start buttons.
            </p>
          ) : (
            <button type="button" onClick={() => onHide(item.id)} className={`${btn} w-full text-destructive`}>
              <Minus className="h-4 w-4" aria-hidden />
              Hide
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
