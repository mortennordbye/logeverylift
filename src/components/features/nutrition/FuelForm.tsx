"use client";

/**
 * The fuel log of one session (docs/plans/nutrition-and-race-day.md, 6):
 * products with counts, or typed totals, a GI score and notes. Used on the
 * Nutrition page and on a Garmin activity. A failed save keeps the input.
 */

import { itemTotals, type FuelItem } from "@/lib/utils/fueling";
import type { ActionResult } from "@/types/workout";
import { useState } from "react";

export type FuelProduct = { id: number; name: string; carbsG: number | null; sodiumMg: number | null; caffeineMg: number | null; fluidMl: number | null };

export type FuelValues = {
  carbsG: number | null;
  fluidMl: number | null;
  sodiumMg: number | null;
  caffeineMg: number | null;
  giScore: number | null;
  notes: string | null;
  items: { productId: number; count: number }[] | null;
};

type Initial = Partial<Omit<FuelValues, "items">> & { items?: unknown };

const FIELDS = [
  { key: "carbsG", label: "Carbohydrate", unit: "g" },
  { key: "fluidMl", label: "Fluid", unit: "ml" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
  { key: "caffeineMg", label: "Caffeine", unit: "mg" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

const str = (v: number | null | undefined) => (v != null ? String(v) : "");

function initialCounts(items: unknown): Record<number, number> {
  if (!Array.isArray(items)) return {};
  const out: Record<number, number> = {};
  for (const i of items) if (i && typeof i.productId === "number" && typeof i.count === "number") out[i.productId] = i.count;
  return out;
}

export function FuelForm({
  initial,
  products = [],
  idPrefix,
  onSave,
}: {
  initial: Initial | null;
  products?: FuelProduct[];
  idPrefix: string;
  onSave: (v: FuelValues) => Promise<ActionResult<unknown>>;
}) {
  const [counts, setCounts] = useState<Record<number, number>>(() => initialCounts(initial?.items));
  // A total that was saved from products shows as the products' sum, not as
  // typed, but only when every saved product can show here. Without the
  // product list (the Garmin card) or after a product was deleted, the stored
  // totals fill the fields, so a save never wipes them.
  const saved = Object.keys(initialCounts(initial?.items)).map(Number);
  const fromItems = saved.length > 0 && saved.every((id) => products.some((p) => p.id === id));
  const [typed, setTyped] = useState<Record<FieldKey, string>>(() => ({
    carbsG: fromItems ? "" : str(initial?.carbsG),
    fluidMl: fromItems ? "" : str(initial?.fluidMl),
    sodiumMg: fromItems ? "" : str(initial?.sodiumMg),
    caffeineMg: fromItems ? "" : str(initial?.caffeineMg),
  }));
  const [gi, setGi] = useState<number | null>(initial?.giScore ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  const chosen: FuelItem[] = products
    .filter((p) => (counts[p.id] ?? 0) > 0)
    .map((p) => ({ productId: p.id, name: p.name, count: counts[p.id], carbsG: p.carbsG, sodiumMg: p.sodiumMg, caffeineMg: p.caffeineMg, fluidMl: p.fluidMl }));
  const sums = itemTotals(chosen);
  const bad = FIELDS.some((f) => typed[f.key].trim() !== "" && !(Number(typed[f.key]) >= 0));

  function changed() {
    setState("idle");
  }

  async function save() {
    setState("saving");
    const num = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
    const r = await onSave({
      carbsG: num(typed.carbsG),
      fluidMl: num(typed.fluidMl),
      sodiumMg: num(typed.sodiumMg),
      caffeineMg: num(typed.caffeineMg),
      giScore: gi,
      notes: notes.trim() || null,
      items: chosen.length ? chosen.map((c) => ({ productId: c.productId, count: c.count })) : null,
    });
    setState(r.success ? "saved" : r.error);
  }

  return (
    <div className="space-y-3">
      {products.length > 0 && (
        <div className="divide-y divide-border rounded-xl bg-background">
          {products.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-3 min-h-[44px]">
              <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
              <button
                type="button"
                aria-label={`One less ${p.name}`}
                onClick={() => {
                  setCounts({ ...counts, [p.id]: Math.max(0, (counts[p.id] ?? 0) - 1) });
                  changed();
                }}
                className="h-11 w-11 rounded-full text-lg active:bg-muted"
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums" data-testid={`count-${p.id}`}>
                {counts[p.id] ?? 0}
              </span>
              <button
                type="button"
                aria-label={`One more ${p.name}`}
                onClick={() => {
                  setCounts({ ...counts, [p.id]: (counts[p.id] ?? 0) + 1 });
                  changed();
                }}
                className="h-11 w-11 rounded-full text-lg active:bg-muted"
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} htmlFor={`${idPrefix}-${f.key}`} className="space-y-1">
            <span className="text-[11px] text-muted-foreground">{f.label}</span>
            <span className="flex items-center gap-1 rounded-xl bg-background px-3">
              <input
                id={`${idPrefix}-${f.key}`}
                aria-label={f.label}
                inputMode="numeric"
                value={typed[f.key]}
                onChange={(e) => {
                  setTyped({ ...typed, [f.key]: e.target.value });
                  changed();
                }}
                className="h-11 w-full bg-transparent text-base outline-none tabular-nums"
                placeholder={sums[f.key] != null ? String(sums[f.key]) : "0"}
              />
              <span className="text-xs text-muted-foreground">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground">Gut symptoms (0 = none, 10 = worst)</p>
        <div className="mt-1 grid grid-cols-11 gap-1" role="group" aria-label="GI score">
          {Array.from({ length: 11 }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={gi === i}
              onClick={() => {
                setGi(gi === i ? null : i);
                changed();
              }}
              className={`h-11 rounded-lg text-sm tabular-nums active:opacity-70 ${gi === i ? "bg-foreground text-background" : "bg-background"}`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor={`${idPrefix}-notes`} className="block space-y-1">
        <span className="text-[11px] text-muted-foreground">Notes</span>
        <textarea
          id={`${idPrefix}-notes`}
          value={notes}
          maxLength={500}
          onChange={(e) => {
            setNotes(e.target.value);
            changed();
          }}
          className="w-full rounded-xl bg-background px-3 py-2 text-base outline-none"
          rows={2}
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={bad || state === "saving"}
        className="h-11 w-full rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 active:opacity-70"
      >
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save"}
      </button>
      {state !== "idle" && state !== "saving" && state !== "saved" && (
        <p role="alert" className="text-xs text-destructive">
          {state}
        </p>
      )}
    </div>
  );
}
