"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { deleteTrainingCycle, deleteManyTrainingCycles } from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { Check, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatEndDate(cycle: TrainingCycle): string {
  if (!cycle.startDate) return "";
  const start = new Date(cycle.startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + cycle.durationWeeks * 7);
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getWeekProgress(cycle: TrainingCycle): { currentWeek: number; progressPct: number } {
  if (!cycle.startDate) return { currentWeek: 0, progressPct: 0 };
  const start = new Date(cycle.startDate);
  const today = new Date();
  const days = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeek = Math.min(Math.floor(days / 7) + 1, cycle.durationWeeks);
  const progressPct = Math.min((days / (cycle.durationWeeks * 7)) * 100, 100);
  return { currentWeek, progressPct };
}

// ─── card / row components ────────────────────────────────────────────────────

function ActiveCycleCard({ cycle }: { cycle: TrainingCycle }) {
  const { currentWeek, progressPct } = getWeekProgress(cycle);
  const endDate = formatEndDate(cycle);
  return (
    <Link href={`/cycles/${cycle.id}`}>
      <div className="rounded-2xl bg-card p-4 active:opacity-70 transition-opacity">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-base">{cycle.name}</h3>
          <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground">
            Week {currentWeek} of {cycle.durationWeeks}
          </span>
        </div>
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden mb-2">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        {endDate && <p className="text-xs text-muted-foreground">Ends {endDate}</p>}
      </div>
    </Link>
  );
}

function DraftCycleRow({ cycle }: { cycle: TrainingCycle }) {
  return (
    <Link
      href={`/cycles/${cycle.id}`}
      className="flex items-center justify-between px-4 py-3.5 active:opacity-70 transition-opacity"
    >
      <div>
        <span className="text-sm font-medium">{cycle.name}</span>
        <span className="text-xs text-muted-foreground ml-2">· {cycle.durationWeeks} weeks</span>
      </div>
      <span className="text-xs text-muted-foreground capitalize">
        {cycle.scheduleType === "day_of_week" ? "Day of week" : "Rotation"}
      </span>
    </Link>
  );
}

