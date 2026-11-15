"use client";

/**
 * The editors for the user fields on Account: name, goals, experience,
 * gender and the body numbers. Each saves its own field through
 * updateUserProfile.
 */

import { chip, SubmitButton } from "@/components/features/AthleteProfileParts";
import { updateUserProfile } from "@/lib/actions/profile";
import { GOAL_VALUES, type Goal } from "@/lib/utils/goals";
import { callAction } from "@/lib/utils/stale-bundle";
import { useState } from "react";

export type Gender = "male" | "female" | "other" | "prefer_not_to_say";
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export const GOAL_LABELS: Record<Goal, string> = {
  strength: "Strength",
  muscle_gain: "Muscle Gain",
  weight_loss: "Weight Loss",
  endurance: "Endurance",
  general_fitness: "General Fitness",
};

// Strength and endurance are stored in the goals list but chosen as the main focus, never as chips.
const FOCUS_GOALS: Goal[] = ["strength", "endurance"];
export const OTHER_GOALS = GOAL_VALUES.filter((g) => !FOCUS_GOALS.includes(g));

export type Focus = "strength" | "endurance" | "both";

export const FOCUS_LABELS: Record<Focus, string> = {
  strength: "Strength",
  endurance: "Endurance",
  both: "Both equally",
};

export const FOCUS_HINTS: Record<Focus, string> = {
  strength: "Lifting leads the plan",
  endurance: "Swim, bike or run leads, strength supports it",
  both: "Lifting and endurance get the same weight",
};

export function focusOf(goals: Goal[]): Focus | null {
  const s = goals.includes("strength");
  const e = goals.includes("endurance");
  return s && e ? "both" : s ? "strength" : e ? "endurance" : null;
}

const FOCUS_GOALS_FOR: Record<Focus, Goal[]> = { strength: ["strength"], endurance: ["endurance"], both: ["strength", "endurance"] };

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export const EXPERIENCE_HINTS: Record<ExperienceLevel, string> = {
  beginner: "New to lifting, or less than a year of steady training",
  intermediate: "1 to 3 years, still adding weight most months",
  advanced: "Several years, progress now comes slowly",
};

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

type SaveProps = { onSaved: () => void };

function useProfileSave(onSaved: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(change: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const r = await callAction(updateUserProfile(change));
    setSaving(false);
    if (!r.success) {
      setError(r.error ?? "Failed to save profile");
      return;
    }
    onSaved();
  }
  return { saving, error, run };
}

function SaveButton({ saving, error, onClick }: { saving: boolean; error: string | null; onClick: () => void }) {
  return (
    <>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton label={saving ? "Saving…" : "Save"} disabled={saving} onClick={onClick} />
    </>
  );
}

export function NameStep({ initial, onSaved }: SaveProps & { initial: string }) {
  const [name, setName] = useState(initial);
  const { saving, error, run } = useProfileSave(onSaved);
  return (
    <div className="space-y-4">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        aria-label="Name"
        className="w-full rounded-xl bg-muted px-4 py-3.5 text-base outline-none focus:ring-2 ring-primary"
      />
      <SaveButton saving={saving} error={error} onClick={() => run({ name: name.trim() || undefined })} />
    </div>
  );
}

export function GoalsStep({ initial, onSaved }: SaveProps & { initial: Goal[] }) {
  const focus = initial.filter((g) => FOCUS_GOALS.includes(g));
  const [goals, setGoals] = useState(initial.filter((g) => !FOCUS_GOALS.includes(g)));
  const { saving, error, run } = useProfileSave(onSaved);
  const toggle = (g: Goal) => setGoals((prev) => (prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {OTHER_GOALS.map((g) => (
          <button key={g} aria-pressed={goals.includes(g)} onClick={() => toggle(g)} className={`${chip(goals.includes(g))} px-4`}>
            {GOAL_LABELS[g]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Select all that apply</p>
      <SaveButton saving={saving} error={error} onClick={() => run({ goals: focus.length + goals.length > 0 ? [...focus, ...goals] : null })} />
    </div>
  );
}

/** The main focus, stored as the strength and endurance entries of the goals list. */
export function FocusStep({ initial, onSaved }: SaveProps & { initial: Goal[] }) {
  const [focus, setFocus] = useState<Focus | null>(focusOf(initial));
  const { saving, error, run } = useProfileSave(onSaved);
  const others = initial.filter((g) => !FOCUS_GOALS.includes(g));
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(Object.keys(FOCUS_LABELS) as Focus[]).map((f) => (
          <button key={f} aria-pressed={focus === f} onClick={() => setFocus(f)} className={`${chip(focus === f)} w-full px-4 py-3 text-left`}>
            <span className="block">{FOCUS_LABELS[f]}</span>
            <span className={`block text-xs font-normal ${focus === f ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{FOCUS_HINTS[f]}</span>
          </button>
        ))}
      </div>
      <SaveButton
        saving={saving}
        error={error}
        onClick={() => {
          const goals = [...(focus ? FOCUS_GOALS_FOR[focus] : []), ...others];
          run({ goals: goals.length > 0 ? goals : null });
        }}
      />
    </div>
  );
}

/** One choice of a few, or none: experience level and gender. */
export function PickerStep<T extends string>({
  field,
  initial,
  labels,
  hints,
  onSaved,
}: SaveProps & { field: "experienceLevel" | "gender"; initial: T | null; labels: Record<T, string>; hints?: Record<T, string> }) {
  const [value, setValue] = useState<T | null>(initial);
  const { saving, error, run } = useProfileSave(onSaved);
  return (
    <div className="space-y-4">
      <div className={hints ? "space-y-2" : "flex flex-wrap gap-2"}>
        {(Object.keys(labels) as T[]).map((opt) => (
          <button
            key={opt}
            aria-pressed={value === opt}
            onClick={() => setValue(value === opt ? null : opt)}
            className={`${chip(value === opt)} px-4 ${hints ? "w-full py-3 text-left" : ""}`}
          >
            <span className="block">{labels[opt]}</span>
            {hints && <span className={`block text-xs font-normal ${value === opt ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{hints[opt]}</span>}
          </button>
        ))}
      </div>
      <SaveButton saving={saving} error={error} onClick={() => run({ [field]: value })} />
    </div>
  );
}

/** Year of birth and height are whole numbers; body weight is not. */
export function NumberStep({
  field,
  label,
  initial,
  unit,
  placeholder,
  onSaved,
}: SaveProps & { field: "birthYear" | "heightCm" | "weightKg"; label: string; initial: number | null; unit: string; placeholder: string }) {
  const [text, setText] = useState(initial == null ? "" : String(initial));
  const { saving, error, run } = useProfileSave(onSaved);
  const value = text.trim() === "" ? null : field === "weightKg" ? Number(text) : Math.round(Number(text));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode={field === "weightKg" ? "decimal" : "numeric"}
          placeholder={placeholder}
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 min-w-0 rounded-xl bg-muted px-4 py-3.5 text-base text-right outline-none focus:ring-2 ring-primary"
        />
        {unit && <span className="text-sm text-muted-foreground w-6">{unit}</span>}
      </div>
      <SaveButton saving={saving} error={error} onClick={() => run({ [field]: value })} />
    </div>
  );
}
