"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetGroup, type WidgetSize } from "@/lib/home/widgets/types";
import type { ReactNode } from "react";
import { HOME_UI } from "./fonts";
import type { Previews } from "./HomeEditGrid";

/**
 * "Add widget" (docs/home-widgets-audit.md, 6.9): the widgets this user can
 * have and does not show, grouped, each with its preview and sizes. Only
 * available widgets reach the client, so Garmin readiness never shows here
 * for a user without Garmin access.
 */

const GROUP_LABEL: Record<WidgetGroup, string> = {
  training: "Training",
  prs: "Personal records",
  stats: "Stats",
  garmin: "Garmin",
  friends: "Friends",
  actions: "Quick actions",
  coach: "Coach",
};

export function WidgetGallerySheet({
  open,
  onClose,
  hidden,
  previews,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  hidden: ResolvedItem[];
  previews: Previews;
  onAdd: (id: WidgetId) => void;
}) {
  const groups = new Map<WidgetGroup, ResolvedItem[]>();
  for (const item of hidden) {
    const g = widgetDef(item.id).group;
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className={`${HOME_UI} bg-sheet rounded-t-[28px] px-4 pt-2 pb-8 max-h-[80dvh] overflow-y-auto`} data-testid="widget-gallery">
        <div className="mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-muted-foreground/50" aria-hidden />
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="home-display text-[24px]">Add a widget</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full bg-widget-2 px-4 text-[15px] font-semibold active:scale-[0.94] transition-transform"
          >
            Close
          </button>
        </div>
        {hidden.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Every widget is on your home.</p>}
        {[...groups].map(([group, items]) => (
          <section key={group} className="mb-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{GROUP_LABEL[group]}</h3>
            <div className="grid grid-cols-2 gap-3">
              {items.map((item) => {
                const def = widgetDef(item.id);
                return (
                  <div key={item.id} className="flex flex-col gap-2 rounded-[20px] bg-widget p-2.5 ring-1 ring-inset ring-hairline" data-testid="gallery-item">
                    <MiniPreview size={def.defaultSize}>{previews[item.id]?.[def.defaultSize]}</MiniPreview>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{def.title}</p>
                      <p className="text-xs font-medium text-muted-foreground">{def.description}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Sizes: {def.sizes.map((s) => SIZE_LABEL[s]).join(", ")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAdd(item.id)}
                      aria-label={`Add ${def.title}`}
                      className="min-h-11 w-full rounded-xl bg-brand-fill text-sm font-bold text-white active:scale-[0.97] transition-transform"
                    >
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}

/** The widget's preview at its real size, scaled down into a 112 px box, as in the locked design. */
function MiniPreview({ size, children }: { size: WidgetSize; children: ReactNode }) {
  const width = size === "s" ? 171 : 358;
  const height = size === "l" ? 340 : 164;
  const scale = Math.min(150 / width, 104 / height);
  return (
    <div className="relative h-28 overflow-hidden rounded-[14px] bg-home" aria-hidden>
      <div
        inert
        className="pointer-events-none absolute top-1 origin-top-left"
        style={{ width, height, left: `calc(50% - ${(width * scale) / 2}px)`, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
