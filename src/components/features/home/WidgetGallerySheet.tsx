"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { ResolvedItem } from "@/lib/home/layout";
import { widgetDef, type WidgetId } from "@/lib/home/widgets";
import { SIZE_LABEL, type WidgetGroup } from "@/lib/home/widgets/types";
import type { Previews } from "./HomeEditList";

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
      <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 max-h-[80dvh] overflow-y-auto" data-testid="widget-gallery">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Add widget</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm text-muted-foreground active:opacity-60">
            Close
          </button>
        </div>
        {hidden.length === 0 && <p className="text-sm text-muted-foreground">Every widget is on your home.</p>}
        {[...groups].map(([group, items]) => (
          <section key={group} className="mb-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[group]}</h3>
            {items.map((item) => {
              const def = widgetDef(item.id);
              return (
                <div key={item.id} className="rounded-2xl border border-border p-3 space-y-2" data-testid="gallery-item">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{def.title}</p>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Sizes: {def.sizes.map((s) => SIZE_LABEL[s]).join(", ")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAdd(item.id)}
                      aria-label={`Add ${def.title}`}
                      className="min-h-11 min-w-11 shrink-0 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
                    >
                      Add
                    </button>
                  </div>
                  {previews[item.id]?.[def.defaultSize]}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}
