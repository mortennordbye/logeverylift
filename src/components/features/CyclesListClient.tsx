"use client";

import { HOME_UI } from "@/components/features/home/fonts";
import { FlagIcon, SeasonsSection } from "@/components/features/SeasonsSection";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { deleteManyTrainingCycles } from "@/lib/actions/training-cycles";
import type { PlanListData, SelectRow } from "@/lib/plan-list";
import { phaseDeleteWarning, type CycleRow, type HeroView } from "@/lib/utils/plan-list";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

// ─── small parts ─────────────────────────────────────────────────────────────

const sectionLabel = "mx-1 text-xs font-semibold uppercase tracking-[1px] text-muted-foreground";
const card = "rounded-[20px] bg-widget";
/** The selected chip's tint comes from the accent, never a fixed colour. */
const accentTint = "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)]";

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RotateIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** The two ways to start, the same on the empty Plan and in the + menu. The new cycle form asks how you train. */
function NewChoices({ onPick }: { onPick?: () => void }) {
  const rows = [
    { href: "/cycles/new", Icon: RotateIcon, title: "New cycle", sub: "Weeks that run your programs" },
    { href: "/seasons/new", Icon: FlagIcon, title: "New season", sub: "A race or a goal, made of cycles" },
  ];
  return (
    <ul className="flex flex-col overflow-hidden rounded-2xl bg-widget-2">
      {rows.map((r) => (
        <li key={r.href} className="border-b border-hairline last:border-b-0">
          <Link href={r.href} onClick={onPick} className="flex min-h-16 items-center gap-3 px-4 py-3 active:opacity-70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand" aria-hidden>
              <r.Icon className="h-5 w-5 shrink-0" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base font-semibold">{r.title}</span>
              <span className="text-[13px] text-muted-foreground">{r.sub}</span>
            </span>
            <ChevronIcon />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SeasonPrompt() {
  return (
    <Link href="/seasons/new" className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground active:opacity-70">
      <FlagIcon />
      Training for a race or a goal? Add a season
    </Link>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────────

function HeroCard({ hero }: { hero: HeroView }) {
  return (
    <Link href={`/cycles/${hero.id}`} className={`${card} flex flex-col gap-3.5 p-[18px] active:opacity-80`} data-testid="plan-hero">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[1px] text-brand">{hero.label}</span>
        <span className="text-xl font-semibold">{hero.name}</span>
      </div>
      {hero.kind === "week" ? (
        <ul className="grid grid-cols-7 gap-1" aria-label="This week">
          {hero.days.map((d) => (
            <li
              key={d.date}
              className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2 ${d.rest ? "" : "bg-widget-2"} ${d.key ? "ring-2 ring-inset ring-brand" : ""}`}
            >
              <span className={`text-[11px] ${d.today ? "font-semibold text-brand" : "text-muted-foreground"}`}>{d.day}</span>
              <span className={`h-2 w-2 rounded-full ${d.key ? "bg-brand" : d.rest ? "bg-foreground/15" : "bg-foreground"}`} aria-hidden />
              <span className={`max-w-full truncate px-0.5 text-[11px] font-semibold ${d.rest ? "text-muted-foreground" : ""}`}>{d.short}</span>
              <span className="sr-only">
                {d.names}
                {d.key ? ", key session" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Rotation">
          {hero.chips.map((c) => (
            <li
              key={c.id}
              className={`flex min-h-[44px] flex-col justify-center rounded-xl border px-3 py-1 ${
                c.tag === "Next" ? `${accentTint} border-brand` : c.tag === "Done" ? "border-foreground/12" : "border-transparent bg-widget-2"
              }`}
            >
              {c.tag && <span className={`text-[11px] font-semibold ${c.tag === "Next" ? "text-brand" : "text-muted-foreground"}`}>{c.tag}</span>}
              <span className={`text-sm font-semibold ${c.tag === "Done" || c.rest ? "text-muted-foreground" : ""}`}>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
        {hero.kind === "week" ? (
          <span>{hero.summary}</span>
        ) : (
          <span>{hero.next && <>Next: <span className="text-foreground">{hero.next}</span></>}</span>
        )}
        <span>{hero.ends}</span>
      </div>
    </Link>
  );
}

// ─── rows ────────────────────────────────────────────────────────────────────

function CycleRows({ rows }: { rows: CycleRow[] }) {
  return (
    <div className={`${card} flex flex-col overflow-hidden`}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/cycles/${r.id}`}
          className="flex min-h-[44px] items-center justify-between gap-3 border-b border-hairline px-4 py-3.5 last:border-b-0 active:bg-widget-2"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[15px] font-medium">{r.name}</span>
            <span className="text-[13px] text-muted-foreground">{r.sub}</span>
          </span>
          {r.starts && (
            <span className="shrink-0 text-[13px] font-semibold text-brand" data-testid="scheduled-start">
              {r.starts}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

function SelectRows({ rows, selected, toggle }: { rows: SelectRow[]; selected: Set<number>; toggle: (id: number) => void }) {
  return (
    <div className={`${card} flex flex-col overflow-hidden`}>
      {rows.map((r) => {
        const on = selected.has(r.id);
        return (
          <label key={r.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-hairline py-1.5 pr-4 pl-2 last:border-b-0">
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
            <span className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden>
              <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 ${on ? "border-brand bg-brand" : "border-[#707076]"}`}>
                {on && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium">{r.name}</span>
              <span className="text-[13px] text-muted-foreground">{r.sub}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ─── the hidden season tip (localStorage, docs/privacy/data-inventory.md) ───

const TIP_KEY = "planSeasonTipHidden";
const tipListeners = new Set<() => void>();
function readTipHidden(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}
function hideTip() {
  try {
    localStorage.setItem(TIP_KEY, "1");
  } catch {
    // Storage blocked: the tip hides until the page reloads.
  }
  tipListeners.forEach((l) => l());
}
function subscribeTip(l: () => void) {
  tipListeners.add(l);
  return () => tipListeners.delete(l);
}

// ─── main export ──────────────────────────────────────────────────────────────

type Props = {
  data: PlanListData;
  /** Deleted cycles and seasons the user can still restore. */
  deletedCount: number;
};

/** The Plan tab's list (docs/plans/plan-tab-redesign.md, P1; J1, J2_PlanGym, J4_PlanSeason, J6, J7_SelectMode). */
export function CyclesListClient({ data, deletedCount }: Props) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tipClosed, setTipClosed] = useState(false);
  // Hidden on the server, so a hidden tip never flashes in.
  const tipStored = useSyncExternalStore(subscribeTip, readTipHidden, () => true);
  const tipHidden = tipClosed || tipStored;

  const selectable = [
    ...data.seasons.flatMap((s) => s.phaseData.map((p) => p.id)),
    ...data.select.current.map((r) => r.id),
    ...data.select.upNext.map((r) => r.id),
    ...data.select.past.map((r) => r.id),
  ];
  const allSelected = selectable.length > 0 && selected.size === selectable.length;

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setError(null);
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const result = await callAction(deleteManyTrainingCycles([...selected]));
    setDeleting(false);
    if (!result.success) {
      setError(result.error ?? "Failed to delete the cycles.");
      return;
    }
    stopSelecting();
    router.refresh();
  }

  const recentlyDeleted = deletedCount > 0 && (
    <Link href="/cycles/deleted" className="mx-1 flex min-h-[44px] items-center text-sm text-muted-foreground active:opacity-70">
      Recently deleted ({deletedCount})
    </Link>
  );

  // ── select mode (J7_SelectMode) ──
  if (selecting) {
    const warning = phaseDeleteWarning(data.seasons, selected);
    const n = selected.size;
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-hidden`}>
        <header className="grid shrink-0 grid-cols-3 items-center px-2 pt-4 pb-2">
          <button type="button" onClick={stopSelecting} className="min-h-[44px] justify-self-start px-2 text-base font-medium text-brand">
            Cancel
          </button>
          <span className="justify-self-center text-base font-semibold" aria-live="polite">
            {n} selected
          </span>
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectable))}
            className="min-h-[44px] justify-self-end px-2 text-base font-medium text-brand"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2">
          {data.seasons.map((s) => (
            <div key={s.id} className="flex flex-col gap-4">
              <div className={`${card} flex flex-col gap-1 px-4 py-3.5`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-base font-semibold">{s.name}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="shrink-0 text-muted-foreground" role="img" aria-label="Season cannot be selected here">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                </div>
                <span className="text-[13px] text-muted-foreground">Delete a season from its ⋯ menu.</span>
              </div>
              {s.phases.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className={sectionLabel}>Phases</h2>
                  <SelectRows rows={s.phases.map((p) => ({ id: p.id, name: p.name, sub: p.sub }))} selected={selected} toggle={toggle} />
                </section>
              )}
            </div>
          ))}
          {data.select.current.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className={sectionLabel}>Current cycle</h2>
              <SelectRows rows={data.select.current} selected={selected} toggle={toggle} />
            </section>
          )}
          {data.select.upNext.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className={sectionLabel}>Up next</h2>
              <SelectRows rows={data.select.upNext} selected={selected} toggle={toggle} />
            </section>
          )}
          {data.select.past.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className={sectionLabel}>Past cycles</h2>
              <SelectRows rows={data.select.past} selected={selected} toggle={toggle} />
            </section>
          )}
          {/* Room for the pinned bar. */}
          <div aria-hidden className="h-56 shrink-0" />
        </div>
        <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2.5 border-t border-hairline bg-[#111113] px-4 pt-4 pb-[max(28px,env(safe-area-inset-bottom))]">
          {warning && (
            <p role="note" className="text-sm leading-5" data-testid="phase-warning">
              {warning}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-[#ff6b5a]">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={n === 0 || deleting}
            className="h-[52px] rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : n === 0 ? "Delete" : `Delete ${n} ${n === 1 ? "cycle" : "cycles"}`}
          </button>
          <span className="text-center text-[13px] text-muted-foreground">You can restore {n === 1 ? "it" : "them"} for 90 days.</span>
        </div>
      </div>
    );
  }

  // ── the list ──
  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-hidden`}>
      <header className="flex shrink-0 flex-col gap-0.5 px-4 pt-6 pb-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="home-display text-[40px] uppercase tracking-[0.5px]">Plan</h1>
          <div className="flex items-center gap-2">
            {selectable.length > 0 && (
              <button type="button" onClick={() => setSelecting(true)} className="h-11 px-2 text-base font-medium text-brand active:opacity-70">
                Select
              </button>
            )}
            {/* While the list is empty the card below is the one way in, so there is no + menu. */}
            {!data.empty && (
              <button
                type="button"
                onClick={() => setShowAddSheet(true)}
                aria-label="New cycle or season"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-primary-foreground active:opacity-80"
              >
                <PlusIcon />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Cycles and seasons: when you train</p>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pt-2">
        {data.empty ? (
          <div className="flex flex-col gap-4 pt-4">
            <section className={`${card} flex flex-col gap-5 px-5 py-6`} data-testid="plan-empty">
              <h2 className="text-[22px] font-semibold">Plan your training</h2>
              <nav aria-label="Start planning">
                <NewChoices />
              </nav>
            </section>
            {recentlyDeleted}
          </div>
        ) : (
          <>
            {data.hero && <HeroCard hero={data.hero} />}
            <SeasonsSection seasons={data.seasons} />
            {data.upNext.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className={sectionLabel}>Up next</h2>
                <CycleRows rows={data.upNext} />
              </section>
            )}
            {(data.past.length > 0 || data.pastSeasons.length > 0 || recentlyDeleted) && (
              <section className="flex flex-col gap-2">
                {data.past.length > 0 && (
                  <>
                    <h2 className={sectionLabel}>Past cycles</h2>
                    <CycleRows rows={data.past} />
                  </>
                )}
                {data.pastSeasons.length > 0 && (
                  <>
                    <h2 className={`${sectionLabel} ${data.past.length > 0 ? "mt-3" : ""}`}>Past seasons</h2>
                    <div className={`${card} flex flex-col overflow-hidden`}>
                      {data.pastSeasons.map((s) => (
                        <Link
                          key={s.id}
                          href={`/seasons/${s.id}`}
                          className="flex min-h-[44px] flex-col gap-0.5 border-b border-hairline px-4 py-3.5 last:border-b-0 active:bg-widget-2"
                        >
                          <span className="truncate text-[15px] font-medium">{s.name}</span>
                          <span className="text-[13px] text-muted-foreground">{s.sub}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
                {recentlyDeleted}
              </section>
            )}
            {data.seasons.length === 0 && !tipHidden && (
              <div className="flex items-center justify-between gap-2 pl-1" data-testid="season-tip">
                <SeasonPrompt />
                <button
                  type="button"
                  onClick={() => {
                    setTipClosed(true);
                    hideTip();
                  }}
                  aria-label="Hide season tip"
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground active:opacity-70"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
        {/* Spacer so the last row clears the fixed bottom nav (flex scroll
            containers ignore their own padding-bottom on iOS WebKit). */}
        <div aria-hidden className="shrink-0 pb-nav-safe" />
      </div>

      {/* The + menu (J1_AddSheet). */}
      <BottomSheet open={showAddSheet} onClose={() => setShowAddSheet(false)}>
        <section aria-label="New" className="flex flex-col gap-3 rounded-t-[20px] bg-widget px-4 pt-2.5 pb-8">
          <span className="h-[5px] w-10 self-center rounded-full bg-foreground/20" aria-hidden />
          <h2 className="mx-1 mt-1 text-[17px] font-semibold">New</h2>
          <NewChoices onPick={() => setShowAddSheet(false)} />
          <button
            type="button"
            onClick={() => setShowAddSheet(false)}
            className="h-[52px] rounded-2xl bg-widget-2 text-base font-semibold active:opacity-70"
          >
            Cancel
          </button>
        </section>
      </BottomSheet>
    </div>
  );
}
