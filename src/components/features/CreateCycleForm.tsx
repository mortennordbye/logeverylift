"use client";

/**
 * CreateCycleForm
 *
 * Form for creating a new training cycle. Handles name, duration,
 * schedule type, end action, and optional end message.
 */

import { createTrainingCycle } from "@/lib/actions/training-cycles";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DURATION_OPTIONS = [4, 6, 8, 10, 12, 16];

const END_ACTION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "deload", label: "Deload week" },
  { value: "new_cycle", label: "Start new cycle" },
  { value: "rest", label: "Rest period" },
] as const;

type EndAction = "none" | "deload" | "new_cycle" | "rest";

export function CreateCycleForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [scheduleType, setScheduleType] = useState<"day_of_week" | "rotation">(
    "day_of_week",
  );
  const [endAction, setEndAction] = useState<EndAction>("none");
  const [endMessage, setEndMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");

    const result = await createTrainingCycle({
      name: name.trim(),
      durationWeeks,
      scheduleType,
      endAction,
      endMessage: endMessage.trim() || undefined,
    });

    setLoading(false);
    if (result.success) {
      router.push(`/cycles/${result.data.id}`);
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Name */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Spring Strength Block"
          className="rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
        />
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Duration
        </label>
        <div className="flex gap-2 flex-wrap">
          {DURATION_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDurationWeeks(w)}
              className={`
                px-4 py-2 rounded-full text-sm font-semibold border-2 transition-colors
                ${durationWeeks === w
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"}
              `}
            >
              {w}w
            </button>
          ))}
        </div>
      </div>

      {/* Schedule type */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Schedule type
        </label>
        <div className="flex rounded-xl overflow-hidden border border-border">
          <button
            type="button"
            onClick={() => setScheduleType("day_of_week")}
            className={`
              flex-1 py-3 text-sm font-semibold transition-colors
              ${scheduleType === "day_of_week" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
            `}
          >
            Day of week
          </button>
          <button
            type="button"
            onClick={() => setScheduleType("rotation")}
            className={`
              flex-1 py-3 text-sm font-semibold transition-colors
              ${scheduleType === "rotation" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
            `}
          >
            Rotation
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {scheduleType === "day_of_week"
            ? "Each weekday has a workout. Missed days don't carry over — Monday's leg day stays on Monday."
            : "Follow a sequence in order. Missed workouts repeat until done; rest days auto-advance with the calendar."}
        </p>
      </div>

      {/* End action */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          When cycle ends
        </label>
        <div className="flex flex-col rounded-xl overflow-hidden border border-border divide-y divide-border">
          {END_ACTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEndAction(opt.value)}
              className={`
                flex items-center justify-between px-4 py-3 text-sm transition-colors
                ${endAction === opt.value ? "bg-primary/10 text-primary font-semibold" : "text-foreground"}
              `}
            >
              {opt.label}
              {endAction === opt.value && (
                <span className="w-2 h-2 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* End message */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Note to future self{" "}
          <span className="normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={endMessage}
          onChange={(e) => setEndMessage(e.target.value)}
          placeholder="e.g. Time to test your 1RM!"
          rows={3}
          className="rounded-xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 ring-primary resize-none"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform"
      >
        {loading ? "Creating…" : "Create Cycle"}
      </button>
      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
    </form>
  );
}
