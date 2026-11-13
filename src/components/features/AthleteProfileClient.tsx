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
import { EndIllness, IllnessSheet, type IllnessDraft } from "@/components/features/IllnessSheet";
import { shortDay } from "@/lib/utils/seasons";
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
 * a link to Thresholds, sick periods with the consistency line, and the
 * intake interview.
 */
export function AthleteProfileClient({
  profile,
  injuries,
  deletedInjuries,
  interviewDone,
  today,
  illness,
  consistency,
}: {
  profile: ProfileView | null;
  injuries: InjuryView[];
  deletedInjuries: { id: number; text: string; deletedOn: string }[];
  interviewDone: boolean;
  today: string;
  illness: (IllnessDraft & { id: number })[];
  consistency: { complete: number; counted: number; thisWeek: { counted: number; done: number } };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [injury, setInjury] = useState<ReturnType<typeof emptyInjury> | null>(null);
  const [sick, setSick] = useState<IllnessDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    setEditing(null);
    setInjury(null);
    setSick(null);
    router.refresh();
  };
  const openIllness = illness.find((p) => p.endedOn === null || p.endedOn >= today) ?? null;

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

      <section className="space-y-2" data-testid="sick-periods">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sick periods</h2>
        <p className="text-sm" data-testid="consistency">
          {consistency.counted > 0
            ? `Consistency: ${consistency.complete} of the last ${consistency.counted} weeks at 80% or more.`
            : "Consistency: no full weeks to count yet."}
          {consistency.thisWeek.counted > 0 && ` This week: ${consistency.thisWeek.done} of ${consistency.thisWeek.counted} done.`}
        </p>
        {illness.length === 0 && <p className="text-sm text-muted-foreground">No sick periods.</p>}
        {illness.map((p) => (
          <div key={p.id} className="rounded-xl bg-card px-4 py-3 space-y-2" data-testid="illness-row">
            <button onClick={() => setSick({ ...p })} className="w-full text-left min-h-[44px] active:opacity-60">
              <p className="text-sm font-medium">
                {p.endedOn === null ? `Since ${shortDay(p.startedOn)}, still sick` : p.endedOn === p.startedOn ? shortDay(p.startedOn) : `${shortDay(p.startedOn)} to ${shortDay(p.endedOn)}`}
                {p.severity && ` · ${p.severity[0].toUpperCase()}${p.severity.slice(1)}`}
              </p>
              {p.notes && <p className="text-sm text-muted-foreground">{p.notes}</p>}
            </button>
            {p.id === openIllness?.id && <EndIllness id={p.id} startedOn={p.startedOn} today={today} onEnded={() => router.refresh()} />}
          </div>
        ))}
        <button
          onClick={() => setSick({ startedOn: today, endedOn: null, severity: null, notes: null })}
          className="w-full min-h-[44px] rounded-xl bg-muted text-sm font-medium active:opacity-70"
        >
          Add a sick period
        </button>
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
      <IllnessSheet draft={sick} today={today} onClose={() => setSick(null)} onSaved={done} />
    </div>
  );
}
