"use client";

import { HOME_UI } from "@/components/features/home/fonts";
import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { ACCENT_TINT } from "@/components/features/season-ui";
import { FlagIcon, SeasonsSection } from "@/components/features/SeasonsSection";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { deleteManyTrainingCycles } from "@/lib/actions/training-cycles";
import type { PlanListData, SelectRow } from "@/lib/plan-list";
import { ConfirmSheet } from "@/components/features/CycleDetailClient";
import { deleteManyConfirm, phaseDeleteWarning, type CycleRow, type HeroView } from "@/lib/utils/plan-list";
import { keepDates } from "@/lib/utils/keep-dates";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// ─── small parts ─────────────────────────────────────────────────────────────

const sectionLabel = "mx-1 text-xs font-semibold uppercase tracking-[1px] text-muted-foreground";
const card = "rounded-[20px] bg-widget";

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
              <span className="text-[13px] text-muted-foreground">{keepDates(r.sub)}</span>
            </span>
            <ChevronIcon />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────────

function HeroCard({ hero }: { hero: HeroView }) {
  return (
    <Link href={`/cycles/${hero.id}`} className={`${card} flex flex-col gap-3.5 p-3.5 min-[360px]:p-[18px] active:opacity-80`} data-testid="plan-hero">
      <div className="flex flex-col gap-1">
        {/* Each part stays whole: a narrow screen breaks the label after a dot, never inside a part. */}
        <span className="text-xs font-semibold uppercase tracking-[1px] text-brand" data-testid="hero-label">
          {hero.label.split(" · ").map((part, i, all) => (
            <span key={i} className="whitespace-nowrap">
              {keepDates(part)}
              {i < all.length - 1 ? " ·" : ""}
              {i < all.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
        <span className="text-xl font-semibold">{hero.name}</span>
      </div>
      {hero.kind === "week" ? (
        <ul className="grid grid-cols-7 gap-0.5 min-[360px]:gap-1" aria-label="This week">
          {hero.days.map((d) => (
            <li
              key={d.date}
              className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2 ${d.rest ? "" : "bg-widget-2"} ${d.key ? "ring-2 ring-inset ring-brand" : ""}`}
            >
              <span aria-hidden className={`text-[11px] ${d.today ? "font-semibold text-brand" : "text-muted-foreground"}`}>
                {d.day}
              </span>
              <span className={`h-2 w-2 rounded-full ${d.key ? "bg-brand" : d.rest ? "bg-foreground/15" : "bg-foreground"}`} aria-hidden />
              <span aria-hidden data-testid="hero-day-short" lang="en" className={`max-w-full line-clamp-2 text-center leading-[13px] hyphens-auto [overflow-wrap:anywhere] text-[11px] font-semibold tracking-[-0.2px] ${d.rest ? "text-muted-foreground" : ""}`}>
                {d.short}
              </span>
              <span className="sr-only">{`${d.day}, ${d.names}${d.key ? ", key session" : ""}`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Rotation">
          {hero.chips.map((c) => (
            <li
              key={c.id}
              className={`flex min-h-[44px] flex-col justify-center rounded-xl border px-3 py-1 ${
                c.tag === "Next" ? `${ACCENT_TINT} border-brand` : c.tag === "Done" ? "border-foreground/12" : "border-transparent bg-widget-2"
              }`}
            >
              {c.tag && <span className={`text-[11px] font-semibold ${c.tag === "Next" ? "text-brand" : "text-muted-foreground"}`}>{c.tag}</span>}
              <span className={`text-sm font-semibold ${c.tag === "Done" || c.tag === "Skipped" || c.rest ? "text-muted-foreground" : ""} ${c.tag === "Skipped" ? "line-through" : ""}`}>
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
        {hero.kind === "week" ? (
          <span>{hero.summary}</span>
        ) : (
          <span>
            {hero.next && (
              <>
                <span className="text-foreground">{hero.next}</span> is next
              </>
            )}
          </span>
        )}
        <span className="shrink-0">{keepDates(hero.ends)}</span>
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
            <span className="line-clamp-2 break-words text-[15px] font-medium">{r.name}</span>
            <span className="text-[13px] text-muted-foreground">{keepDates(r.sub)}</span>
          </span>
          {r.starts && (
            <span className={`shrink-0 text-[13px] ${r.startsAccent ? "font-semibold text-brand" : "text-muted-foreground"}`} data-testid="scheduled-start">
              {keepDates(r.starts)}
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
              <span className="line-clamp-2 break-words text-[15px] font-medium">{r.name}</span>
              <span className="text-[13px] text-muted-foreground">{keepDates(r.sub)}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
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
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectable = [
    ...data.seasons.flatMap((s) => s.phaseData.map((p) => p.id)),
    ...data.select.current.map((r) => r.id),
    ...data.select.upNext.map((r) => r.id),
    ...data.select.past.map((r) => r.id),
  ];
  const allSelected = selectable.length > 0 && selected.size === selectable.length;

  function stopSelecting() {
    setSelecting(false);
    setConfirming(false);
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
    const names = [...data.seasons.flatMap((s) => s.phases), ...data.select.current, ...data.select.upNext, ...data.select.past]
      .filter((r) => selected.has(r.id))
      .map((r) => r.name);
    const ask = deleteManyConfirm(names);
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
                  <span className="line-clamp-2 break-words text-base font-semibold">{s.name}</span>
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
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={n === 0}
            aria-describedby="delete-reason"
            className="h-[52px] rounded-2xl bg-[#c23a2e] text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
          >
            {n === 0 ? "Delete" : ask.action}
          </button>
          {/* A dimmed Delete says why, as the other dimmed Plan buttons do (J7-01). */}
          <span id="delete-reason" className="text-center text-[13px] text-muted-foreground">
            {n === 0 ? "Select a cycle." : keepDates(`You can restore ${n === 1 ? "it" : "them"} for 90 days.`)}
          </span>
        </div>
        <ConfirmSheet
          open={confirming}
          title={ask.title}
          body={ask.body}
          action={ask.action}
          busyAction="Deleting…"
          destructive
          loading={deleting}
          error={error}
          onConfirm={handleDelete}
          onClose={() => setConfirming(false)}
        />
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
        <p className="text-sm text-muted-foreground">When you train, in cycles and seasons</p>
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
                          <span className="line-clamp-2 break-words text-[15px] font-medium">{s.name}</span>
                          <span className="text-[13px] text-muted-foreground">{keepDates(s.sub)}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
                {recentlyDeleted}
              </section>
            )}
          </>
        )}
        {/* Spacer so the last row clears the fixed bottom nav (flex scroll
            containers ignore their own padding-bottom on iOS WebKit). */}
        <div aria-hidden className="shrink-0 pb-nav-safe" />
      </div>

      {/* The + menu (J1_AddSheet). */}
      <BottomSheet open={showAddSheet} onClose={() => setShowAddSheet(false)}>
        <PlanSheetPanel label="New" title="New">
          <NewChoices onPick={() => setShowAddSheet(false)} />
          <button type="button" onClick={() => setShowAddSheet(false)} className={SHEET_CANCEL}>
            Cancel
          </button>
        </PlanSheetPanel>
      </BottomSheet>
    </div>
  );
}
