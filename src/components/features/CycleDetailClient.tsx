"use client";

/**
 * CycleDetailClient
 *
 * The cycle detail's own actions (docs/design/plan-redesign/J5_CycleDetailWeek.dc.html):
 * - Start a draft, or "Start today instead" for a scheduled one. A start asks
 *   first when it ends the running cycle, drops another draft's scheduled
 *   start, or skips the season phases before it.
 * - The ⋯ menu: Edit details, Change history, Restart, Delete. Restart and
 *   Delete each ask in a confirm sheet.
 */

import { PlanSheetPanel, SectionLabel } from "@/components/features/PlanSheetPanel";
import { useReturnTo } from "@/components/ui/BackLink";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { deleteTrainingCycle, restartTrainingCycle, startTrainingCycle } from "@/lib/actions/training-cycles";
import { dropsScheduledLine, endsRunningLine, type RunningCycle, type ScheduledDraft } from "@/lib/utils/cycle-start";
import { shortDay } from "@/lib/utils/seasons";
import { callAction } from "@/lib/utils/stale-bundle";
import type { TrainingCycle } from "@/types/workout";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const sheetButton = "h-[52px] w-full rounded-2xl text-base font-semibold active:opacity-80 disabled:opacity-50";

/** A confirm sheet: a question, a line on what happens, the action, and Cancel. */
function ConfirmSheet({
  open,
  title,
  body,
  action,
  busyAction,
  destructive = false,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  action: string;
  busyAction: string;
  destructive?: boolean;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <PlanSheetPanel label={title}>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <div className="text-sm text-muted-foreground">{body}</div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`${sheetButton} ${destructive ? "bg-[#c23a2e] text-white" : "bg-primary text-primary-foreground"}`}
        >
          {loading ? busyAction : action}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 text-[15px] font-medium text-muted-foreground active:opacity-70">
          Cancel
        </button>
      </PlanSheetPanel>
    </BottomSheet>
  );
}

export function StartCycleButton({
  cycle,
  skippedPhases = 0,
  scheduledFor = null,
  running = null,
  otherScheduled = null,
}: {
  cycle: TrainingCycle;
  /** A season phase after the next one: how many planned phases before it a start today skips. */
  skippedPhases?: number;
  /** The day a scheduled draft starts: the card then offers "Start today instead". */
  scheduledFor?: string | null;
  /** The running cycle: a start today ends it. */
  running?: RunningCycle | null;
  /** Another draft's scheduled start: a start today drops it. */
  otherScheduled?: ScheduledDraft | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setLoading(true);
    setError(null);
    const result = await callAction(startTrainingCycle(cycle.id));
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (cycle.status !== "draft") return null;

  const skippedLine = skippedPhases > 0 ? `${skippedPhases === 1 ? "1 earlier phase" : `${skippedPhases} earlier phases`} will be skipped and the dates after it move.` : null;
  const consequences = [skippedLine, endsRunningLine(cycle.id, running), dropsScheduledLine(cycle.id, otherScheduled, cycle.seasonId)].filter(Boolean);
  const start = () => (consequences.length > 0 ? setConfirming(true) : handleStart());
  const errorLine = !confirming && error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  return (
    <>
      {scheduledFor ? (
        <div className="flex flex-col gap-2 rounded-[20px] bg-widget px-4 py-3.5" data-testid="scheduled-start">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <SectionLabel accent>Scheduled</SectionLabel>
              <span className="text-base font-semibold">Starts {shortDay(scheduledFor)}</span>
            </div>
            <button
              type="button"
              onClick={start}
              disabled={loading}
              className="min-h-11 shrink-0 rounded-full px-3.5 ring-1 ring-inset ring-foreground/20 text-sm font-medium active:opacity-70 disabled:opacity-50"
            >
              {loading ? "Starting…" : "Start today instead"}
            </button>
          </div>
          {errorLine}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={start} disabled={loading} className={`${sheetButton} bg-primary text-primary-foreground`}>
            {loading ? "Starting…" : "Start cycle"}
          </button>
          {errorLine}
        </div>
      )}

      <ConfirmSheet
        open={confirming}
        title={`Start ${cycle.name} now?`}
        body={[`This starts ${cycle.name} today.`, ...consequences].join(" ")}
        action={`Start ${cycle.name}`}
        busyAction="Starting…"
        loading={loading}
        error={error}
        onConfirm={handleStart}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/** The 44 px ⋯ button at the top right of the detail, and the sheets it opens. */
export function CycleMenu({ cycle, running = null }: { cycle: TrainingCycle; running?: RunningCycle | null }) {
  const router = useRouter();
  const returnTo = useReturnTo();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"restart" | "delete" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ask(which: "restart" | "delete") {
    setOpen(false);
    setError(null);
    setConfirm(which);
  }

  async function restart() {
    setLoading(true);
    setError(null);
    const result = await callAction(restartTrainingCycle(cycle.id));
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConfirm(null);
    router.refresh();
  }

  async function remove() {
    setLoading(true);
    setError(null);
    const result = await callAction(deleteTrainingCycle(cycle.id));
    if (!result.success) {
      setLoading(false);
      setError(result.error);
      return;
    }
    returnTo("/cycles");
  }

  const row = "flex w-full items-center min-h-[52px] px-3.5 border-b border-hairline last:border-b-0 text-left text-[15px] font-medium active:bg-foreground/5";
  return (
    <>
      <button
        type="button"
        aria-label="More actions"
        onClick={() => setOpen(true)}
        className="w-11 h-11 shrink-0 rounded-full bg-widget flex items-center justify-center active:opacity-70"
      >
        <MoreHorizontal className="w-5 h-5" aria-hidden />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <PlanSheetPanel label="Cycle actions" testId="cycle-menu">
          <h2 className="text-xl font-semibold truncate">{cycle.name}</h2>
          <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
            <Link href={`/cycles/${cycle.id}/edit`} className={row}>
              Edit details
            </Link>
            <Link href={`/cycles/${cycle.id}/history`} className={row}>
              Change history
            </Link>
            {cycle.status !== "draft" && (
              <button type="button" onClick={() => ask("restart")} className={row}>
                Restart cycle
              </button>
            )}
            <button type="button" onClick={() => ask("delete")} className={`${row} text-destructive`}>
              Delete cycle
            </button>
          </div>
        </PlanSheetPanel>
      </BottomSheet>

      <ConfirmSheet
        open={confirm === "restart"}
        title="Restart this cycle?"
        body={[
          "The cycle starts again from today, at week 1.",
          cycle.status === "completed" ? "It becomes the running cycle again." : null,
          endsRunningLine(cycle.id, running),
        ]
          .filter(Boolean)
          .join(" ")}
        action="Yes, restart"
        busyAction="Restarting…"
        loading={loading}
        error={error}
        onConfirm={restart}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === "delete"}
        title="Delete this cycle?"
        body="It goes to Recently deleted. You can restore it for 90 days."
        action="Delete cycle"
        busyAction="Deleting…"
        destructive
        loading={loading}
        error={error}
        onConfirm={remove}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
