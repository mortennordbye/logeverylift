/**
 * The home layout as pure functions (docs/home-widgets-audit.md, 6.7): parse
 * what `user.home_layout` holds, resolve it against the registry and the
 * user's audience, and merge a save with what the user cannot see now.
 *
 * `null` in the column means the default. The default is computed here, per
 * audience, and never written into the column.
 */

import type { StoredHomeItem, StoredHomeLayout } from "@/lib/home/stored-layout";
import { TRAINING_WIDGETS } from "@/lib/home/notices";
import { RETIRED_IDS, WIDGETS, isWidgetId, widgetDef, type WidgetId } from "@/lib/home/widgets";
import type { Audience, WidgetSize } from "@/lib/home/widgets/types";
import { z } from "zod";

/** Upper bound for a stored row, which may still hold retired or unknown ids. */
const MAX_STORED_ITEMS = 64;

const sizeSchema = z.enum(["s", "m", "l"]);
/** Ids and numbers only: a setting never holds free text. */
const settingsSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
  z.union([z.number().finite(), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)]),
);

export const itemSchema = z
  .object({
    id: z.string().min(1).max(64),
    size: sizeSchema,
    hidden: z.boolean(),
    settings: settingsSchema.optional(),
  })
  .strict();

export const storedLayoutSchema = z
  .object({
    v: z.literal(1),
    updatedAt: z.iso.datetime(),
    items: z.array(itemSchema).max(MAX_STORED_ITEMS),
  })
  .strict();

/** One widget in a resolved layout: a known, available id with an allowed size. */
export type ResolvedItem = { id: WidgetId; size: WidgetSize; hidden: boolean; settings?: StoredHomeItem["settings"] };

/** The column's value, or null when it is empty or not a valid layout. */
export function parseStoredLayout(raw: unknown, userId?: string): StoredHomeLayout | null {
  if (raw === null || raw === undefined) return null;
  const parsed = storedLayoutSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[homeLayout] invalid", { userId });
    return null;
  }
  return parsed.data as StoredHomeLayout;
}

const ALL_IDS = Object.keys(WIDGETS) as WidgetId[];

/** Title, Today, Endurance today (endurance only), Week; every other available widget hidden. */
export function defaultLayout(audience: Audience): ResolvedItem[] {
  const available = ALL_IDS.filter((id) => widgetDef(id).available(audience));
  const item = (id: WidgetId, hidden: boolean): ResolvedItem => ({ id, size: widgetDef(id).defaultSize, hidden });
  return [
    ...available.filter((id) => widgetDef(id).defaultVisible(audience)).map((id) => item(id, false)),
    ...available.filter((id) => !widgetDef(id).defaultVisible(audience)).map((id) => item(id, true)),
  ];
}

function allowedSize(id: WidgetId, size: string): WidgetSize {
  const def = widgetDef(id);
  return (def.sizes as readonly string[]).includes(size) ? (size as WidgetSize) : def.defaultSize;
}

/** Where a missing critical widget goes back: Today after the title, Endurance today after Today. */
const CRITICAL_AFTER: Partial<Record<WidgetId, WidgetId>> = { today: "title", enduranceToday: "today" };

/**
 * The layout to render for this user. Unknown, retired and repeated ids are
 * dropped, a size the widget does not offer falls back to its default, a
 * critical widget is always visible and put back if missing, other missing
 * widgets are added hidden (so the gallery lists them), and widgets the
 * audience cannot have are left out (they stay in the stored row).
 */
export function resolveLayout(stored: StoredHomeLayout | null, audience: Audience): ResolvedItem[] {
  if (stored === null) return defaultLayout(audience);

  const seen = new Set<string>();
  const out: ResolvedItem[] = [];
  for (const s of stored.items) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (RETIRED_IDS.includes(s.id) || !isWidgetId(s.id)) continue;
    const def = widgetDef(s.id);
    if (!def.available(audience)) continue;
    const settings = s.settings && def.settings?.safeParse(s.settings).success ? { settings: s.settings } : {};
    out.push({ id: s.id, size: allowedSize(s.id, s.size), hidden: def.critical ? false : s.hidden, ...settings });
  }

  const present = new Set(out.map((i) => i.id));
  for (const id of ALL_IDS) {
    const def = widgetDef(id);
    if (present.has(id) || !def.available(audience)) continue;
    if (def.critical && def.defaultVisible(audience)) {
      const after = CRITICAL_AFTER[id];
      const at = after ? out.findIndex((i) => i.id === after) + 1 : 0;
      out.splice(at, 0, { id, size: def.defaultSize, hidden: false });
    } else {
      out.push({ id, size: def.defaultSize, hidden: true });
    }
    present.add(id);
  }
  return out;
}

/**
 * The items to store: what the user saved, then the stored items whose widget
 * is not available now, in their stored order. Turning the endurance switch
 * off and saving keeps the endurance widgets for when it comes back on.
 */
export function mergeForSave(
  stored: StoredHomeLayout | null,
  items: StoredHomeItem[],
  audience: Audience,
): StoredHomeItem[] {
  const saved = new Set(items.map((i) => i.id));
  const kept = (stored?.items ?? []).filter(
    (s) => !saved.has(s.id) && isWidgetId(s.id) && !widgetDef(s.id).available(audience),
  );
  return [...items, ...kept];
}

/** One row of the home outside edit mode: a full-width widget, or one or two S widgets. */
export type HomeRow = { ids: WidgetId[]; half: boolean };

/**
 * Visible widgets (the header excluded) as rows. Consecutive S widgets pair in
 * a two-column row, a lone S takes half a row, M and L take a full row. Visual
 * order equals DOM order.
 */
export function toRows(items: ResolvedItem[]): HomeRow[] {
  const rows: HomeRow[] = [];
  for (const i of items) {
    if (i.hidden || widgetDef(i.id).kind !== "widget") continue;
    const last = rows.at(-1);
    if (i.size === "s" && last?.half && last.ids.length === 1) last.ids.push(i.id);
    else rows.push({ ids: [i.id], half: i.size === "s" });
  }
  return rows;
}

/** The row after which the `afterTraining` notices go: the later of Today and Endurance today. */
export function afterTrainingRow(rows: HomeRow[]): number {
  let at = -1;
  rows.forEach((r, n) => {
    if (r.ids.some((id) => (TRAINING_WIDGETS as readonly string[]).includes(id))) at = n;
  });
  return at;
}

/** A short key that changes whenever the layout does, to reset client state after a save. */
export function layoutKey(items: ResolvedItem[]): string {
  return items.map((i) => `${i.id}:${i.size}:${i.hidden ? 0 : 1}`).join(",");
}
