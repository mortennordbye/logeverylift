"use client";

/**
 * The parts of the athlete profile that the profile page and the intake
 * interview share (docs/plans/athlete-profile.md, 2.6 and 2.9): experience,
 * availability, strength goal, and the injury list with its sheet. Each saves
 * through its own Server Action, so a half-done interview keeps its answers.
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ENDURANCE_LEVELS,
  INJURY_AREAS,
  INJURY_SIDES,
  STRENGTH_GOALS,
  type EnduranceLevel,
  type InjuryArea,
  type InjurySide,
  type InjuryStatus,
  type StrengthGoal,
} from "@/db/schema/athlete-profile";
import { addInjuryEntry, deleteInjuryEntry, saveProfile, updateInjuryEntry } from "@/lib/actions/athlete-profile";
import { callAction } from "@/lib/utils/stale-bundle";
import { STRENGTH_GOAL_LABEL, STRENGTH_GOAL_TEXT, strengthTable } from "@/lib/utils/strength-goal";
import { useState } from "react";

export const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const LEVEL_TEXT: Record<EnduranceLevel, { label: string; hint: string }> = {
  novice: { label: "Novice", hint: "New to endurance sport, or a first race" },
  intermediate: { label: "Intermediate", hint: "A few races or seasons done" },
  advanced: { label: "Advanced", hint: "Many seasons, racing for time" },
};

export const AREA_LABEL = (a: InjuryArea) => a.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

export const STATUS_TEXT: Record<InjuryStatus, string> = {
  active: "Hurts now",
  managed: "I live with it",
  past: "Healed",
};

export type ProfileView = {
  enduranceLevel: EnduranceLevel | null;
  availableDays: number[] | null;
  hoursPerWeek: number | null;
  longestDayMinutes: number | null;
  longDay: number | null;
  strengthGoal: StrengthGoal | null;
};

export type InjuryView = {
  id: number;
  area: InjuryArea;
  side: InjurySide | null;
  description: string;
  avoid: string | null;
  status: InjuryStatus;
  startedOn: string | null;
  endedOn: string | null;
};

type SaveProps = { changeSetId?: string; onSaved: () => void; submitLabel?: string };

const chip = (on: boolean) =>
  `min-h-[44px] rounded-xl text-sm font-medium active:opacity-70 ${on ? "bg-primary text-primary-foreground" : "bg-muted"}`;

function SubmitButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
    >
      {label}
    </button>
  );
}

function useSave(changeSetId: string | undefined, onSaved: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(change: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const r = await callAction(saveProfile({ ...change, ...(changeSetId ? { changeSetId } : {}) }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }
  return { saving, error, run };
}

export function ExperienceStep({ initial, changeSetId, onSaved, submitLabel = "Save" }: SaveProps & { initial: EnduranceLevel | null }) {
  const [level, setLevel] = useState<EnduranceLevel | null>(initial);
  const { saving, error, run } = useSave(changeSetId, onSaved);
  return (
    <div className="space-y-3">
      <div className="space-y-2" role="radiogroup" aria-label="Experience">
        {ENDURANCE_LEVELS.map((l) => (
          <button key={l} role="radio" aria-checked={level === l} onClick={() => setLevel(l)} className={`w-full px-4 py-3 text-left ${chip(level === l)}`}>
            <span className="block">{LEVEL_TEXT[l].label}</span>
            <span className={`block text-xs font-normal ${level === l ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{LEVEL_TEXT[l].hint}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton label={submitLabel} disabled={saving || !level} onClick={() => (level === initial ? onSaved() : run({ enduranceLevel: level }))} />
    </div>
  );
}

export function AvailabilityStep({ initial, changeSetId, onSaved, submitLabel = "Save" }: SaveProps & { initial: ProfileView | null }) {
  const [days, setDays] = useState<number[]>(initial?.availableDays ?? []);
  const [hours, setHours] = useState<number>(initial?.hoursPerWeek ?? 8);
  const [longest, setLongest] = useState<number>(initial?.longestDayMinutes ?? 180);
  const [longDay, setLongDay] = useState<number | null>(initial?.longDay ?? null);
  const { saving, error, run } = useSave(changeSetId, onSaved);
  const toggle = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  const step = (value: number, by: number, min: number, max: number) => Math.min(max, Math.max(min, value + by));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Days you can train</p>
        <div className="grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} aria-pressed={days.includes(d)} onClick={() => toggle(d)} className={chip(days.includes(d))}>
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>
      <Stepper label="Hours in a normal week" value={`${hours} h`} onMinus={() => setHours(step(hours, -0.5, 1, 40))} onPlus={() => setHours(step(hours, 0.5, 1, 40))} />
      <Stepper
        label="Longest day"
        value={`${Math.floor(longest / 60)}:${String(longest % 60).padStart(2, "0")} h`}
        onMinus={() => setLongest(step(longest, -15, 30, 720))}
        onPlus={() => setLongest(step(longest, 15, 30, 720))}
      />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Day with the most time</p>
        <div className="grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} aria-pressed={longDay === d} onClick={() => setLongDay(longDay === d ? null : d)} className={chip(longDay === d)}>
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton
        label={submitLabel}
        disabled={saving || days.length === 0}
        onClick={() => run({ availableDays: days, hoursPerWeek: hours, longestDayMinutes: longest, longDay })}
      />
    </div>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={onMinus} aria-label={`Less: ${label}`} className="h-11 w-11 rounded-xl bg-muted text-lg active:opacity-70">
          −
        </button>
        <span className="w-20 text-center text-sm font-medium" aria-label={label}>
          {value}
        </span>
        <button onClick={onPlus} aria-label={`More: ${label}`} className="h-11 w-11 rounded-xl bg-muted text-lg active:opacity-70">
          +
        </button>
      </div>
    </div>
  );
}

const PHASE_NAME: Record<string, string> = {
  general: "General",
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  maintain: "Maintain",
  transition: "Transition",
};

export function StrengthStep({ initial, changeSetId, onSaved, submitLabel = "Save" }: SaveProps & { initial: StrengthGoal | null }) {
  const [goal, setGoal] = useState<StrengthGoal | null>(initial);
  const { saving, error, run } = useSave(changeSetId, onSaved);
  return (
    <div className="space-y-3">
      <div className="space-y-2" role="radiogroup" aria-label="Strength goal">
        {STRENGTH_GOALS.map((g) => {
          const freq = strengthTable(g)
            .filter((r) => r.phase !== "maintain" && r.phase !== "general")
            .map((r) => `${PHASE_NAME[r.phase]} ${r.sessionsPerWeek}${r.light ? " light" : ""}`)
            .join(" · ");
          return (
            <button key={g} role="radio" aria-checked={goal === g} onClick={() => setGoal(g)} className={`w-full px-4 py-3 text-left ${chip(goal === g)}`}>
              <span className="block">{STRENGTH_GOAL_LABEL[g]}</span>
              <span className={`block text-xs font-normal ${goal === g ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{STRENGTH_GOAL_TEXT[g]}</span>
              <span className={`block text-xs font-normal mt-1 ${goal === g ? "text-primary-foreground/80" : "text-muted-foreground"}`}>Sessions a week: {freq}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">A default. Your assistant may plan another count if it gives you the reason.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton label={submitLabel} disabled={saving || !goal} onClick={() => (goal === initial ? onSaved() : run({ strengthGoal: goal }))} />
    </div>
  );
}

type InjuryDraft = Omit<InjuryView, "id"> & { id: number | null };

export const emptyInjury = (description = ""): InjuryDraft => ({
  id: null,
  area: "knee",
  side: null,
  description,
  avoid: null,
  status: "active",
  startedOn: null,
  endedOn: null,
});

/** Add or edit one injury in a sheet; delete at the bottom with a confirm. */
export function InjurySheet({
  draft,
  onClose,
  onSaved,
  changeSetId,
}: {
  draft: InjuryDraft | null;
  onClose: () => void;
  onSaved: () => void;
  changeSetId?: string;
}) {
  const [d, setD] = useState<InjuryDraft | null>(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState(draft);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    setD(draft);
    setConfirmDelete(false);
    setError(null);
  }

  async function save() {
    if (!d) return;
    setSaving(true);
    setError(null);
    const { id, ...fields } = d;
    const body = { ...fields, avoid: fields.avoid?.trim() ? fields.avoid : null, ...(changeSetId ? { changeSetId } : {}) };
    const r = id ? await callAction(updateInjuryEntry({ id, ...body })) : await callAction(addInjuryEntry(body));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!d?.id) return;
    setSaving(true);
    const r = await callAction(deleteInjuryEntry({ id: d.id }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <BottomSheet open={draft !== null} onClose={onClose} blur>
      {d && (
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
          <h2 className="text-lg font-semibold">{d.id ? "Edit injury" : "New injury or limit"}</h2>
          <label className="block">
            <span className="text-xs text-muted-foreground">Where</span>
            <select
              value={d.area}
              onChange={(e) => setD({ ...d, area: e.target.value as InjuryArea })}
              aria-label="Where"
              className="mt-1 w-full min-h-[44px] rounded-xl bg-muted px-4 text-base"
            >
              {INJURY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABEL(a)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Side">
            {INJURY_SIDES.map((s) => (
              <button key={s} role="radio" aria-checked={d.side === s} onClick={() => setD({ ...d, side: d.side === s ? null : s })} className={chip(d.side === s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <textarea
            value={d.description}
            onChange={(e) => setD({ ...d, description: e.target.value })}
            maxLength={500}
            rows={3}
            aria-label="What happens"
            placeholder="For example: sore after runs over 90 minutes"
            className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
          />
          <input
            value={d.avoid ?? ""}
            onChange={(e) => setD({ ...d, avoid: e.target.value })}
            maxLength={300}
            aria-label="What to avoid"
            placeholder="What to avoid, for example: no downhill running"
            className="w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
          />
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Status">
            {(["active", "managed", "past"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={d.status === s} onClick={() => setD({ ...d, status: s })} className={`px-1 ${chip(d.status === s)}`}>
                {STATUS_TEXT[s]}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <SubmitButton label="Save injury" disabled={saving || !d.description.trim()} onClick={save} />
          {d.id &&
            (confirmDelete ? (
              <button
                onClick={remove}
                disabled={saving}
                className="w-full rounded-xl bg-destructive py-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50 active:opacity-80"
              >
                Delete for sure
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="w-full min-h-[44px] text-sm font-medium text-destructive active:opacity-60">
                Delete injury
              </button>
            ))}
        </div>
      )}
    </BottomSheet>
  );
}

/** Active and managed injuries first; past ones folded. Tap one to edit. */
export function InjuryList({ injuries, onOpen }: { injuries: InjuryView[]; onOpen: (i: InjuryView) => void }) {
  const now = injuries.filter((i) => i.status !== "past");
  const past = injuries.filter((i) => i.status === "past");
  const row = (i: InjuryView) => (
    <button key={i.id} onClick={() => onOpen(i)} className="w-full text-left rounded-xl bg-card px-4 py-3 min-h-[44px] active:opacity-60" data-testid="injury-row">
      <p className="text-sm font-medium">
        {i.side ? `${i.side[0].toUpperCase()}${i.side.slice(1)} ` : ""}
        {i.side ? i.area.replace("_", " ") : AREA_LABEL(i.area)} · {STATUS_TEXT[i.status]}
      </p>
      <p className="text-sm text-muted-foreground">{i.description}</p>
      {i.avoid && <p className="text-xs text-muted-foreground">Avoid: {i.avoid}</p>}
    </button>
  );
  return (
    <div className="space-y-2">
      {now.length === 0 && <p className="text-sm text-muted-foreground">No current injuries.</p>}
      {now.map(row)}
      {past.length > 0 && (
        <details className="space-y-2">
          <summary className="min-h-[44px] flex items-center text-sm font-medium text-muted-foreground">Healed ({past.length})</summary>
          <div className="space-y-2 pt-2">{past.map(row)}</div>
        </details>
      )}
    </div>
  );
}