function PastCycleRow({ cycle }: { cycle: TrainingCycle }) {
  return (
    <Link
      href={`/cycles/${cycle.id}`}
      className="flex items-center justify-between px-4 py-3.5 active:opacity-70 transition-opacity"
    >
      <div>
        <span className="text-sm font-medium text-muted-foreground">{cycle.name}</span>
        <span className="text-xs text-muted-foreground ml-2">· {cycle.durationWeeks} weeks</span>
      </div>
      <span className="text-xs text-muted-foreground">Completed</span>
    </Link>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

type Props = { cycles: TrainingCycle[] };

export function CyclesListClient({ cycles: initial }: Props) {
  const router = useRouter();
  const [cycles, setCycles] = useState(initial);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);

  useEffect(() => { setCycles(initial); }, [initial]);

  function stopEditing() {
    setIsEditing(false);
    setSelectedIds(new Set());
    setPendingDeleteId(null);
    setShowBulkConfirm(false);
    setBulkDeleteError(null);
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShowBulkConfirm(false);
  }

  const allSelected = cycles.length > 0 && selectedIds.size === cycles.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(cycles.map((c) => c.id)));
    }
    setShowBulkConfirm(false);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    const snapshot = cycles;
    setCycles((prev) => prev.filter((c) => !selectedIds.has(c.id)));
    setSelectedIds(new Set());
    setShowBulkConfirm(false);
    const result = await deleteManyTrainingCycles(ids);
    if (!result.success) {
      setCycles(snapshot);
      setBulkDeleteError(result.error ?? "Failed to delete cycles.");
    } else {
      stopEditing();
    }
    setBulkDeleting(false);
    router.refresh();
  }

  async function handleDelete(cycleId: number) {
    setDeleting(true);
    setCycles((prev) => prev.filter((c) => c.id !== cycleId));
    await deleteTrainingCycle(cycleId);
    setPendingDeleteId(null);
    setDeleting(false);
    router.refresh();
  }

  const active = cycles.filter((c) => c.status === "active");
  const drafts = cycles.filter((c) => c.status === "draft");
  const past = cycles.filter((c) => c.status === "completed");

  function SelectableItem({
    cycle,
    children,
    alignTop = false,
  }: {
    cycle: TrainingCycle;
    children: React.ReactNode;
    alignTop?: boolean;
  }) {
    const isSelected = selectedIds.has(cycle.id);

    if (!isEditing) {
      return <>{children}</>;
    }

    if (pendingDeleteId === cycle.id) {
      return (
        <div className="flex items-center justify-between px-4 py-4 rounded-xl bg-destructive/10">
          <span className="text-sm font-medium text-destructive">
            Delete &ldquo;{cycle.name}&rdquo;?
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPendingDeleteId(null)}
              className="text-sm text-muted-foreground font-medium min-h-[44px] px-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleDelete(cycle.id)}
              disabled={deleting}
              className="text-sm text-destructive font-semibold min-h-[44px] px-1 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`flex gap-3 ${alignTop ? "items-start" : "items-center"}`}>
        <button
          type="button"
          onClick={() => toggleSelect(cycle.id)}
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${alignTop ? "mt-3" : ""} ${
            isSelected ? "bg-primary border-primary" : "bg-transparent border-muted-foreground/40"
          }`}
          aria-label={isSelected ? `Deselect ${cycle.name}` : `Select ${cycle.name}`}
        >
          {isSelected && <Check className="w-4 h-4 text-white" />}
        </button>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Cycles</h1>
        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
              <button
                type="button"
                onClick={stopEditing}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-primary text-sm font-medium min-h-[44px] px-1"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowAddSheet(true)}
                aria-label="New cycle"
                className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground active:opacity-80 transition-opacity"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk delete bar */}
      {isEditing && selectedIds.size > 0 && (
        <div className="px-4 pb-2 shrink-0">
          {showBulkConfirm ? (
            <div className="rounded-2xl bg-destructive/10 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-destructive">
                Delete {selectedIds.size} cycle{selectedIds.size !== 1 ? "s" : ""}?
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => { setShowBulkConfirm(false); setBulkDeleteError(null); }}
                  className="text-sm text-muted-foreground font-medium min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="text-sm text-destructive font-semibold min-h-[44px] disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowBulkConfirm(true)}
              className="w-full rounded-2xl bg-destructive py-4 text-sm font-semibold text-white active:opacity-80 transition-opacity"
            >
              Delete {selectedIds.size} selected
            </button>
          )}
        </div>
      )}

      {isEditing && bulkDeleteError && (
        <p className="text-sm text-destructive px-4 pb-2 shrink-0">{bulkDeleteError}</p>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-6 px-4 pt-4">
        {/* Active */}
        {active.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Active
            </p>
            <div className="flex flex-col gap-2">
              {active.map((c) => (
                <SelectableItem key={c.id} cycle={c} alignTop>
                  <ActiveCycleCard cycle={c} />
                </SelectableItem>
              ))}
            </div>
          </div>
        )}

        {/* Draft */}
        {drafts.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Draft
            </p>
            <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden">
              {drafts.map((c) => (
                <SelectableItem key={c.id} cycle={c}>
                  <DraftCycleRow cycle={c} />
                </SelectableItem>
              ))}
            </div>
          </div>
        )}

        {/* Past */}
        {past.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              Past
            </p>
            <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden">
              {past.map((c) => (
                <SelectableItem key={c.id} cycle={c}>
                  <PastCycleRow cycle={c} />
                </SelectableItem>
              ))}
            </div>
          </div>
        )}

        {cycles.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-16 text-center">
            <p className="text-muted-foreground text-sm">
              No cycles yet. Create your first training block.
            </p>
            <button
              type="button"
              onClick={() => setShowAddSheet(true)}
              className="flex items-center gap-2 rounded-full border-2 border-primary px-6 py-3 text-primary font-semibold text-sm active:bg-primary/20 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              New Cycle
            </button>
          </div>
        )}

        {/* Spacer so the last row clears the fixed bottom nav (flex scroll
            containers ignore their own padding-bottom on iOS WebKit). */}
        <div aria-hidden className="shrink-0 pb-nav-safe" />
      </div>

      {/* New-cycle action sheet — blank cycle or the triathlon plan generator */}
      <BottomSheet open={showAddSheet} onClose={() => setShowAddSheet(false)}>
        <div className="w-full px-4 pb-8 space-y-2">
          <div className="bg-card rounded-2xl overflow-hidden divide-y divide-border">
            <Link
              href="/cycles/new"
              onClick={() => setShowAddSheet(false)}
              className="flex flex-col items-center justify-center py-4 active:bg-muted/50 transition-colors"
            >
              <span className="text-base font-medium">New cycle</span>
              <span className="text-xs text-muted-foreground">Build a custom weekly schedule</span>
            </Link>
            <Link
              href="/cycles/triathlon"
              onClick={() => setShowAddSheet(false)}
              className="flex flex-col items-center justify-center py-4 active:bg-muted/50 transition-colors"
            >
              <span className="text-base font-medium">Triathlon plan</span>
              <span className="text-xs text-muted-foreground">Swim · bike · run + strength, periodized</span>
            </Link>
          </div>
          <div className="bg-card rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAddSheet(false)}
              className="w-full flex items-center justify-center py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
