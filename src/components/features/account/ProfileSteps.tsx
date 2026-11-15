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
  const [goals, setGoals] = useState(initial);
  const { saving, error, run } = useProfileSave(onSaved);
  const toggle = (g: Goal) => setGoals((prev) => (prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {GOAL_VALUES.map((g) => (
          <button key={g} aria-pressed={goals.includes(g)} onClick={() => toggle(g)} className={`${chip(goals.includes(g))} px-4`}>
            {GOAL_LABELS[g]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Select all that apply</p>
      <SaveButton saving={saving} error={error} onClick={() => run({ goals: goals.length > 0 ? goals : null })} />
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
