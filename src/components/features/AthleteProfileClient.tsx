"use client";

import {
  AvailabilityStep,
  DAY_LABELS,
  ExperienceStep,
  InjuryList,
  InjurySheet,
  LEVEL_TEXT,
  StrengthStep,
  emptyInjury,
  type InjuryView,
  type ProfileView,
} from "@/components/features/AthleteProfileParts";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { restoreInjuryEntry } from "@/lib/actions/athlete-profile";
import { callAction } from "@/lib/utils/stale-bundle";
import { STRENGTH_GOAL_LABEL } from "@/lib/utils/strength-goal";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Editing = "experience" | "availability" | "strength" | null;

/**
 * The athlete profile screen (docs/plans/athlete-profile.md, 2.9), behind
 * the endurance switch: each part as a row that opens its editor, injuries,
 * a link to Thresholds, and the intake interview.
 */
export function AthleteProfileClient({
  profile,
  injuries,
  deletedInjuries,
  interviewDone,
}: {
  profile: ProfileView | null;
  injuries: InjuryView[];
  deletedInjuries: { id: number; text: string; deletedOn: string }[];
  interviewDone: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [injury, setInjury] = useState<ReturnType<typeof emptyInjury> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setEditing(null);
    setInjury(null);
    router.refresh();
  };

  const availability = profile?.availableDays?.length
    ? `${profile.availableDays.map((d) => DAY_LABELS[d]).join(" ")} · ${profile.hoursPerWeek ?? "?"} h a week`
    : "Not set";
  const rows: { key: Exclude<Editing, null>; label: string; value: string }[] = [
    { key: "experience", label: "Experience", value: profile?.enduranceLevel ? LEVEL_TEXT[profile.enduranceLevel].label : "Not set" },
    { key: "availability", label: "Availability", value: availability },
    { key: "strength", label: "Strength goal", value: profile?.strengthGoal ? STRENGTH_GOAL_LABEL[profile.strengthGoal] : "Not set" },
  ];

  async function restore(id: number) {
    setError(null);
    const r = await callAction(restoreInjuryEntry({ id }));
    if (!r.success) setError(r.error);
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-5">
      <p className="text-sm text-muted-foreground">
        What your plan is built from. Only you and your own connected assistant see it. Friends never do.
      </p>
      <section className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.key}
            onClick={() => setEditing(r.key)}
            className="w-full flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 min-h-[44px] text-left active:opacity-60"
            data-testid={`athlete-${r.key}`}
          >
            <span className="text-sm font-medium">{r.label}</span>
            <span className="text-sm text-muted-foreground text-right">{r.value}</span>
          </button>
        ))}
        <Link href="/more/thresholds" className="w-full flex items-center justify-between rounded-xl bg-card px-4 py-3 min-h-[44px] active:opacity-60">
          <span className="text-sm font-medium">Thresholds</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Injuries and limits</h2>
        <InjuryList injuries={injuries} onOpen={(i) => setInjury({ ...i })} />
        <button onClick={() => setInjury(emptyInjury())} className="w-full min-h-[44px] rounded-xl bg-muted text-sm font-medium active:opacity-70">
          Add an injury
        </button>
        {deletedInjuries.length > 0 && (
          <details className="space-y-2">
            <summary className="min-h-[44px] flex items-center text-sm font-medium text-muted-foreground">Recently deleted ({deletedInjuries.length})</summary>
            {deletedInjuries.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">{d.text}</p>
                  <p className="text-xs text-muted-foreground">Deleted {d.deletedOn}</p>
                </div>
                <button onClick={() => restore(d.id)} className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60">
                  Restore
                </button>
              </div>
            ))}
          </details>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      <div className="fixed inset-x-0 px-4 pb-4 pt-2 bg-background/95" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
        <Link
          href="/more/athlete/interview"
          className="block w-full rounded-xl bg-primary py-4 text-center text-sm font-semibold text-primary-foreground active:opacity-80"
        >
          {interviewDone ? "Run the interview again" : "Start the interview"}
        </Link>
      </div>

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} blur>
        {editing && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{rows.find((r) => r.key === editing)!.label}</h2>
            {editing === "experience" && <ExperienceStep initial={profile?.enduranceLevel ?? null} onSaved={done} />}
            {editing === "availability" && <AvailabilityStep initial={profile} onSaved={done} />}
            {editing === "strength" && <StrengthStep initial={profile?.strengthGoal ?? null} onSaved={done} />}
          </div>
        )}
      </BottomSheet>
      <InjurySheet draft={injury} onClose={() => setInjury(null)} onSaved={done} />
    </div>
  );
}
