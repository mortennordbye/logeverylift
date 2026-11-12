"use client";

import {
  AREA_LABEL,
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
import { ThresholdEditor, type SuggestionView } from "@/components/features/ThresholdEditor";
import type { ThresholdView } from "@/components/features/ThresholdsClient";
import { THRESHOLD_KINDS, type ThresholdKind } from "@/db/schema/athlete-profile";
import { finishInterview, moveMemoryToProfile } from "@/lib/actions/athlete-profile";
import { callAction } from "@/lib/utils/stale-bundle";
import { STRENGTH_GOAL_LABEL } from "@/lib/utils/strength-goal";
import { THRESHOLD_LABEL, currentThresholds, formatThreshold } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Step = "race" | "experience" | "availability" | "strength" | "thresholds" | "injuries" | "memory" | "done";

const TITLE: Record<Step, string> = {
  race: "Your race",
  experience: "Experience",
  availability: "Availability",
  strength: "Strength goal",
  thresholds: "Thresholds",
  injuries: "Injuries and limits",
  memory: "From your coach memory",
  done: "Done",
};

export type InterviewRaceView = { date: string | null; distance: "full" | "half" | null; cycleId: number; cycleName: string } | null;
export type MemoryEntryView = { id: number; kind: string; text: string; date: string };

/**
 * The intake interview (docs/plans/athlete-profile.md, 2.6): one step per
 * screen. Each step saves when the user goes on, so a half-done interview
 * keeps its answers. All saves of one run share one change set, so the user
 * can undo the whole interview in one step from the history.
 */
export function InterviewClient({
  race,
  profile,
  thresholds,
  suggestions,
  injuries,
  memory,
  units,
  next,
}: {
  race: InterviewRaceView;
  profile: ProfileView | null;
  thresholds: ThresholdView[];
  suggestions: SuggestionView[];
  injuries: InjuryView[];
  memory: MemoryEntryView[];
  units: Units;
  next: string;
}) {
  const router = useRouter();
  const [changeSetId] = useState(() => `interview:${crypto.randomUUID()}`);
  // The memory step only shows when there is something to offer.
  const [steps] = useState<Step[]>(() =>
    (["race", "experience", "availability", "strength", "thresholds", "injuries", "memory", "done"] as Step[]).filter((s) => s !== "memory" || memory.length > 0),
  );
  const [index, setIndex] = useState(0);
  const [openKind, setOpenKind] = useState<ThresholdKind | null>(null);
  const [injury, setInjury] = useState<ReturnType<typeof emptyInjury> | null>(null);
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = steps[index];
  const current = currentThresholds(thresholds);

  const go = (by: number) => {
    setError(null);
    setOpenKind(null);
    setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + by)));
  };
  const savedAndNext = () => {
    router.refresh();
    go(1);
  };

  async function moved(id: number) {
    setError(null);
    const r = await callAction(moveMemoryToProfile({ id, changeSetId }));
    if (!r.success) {
      setError(r.error);
      return;
    }
    setHandled((h) => new Set(h).add(id));
    router.refresh();
  }

  async function finish() {
    setSaving(true);
    setError(null);
    const r = await callAction(finishInterview({ changeSetId }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    router.push(next);
    router.refresh();
  }

  const nextButton = (label = "Next") => (
    <button onClick={() => go(1)} className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground active:opacity-80">
      {label}
    </button>
  );

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        {index === 0 ? (
          <Link href="/more/athlete" className="min-h-[44px] flex items-center text-sm font-medium text-primary active:opacity-70">
            Cancel
          </Link>
        ) : (
          <button onClick={() => go(-1)} className="min-h-[44px] text-sm font-medium text-primary active:opacity-70">
            Back
          </button>
        )}
        <span className="text-xs text-muted-foreground" data-testid="interview-progress">
          Step {index + 1} of {steps.length}
        </span>
        {step !== "done" ? (
          <button onClick={() => go(1)} className="min-h-[44px] text-sm font-medium text-muted-foreground active:opacity-70">
            Skip
          </button>
        ) : (
          <span className="w-10" />
        )}
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{TITLE[step]}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {step === "race" && (
          <>
            {race ? (
              <div className="rounded-xl bg-card px-4 py-3" data-testid="interview-race">
                <p className="text-sm font-medium">{race.distance === "full" ? "Full distance" : race.distance === "half" ? "Half distance" : "Race"}</p>
                <p className="text-sm text-muted-foreground">
                  {race.date ?? "No date"} · on the cycle {race.cycleName}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="interview-race">
                No race set. You can set one on your cycle.
              </p>
            )}
            <Link href={race ? `/cycles/${race.cycleId}` : "/cycles"} className="block min-h-[44px] text-sm font-medium text-primary active:opacity-70">
              {race ? "Change it on the cycle" : "Go to cycles"}
            </Link>
            {nextButton()}
          </>
        )}

        {step === "experience" && (
          <>
            <p className="text-sm text-muted-foreground">How much endurance sport have you done?</p>
            <ExperienceStep initial={profile?.enduranceLevel ?? null} changeSetId={changeSetId} onSaved={savedAndNext} submitLabel="Next" />
          </>
        )}

        {step === "availability" && (
          <>
            <p className="text-sm text-muted-foreground">When can you train in a normal week?</p>
            <AvailabilityStep initial={profile} changeSetId={changeSetId} onSaved={savedAndNext} submitLabel="Next" />
          </>
        )}

        {step === "strength" && (
          <>
            <p className="text-sm text-muted-foreground">What should strength training do for you?</p>
            <StrengthStep initial={profile?.strengthGoal ?? null} changeSetId={changeSetId} onSaved={savedAndNext} submitLabel="Next" />
          </>
        )}

        {step === "thresholds" && (
          <>
            <p className="text-sm text-muted-foreground">Enter what you know, do a field test, or skip any of them.</p>
            {THRESHOLD_KINDS.map((kind) => {
              const c = current[kind];
              return (
                <div key={kind} className="rounded-xl bg-card px-4 py-3 space-y-3">
                  <button onClick={() => setOpenKind(openKind === kind ? null : kind)} className="w-full flex items-baseline justify-between min-h-[44px] active:opacity-60" data-testid={`interview-threshold-${kind}`}>
                    <span className="text-sm font-medium">{THRESHOLD_LABEL[kind]}</span>
                    <span className="text-sm text-muted-foreground">{c ? formatThreshold(kind, c.value, units) : "Not set"}</span>
                  </button>
                  {openKind === kind && (
                    <ThresholdEditor
                      kind={kind}
                      units={units}
                      suggestion={suggestions.find((s) => s.kind === kind) ?? null}
                      changeSetId={changeSetId}
                      onSaved={() => {
                        setOpenKind(null);
                        router.refresh();
                      }}
                    />
                  )}
                </div>
              );
            })}
            {nextButton()}
          </>
        )}

        {step === "injuries" && (
          <>
            <p className="text-sm text-muted-foreground">Current and past injuries, and what training to avoid.</p>
            <InjuryList injuries={injuries} onOpen={(i) => setInjury({ ...i })} />
            <button onClick={() => setInjury(emptyInjury())} className="w-full min-h-[44px] rounded-xl bg-muted text-sm font-medium active:opacity-70">
              Add an injury
            </button>
            {nextButton()}
          </>
        )}

        {step === "memory" && (
          <>
            <p className="text-sm text-muted-foreground">
              Your assistant noted these before the app had a place for them. If one is an injury or about your available
              time, enter it in the right step, then tap Moved. Keep life limits such as travel in memory.
            </p>
            {memory.map((m) => (
              <div key={m.id} className="rounded-xl bg-card px-4 py-3 space-y-2" data-testid="interview-memory">
                <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                <p className="text-xs text-muted-foreground">{m.date}</p>
                {handled.has(m.id) ? (
                  <p className="text-sm text-muted-foreground">Moved. The entry is no longer in use.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setInjury(emptyInjury(m.text.slice(0, 500)))} className="min-h-[44px] rounded-xl bg-muted text-xs font-medium active:opacity-70">
                      Add as injury
                    </button>
                    <button onClick={() => moved(m.id)} className="min-h-[44px] rounded-xl bg-muted text-xs font-medium active:opacity-70">
                      Moved
                    </button>
                    <button onClick={() => setHandled((h) => new Set(h).add(-m.id))} className="min-h-[44px] rounded-xl bg-muted text-xs font-medium active:opacity-70">
                      {handled.has(-m.id) ? "Kept" : "Keep in memory"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {nextButton()}
          </>
        )}

        {step === "done" && (
          <>
            <dl className="rounded-xl bg-card px-4 py-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Experience</dt>
                <dd>{profile?.enduranceLevel ? LEVEL_TEXT[profile.enduranceLevel].label : "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Days</dt>
                <dd>{profile?.availableDays?.length ? profile.availableDays.map((d) => DAY_LABELS[d]).join(" ") : "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Hours a week</dt>
                <dd>{profile?.hoursPerWeek ?? "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Strength goal</dt>
                <dd>{profile?.strengthGoal ? STRENGTH_GOAL_LABEL[profile.strengthGoal] : "Not set"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Thresholds</dt>
                <dd>{Object.keys(current).length} of {THRESHOLD_KINDS.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Injuries</dt>
                <dd>{injuries.filter((i) => i.status !== "past").map((i) => AREA_LABEL(i.area)).join(", ") || "None"}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">You can change any of it later in the athlete profile.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={finish}
              disabled={saving}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              Finish
            </button>
          </>
        )}
        {error && step !== "done" && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <InjurySheet
        draft={injury}
        changeSetId={changeSetId}
        onClose={() => setInjury(null)}
        onSaved={() => {
          setInjury(null);
          router.refresh();
        }}
      />
    </div>
  );
}
