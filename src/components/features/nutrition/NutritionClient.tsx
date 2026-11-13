"use client";

/**
 * The Nutrition page (docs/plans/nutrition-and-race-day.md, 6). Every target
 * shows its evidence label and the not-medical-advice line.
 */

import { manageFuelProduct, manageSweatTest, saveFuelLogAction } from "@/lib/actions/nutrition";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { FuelForm, type FuelProduct } from "@/components/features/nutrition/FuelForm";
import { NUTRITION_DISCLAIMER, type Band, type GutTraining } from "@/lib/utils/fueling";
import { hoursMinutes } from "@/lib/utils/race-plan";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import { ChevronRight, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FuelLog = { carbsG: number | null; fluidMl: number | null; sodiumMg: number | null; caffeineMg: number | null; giScore: number | null; items: unknown; notes: string | null };
type Session = { id: number; date: string; name: string; durationS: number; log: FuelLog | null };
type Test = { id: number; testedOn: string; durationS: number; temperatureC: number | null; mlPerHour: number; massChangePct: number; flags: string[] };
type Race = { id: number; name: string; raceDate: string; priority: string; distance: string | null };

const SECTION = "px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const CARD = "rounded-2xl bg-card px-4 py-3 space-y-1";
const INPUT = "h-11 w-full rounded-xl bg-background px-3 text-base outline-none";
const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-muted-foreground">{children}</p>;

function Evidence({ label }: { label: string }) {
  return <p className="text-[11px] text-muted-foreground">Evidence: {label}</p>;
}

const dateWithYear = (d: string) => `${shortDay(d)} ${d.slice(0, 4)}`;

export function NutritionClient(p: { gut: GutTraining; fluid: Band; sodium: Band; sessions: Session[]; tests: Test[]; products: FuelProduct[]; races: Race[] }) {
  const router = useRouter();
  const [fuelFor, setFuelFor] = useState<Session | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [product, setProduct] = useState<Partial<FuelProduct> | null>(null);

  return (
    <div className="space-y-6 pb-8">
      <p className="px-4 text-sm text-muted-foreground" data-testid="nutrition-disclaimer">
        {NUTRITION_DISCLAIMER}
      </p>

      {p.races.length > 0 && (
        <section>
          <p className={SECTION}>Race plans</p>
          <div className="mx-4 divide-y divide-border rounded-2xl bg-card overflow-hidden">
            {p.races.map((r) => (
              <Link key={r.id} href={`/races/${r.id}/plan`} className="flex items-center gap-3 px-4 min-h-[56px] active:bg-muted/50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateWithYear(r.raceDate)} · {r.distance === "full" ? "Full distance" : "Half distance"} · {r.priority} race
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className={SECTION}>Gut training</p>
        <div className={`mx-4 ${CARD}`} data-testid="gut-training">
          <div className="flex justify-between text-sm">
            <span>Proved in training</span>
            <span className="font-semibold tabular-nums">{p.gut.proved != null ? `${p.gut.proved} g/h` : "–"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Next step</span>
            <span className="font-semibold tabular-nums">{p.gut.next} g/h</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Race target (80 % of proved)</span>
            <span className="font-semibold tabular-nums">{p.gut.raceTarget != null ? `${p.gut.raceTarget} g/h` : "–"}</span>
          </div>
          <p className="text-sm text-muted-foreground pt-1">{p.gut.text}</p>
          <Evidence label={p.gut.evidence} />
        </div>
      </section>

      <section>
        <p className={SECTION}>Fluid and sodium per hour</p>
        <div className={`mx-4 ${CARD}`}>
          <div className="flex justify-between text-sm">
            <span>Fluid</span>
            <span className="font-semibold tabular-nums" data-testid="fluid-band">
              {p.fluid.thirst ? "Drink to thirst" : `${p.fluid.low}-${p.fluid.high} ml/h`}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{p.fluid.text}</p>
          <Evidence label={p.fluid.evidence} />
          <div className="flex justify-between text-sm pt-2">
            <span>Sodium</span>
            <span className="font-semibold tabular-nums">
              {p.fluid.thirst ? "No rate" : `${p.sodium.low}-${p.sodium.high} mg/h`}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{p.sodium.text}</p>
          <Evidence label={p.sodium.evidence} />
        </div>
      </section>

      <section>
        <p className={SECTION}>Log fuel</p>
        <div className="mx-4 divide-y divide-border rounded-2xl bg-card overflow-hidden">
          {p.sessions.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No session of an hour or more in the last 14 days.</p>}
          {p.sessions.map((s) => (
            <button key={s.id} type="button" onClick={() => setFuelFor(s)} className="flex w-full items-center gap-3 px-4 min-h-[56px] text-left active:bg-muted/50">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {shortDay(s.date)} · {hoursMinutes(s.durationS / 60)} h
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {s.log ? `${s.log.carbsG ?? 0} g${s.log.giScore != null ? ` · GI ${s.log.giScore}` : ""}` : "Add"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className={SECTION}>Sweat tests</p>
        <div className="mx-4 divide-y divide-border rounded-2xl bg-card overflow-hidden">
          {p.tests.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium tabular-nums">{t.mlPerHour} ml/h</p>
                <p className="text-xs text-muted-foreground">
                  {shortDay(t.testedOn)} · {Math.round(t.durationS / 60)} min{t.temperatureC != null ? ` · ${t.temperatureC} °C` : ""} · {t.massChangePct} % body mass
                </p>
                {t.flags.map((f) => (
                  <p key={f} className="text-xs text-destructive">
                    {f}
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const r = await callAction(manageSweatTest({ op: "delete", id: t.id }));
                  if (r.success) router.refresh();
                }}
                className="min-h-[44px] px-2 text-sm text-destructive active:opacity-60"
              >
                Delete
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setTestOpen(true)} className="flex w-full items-center gap-2 px-4 min-h-[44px] text-primary text-sm font-medium active:bg-muted/50">
            <PlusIcon className="w-4 h-4" /> Add sweat test
          </button>
        </div>
        <p className="px-4 pt-2 text-[11px] text-muted-foreground">
          Weigh yourself nude before and after about 60 minutes at race effort, in race-like heat. Repeat in 2-3 temperatures. Evidence: Inference from the consensus method.
        </p>
      </section>

      <section>
        <p className={SECTION}>Fuel products</p>
        <div className="mx-4 divide-y divide-border rounded-2xl bg-card overflow-hidden">
          {p.products.map((pr) => (
            <button key={pr.id} type="button" onClick={() => setProduct(pr)} className="flex w-full items-center gap-3 px-4 min-h-[44px] text-left active:bg-muted/50">
              <span className="flex-1 truncate">{pr.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {[pr.carbsG != null && `${pr.carbsG} g`, pr.sodiumMg != null && `${pr.sodiumMg} mg Na`, pr.caffeineMg != null && `${pr.caffeineMg} mg caffeine`].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => setProduct({})} className="flex w-full items-center gap-2 px-4 min-h-[44px] text-primary text-sm font-medium active:bg-muted/50">
            <PlusIcon className="w-4 h-4" /> Add product
          </button>
        </div>
      </section>

      <BottomSheet open={fuelFor != null} onClose={() => setFuelFor(null)}>
        {fuelFor && (
          <div className="space-y-3 p-4">
            <h2 className="text-lg font-semibold">Fuel: {fuelFor.name}</h2>
            <p className="text-xs text-muted-foreground">
              {shortDay(fuelFor.date)} · {hoursMinutes(fuelFor.durationS / 60)} h. Leave a total empty to use the sum of the products.
            </p>
            <FuelForm
              key={fuelFor.id}
              idPrefix="fuel"
              initial={fuelFor.log}
              products={p.products}
              onSave={async (v) => {
                const r = await callAction(saveFuelLogAction({ workoutSessionId: fuelFor.id, ...v }));
                if (r.success) {
                  setFuelFor(null);
                  router.refresh();
                }
                return r;
              }}
            />
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={testOpen} onClose={() => setTestOpen(false)}>
        {testOpen && <SweatTestForm onDone={() => { setTestOpen(false); router.refresh(); }} />}
      </BottomSheet>

      <BottomSheet open={product != null} onClose={() => setProduct(null)}>
        {product && <ProductForm product={product} onDone={() => { setProduct(null); router.refresh(); }} />}
      </BottomSheet>
    </div>
  );
}

function SweatTestForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ durationMinutes: "60", preKg: "", postKg: "", fluidMl: "", urineMl: "", temperatureC: "", sweatSodiumMgL: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const field = (key: keyof typeof f, label: string, unit: string) => (
    <label htmlFor={`sweat-${key}`} className="space-y-1">
      <Label>{label}</Label>
      <span className="flex items-center gap-1 rounded-xl bg-background px-3">
        <input id={`sweat-${key}`} aria-label={label} inputMode="decimal" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="h-11 w-full bg-transparent text-base outline-none tabular-nums" />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
  async function save() {
    setSaving(true);
    setError(null);
    const r = await callAction(
      manageSweatTest({
        op: "add",
        test: {
          durationMinutes: num(f.durationMinutes) ?? 0,
          preKg: num(f.preKg) ?? 0,
          postKg: num(f.postKg) ?? 0,
          fluidMl: Math.round(num(f.fluidMl) ?? 0),
          urineMl: num(f.urineMl) != null ? Math.round(num(f.urineMl)!) : null,
          temperatureC: num(f.temperatureC),
          sweatSodiumMgL: num(f.sweatSodiumMgL) != null ? Math.round(num(f.sweatSodiumMgL)!) : null,
        },
      }),
    );
    setSaving(false);
    if (r.success) onDone();
    else setError(r.error);
  }
  return (
    <div className="space-y-3 p-4">
      <h2 className="text-lg font-semibold">Sweat test</h2>
      <div className="grid grid-cols-2 gap-2">
        {field("preKg", "Weight before", "kg")}
        {field("postKg", "Weight after", "kg")}
        {field("fluidMl", "Drank", "ml")}
        {field("urineMl", "Urine", "ml")}
        {field("durationMinutes", "Duration", "min")}
        {field("temperatureC", "Temperature", "°C")}
        {field("sweatSodiumMgL", "Sweat sodium (lab)", "mg/L")}
      </div>
      <button type="button" onClick={save} disabled={saving} className="h-11 w-full rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 active:opacity-70">
        {saving ? "Saving…" : "Save test"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ProductForm({ product, onDone }: { product: Partial<FuelProduct>; onDone: () => void }) {
  const s = (v: number | null | undefined) => (v != null ? String(v) : "");
  const [f, setF] = useState({ name: product.name ?? "", carbsG: s(product.carbsG), sodiumMg: s(product.sodiumMg), caffeineMg: s(product.caffeineMg), fluidMl: s(product.fluidMl) });
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const int = (v: string) => (num(v) != null ? Math.round(num(v)!) : null);
  async function run(action: Promise<{ success: boolean; error?: string }>) {
    const r = await callAction(action);
    if (r.success) onDone();
    else setError(r.error ?? "Failed to save");
  }
  const values = { name: f.name.trim(), carbsG: num(f.carbsG), sodiumMg: int(f.sodiumMg), caffeineMg: int(f.caffeineMg), fluidMl: int(f.fluidMl) };
  return (
    <div className="space-y-3 p-4">
      <h2 className="text-lg font-semibold">{product.id ? "Edit product" : "New product"}</h2>
      <label htmlFor="product-name" className="block space-y-1">
        <Label>Name</Label>
        <input id="product-name" value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["carbsG", "Carbohydrate", "g"],
            ["sodiumMg", "Sodium", "mg"],
            ["caffeineMg", "Caffeine", "mg"],
            ["fluidMl", "Volume (drinks)", "ml"],
          ] as const
        ).map(([key, label, unit]) => (
          <label key={key} htmlFor={`product-${key}`} className="space-y-1">
            <Label>{label}</Label>
            <span className="flex items-center gap-1 rounded-xl bg-background px-3">
              <input id={`product-${key}`} aria-label={label} inputMode="decimal" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="h-11 w-full bg-transparent text-base outline-none tabular-nums" />
              <span className="text-xs text-muted-foreground">{unit}</span>
            </span>
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={!values.name}
        onClick={() => run(product.id ? manageFuelProduct({ op: "update", product: { id: product.id, ...values } }) : manageFuelProduct({ op: "add", product: values }))}
        className="h-11 w-full rounded-xl bg-foreground text-background text-sm font-semibold disabled:opacity-40 active:opacity-70"
      >
        Save product
      </button>
      {product.id && (
        <button type="button" onClick={() => run(manageFuelProduct({ op: "delete", id: product.id! }))} className="h-11 w-full rounded-xl text-destructive text-sm font-medium active:opacity-60">
          Delete product
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
