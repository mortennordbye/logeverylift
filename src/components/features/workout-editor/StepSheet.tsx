"use client";

import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { Chip, ChipGroup, LABEL, PRIMARY_BUTTON, Segmented } from "@/components/features/season-ui";
import { STEP_LABEL } from "@/components/features/workout-editor/labels";
import {
  errorsOf,
  fieldsFromTarget,
  formsText,
  nodePath,
  targetFromFields,
  typedNumber,
  updateStep,
  NO_TARGET,
  type EditNumbers,
  type TargetFields,
} from "@/lib/utils/workout-edit";
import { STEP_TYPES, WORKOUT_LIMITS, parseWorkout, type Workout, type WorkoutStep } from "@/lib/utils/workout-steps";
import { useState } from "react";

const INPUT = "w-full min-h-11 rounded-xl bg-widget-2 px-3 text-base text-foreground outline-none focus:ring-2 ring-brand";

type EndKind = "time" | "distance" | "lap";

function FieldError({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <p role="alert" className="text-[13px] text-[#ff6b5a]">
      {messages.join(". ")}
    </p>
  );
}

/** Low and high inputs; an empty one is an open end ("under 140"). */
function RangeInputs({ label, unit, low, high, onChange }: { label: string; unit: string; low: string; high: string; onChange: (low: string, high: string) => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
      <input aria-label={`${label}, low (${unit})`} inputMode="decimal" placeholder="low" value={low} onChange={(e) => onChange(e.target.value, high)} className={INPUT} />
      <span className="text-muted-foreground">to</span>
      <input aria-label={`${label}, high (${unit})`} inputMode="decimal" placeholder="high" value={high} onChange={(e) => onChange(low, e.target.value)} className={INPUT} />
      <span className="text-sm text-muted-foreground">{unit}</span>
    </div>
  );
}

/** One target: Power (W, % FTP, zone) or HR (bpm, zone), as a range, one side only, or a zone. */
function TargetEditor({
  label,
  value,
  metrics,
  onChange,
  numbers,
  errors,
}: {
  label: string;
  value: TargetFields;
  metrics: ("power" | "hr")[];
  onChange: (f: TargetFields) => void;
  numbers: EditNumbers;
  errors: string[];
}) {
  const target = targetFromFields(value);
  const forms = target ? formsText(target, "bike", numbers) : null;
  const metricOptions = [{ value: "none" as const, label: "None" }, ...metrics.map((m) => ({ value: m, label: m === "power" ? "Power" : "HR" }))];
  const unitOptions =
    value.metric === "power"
      ? [
          { value: "w" as const, label: "W" },
          { value: "pct" as const, label: "% FTP" },
          { value: "pzone" as const, label: "Zone" },
        ]
      : [
          { value: "bpm" as const, label: "bpm" },
          { value: "hzone" as const, label: numbers.zones?.source === "garmin" ? "Garmin zone" : "Zone" },
        ];
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className={`mb-2 ${LABEL}`}>{label}</legend>
      <Segmented
        label={`${label}: kind`}
        value={value.metric}
        options={metricOptions}
        track="bg-widget-2"
        onChange={(m) => onChange(m === "none" ? NO_TARGET : { ...NO_TARGET, metric: m, unit: m === "power" ? "w" : "bpm" })}
      />
      {value.metric !== "none" && value.unit === "keep" && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{forms ?? "A target the editor keeps as it is."}</span>
          <button type="button" onClick={() => onChange({ ...NO_TARGET, metric: value.metric, unit: value.metric === "power" ? "w" : "bpm" })} className="min-h-11 px-3 text-[15px] font-medium text-brand">
            Change
          </button>
        </div>
      )}
      {value.metric !== "none" && value.unit !== "keep" && (
        <>
          <Segmented label={`${label}: unit`} value={value.unit} options={unitOptions} track="bg-widget-2" onChange={(u) => onChange({ ...value, unit: u })} />
          {value.unit === "pzone" || value.unit === "hzone" ? (
            <div role="group" aria-label={`${label}: zone`} className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((z) => (
                <Chip key={z} pressed={value.zone === z} onClick={() => onChange({ ...value, zone: z })}>
                  Z{z}
                </Chip>
              ))}
            </div>
          ) : (
            <RangeInputs
              label={label}
              unit={value.unit === "w" ? "W" : value.unit === "pct" ? "% FTP" : "bpm"}
              low={value.low}
              high={value.high}
              onChange={(low, high) => onChange({ ...value, low, high })}
            />
          )}
          {forms && (
            <p className="text-sm tabular-nums" aria-live="polite" data-testid="target-forms">
              {forms}
            </p>
          )}
        </>
      )}
      <FieldError messages={errors} />
    </fieldset>
  );
}

/**
 * The step sheet (docs/plans/bike-sessions.md, 5.3): type, how it ends, the
 * main and second target, cadence, gradient and note. Every target shows its
 * other forms as the user types. Errors come from parseWorkout, at the field.
 */
export function StepSheet({ workout, step, numbers, onDone, onCancel }: { workout: Workout; step: WorkoutStep; numbers: EditNumbers; onDone: (s: WorkoutStep) => void; onCancel: () => void }) {
  const [type, setType] = useState(step.type);
  const [end, setEnd] = useState<EndKind>(step.end.type);
  const [minutes, setMinutes] = useState(step.end.type === "time" ? String(Math.floor(step.end.seconds / 60)) : "10");
  const [seconds, setSeconds] = useState(step.end.type === "time" ? String(step.end.seconds % 60) : "0");
  const [km, setKm] = useState(step.end.type === "distance" ? String(step.end.meters / 1000) : "5");
  const [main, setMain] = useState(fieldsFromTarget(step.target));
  const [second, setSecond] = useState(fieldsFromTarget(step.secondary));
  const [cadLow, setCadLow] = useState(step.cadence ? String(step.cadence.low) : "");
  const [cadHigh, setCadHigh] = useState(step.cadence ? String(step.cadence.high) : "");
  const [grade, setGrade] = useState(step.gradePercent !== undefined ? String(step.gradePercent) : "");
  const [note, setNote] = useState(step.note ?? "");

  const built: WorkoutStep = (() => {
    const s: WorkoutStep = {
      id: step.id,
      type,
      end:
        end === "time"
          ? { type: "time", seconds: (typedNumber(minutes) ?? 0) * 60 + (typedNumber(seconds) ?? 0) }
          : end === "distance"
            ? { type: "distance", meters: Math.round((typedNumber(km) ?? 0) * 1000) }
            : { type: "lap" },
    };
    const t = targetFromFields(main);
    if (t) s.target = t;
    const t2 = targetFromFields(second);
    if (t2) s.secondary = t2;
    const cl = typedNumber(cadLow);
    const ch = typedNumber(cadHigh);
    if (cl !== undefined || ch !== undefined) s.cadence = { low: cl ?? ch!, high: ch ?? cl! };
    const g = typedNumber(grade);
    if (g !== undefined) s.gradePercent = g;
    if (note.trim()) s.note = note.trim();
    return s;
  })();

  const next = updateStep(workout, step.id!, built);
  const parsed = parseWorkout(next);
  const errors = parsed.ok ? [] : errorsOf(parsed.errors, nodePath(next, step.id!));
  const at = (prefix: string) => errors.filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`)).map((e) => e.message);
  const known = ["type", "end", "target", "secondary", "cadence", "gradePercent", "note"];
  const other = errors.filter((e) => !known.some((k) => e.field === k || e.field.startsWith(`${k}.`))).map((e) => e.message);
  const otherMetric: ("power" | "hr")[] = main.metric === "power" ? ["hr"] : main.metric === "hr" ? ["power"] : [];

  return (
    <PlanSheetPanel
      label={`${STEP_LABEL[type]} step`}
      title={`${STEP_LABEL[type]} step`}
      testId="step-sheet"
      footer={
        <>
          <button
            type="button"
            disabled={errors.length > 0}
            onClick={() => onDone(built)}
            className={PRIMARY_BUTTON}
          >
            Done
          </button>
          <button type="button" onClick={onCancel} className={SHEET_CANCEL}>
            Cancel
          </button>
        </>
      }
    >
      <ChipGroup label="Type">
        {STEP_TYPES.map((t) => (
          <Chip key={t} pressed={type === t} onClick={() => setType(t)}>
            {STEP_LABEL[t]}
          </Chip>
        ))}
      </ChipGroup>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`mb-2 ${LABEL}`}>Ends by</legend>
        <Segmented
          label="Ends by"
          value={end}
          track="bg-widget-2"
          options={[
            { value: "time", label: "Time" },
            { value: "distance", label: "Distance" },
            { value: "lap", label: "Lap button" },
          ]}
          onChange={setEnd}
        />
        {end === "time" && (
          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
            <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={INPUT} />
            <span className="text-sm text-muted-foreground">min</span>
            <input aria-label="Seconds" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} className={INPUT} />
            <span className="text-sm text-muted-foreground">s</span>
          </div>
        )}
        {end === "distance" && (
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <input aria-label="Distance (km)" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} className={INPUT} />
            <span className="text-sm text-muted-foreground">km</span>
          </div>
        )}
        {end === "lap" && <p className="text-sm text-muted-foreground">The step ends when you press Lap.</p>}
        <FieldError messages={at("end")} />
      </fieldset>

      <TargetEditor label="Main target" value={main} metrics={["power", "hr"]} numbers={numbers} errors={at("target")} onChange={setMain} />
      {main.metric !== "none" && (
        <TargetEditor label="Second target" value={second} metrics={otherMetric} numbers={numbers} errors={at("secondary")} onChange={setSecond} />
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={`mb-2 ${LABEL}`}>Cadence</legend>
        <RangeInputs label="Cadence" unit="rpm" low={cadLow} high={cadHigh} onChange={(l, h) => (setCadLow(l), setCadHigh(h))} />
        <FieldError messages={at("cadence")} />
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Gradient</span>
        <span className="grid grid-cols-[1fr_auto] items-center gap-2">
          <input aria-label="Gradient (%)" inputMode="decimal" placeholder="none" value={grade} onChange={(e) => setGrade(e.target.value)} className={INPUT} />
          <span className="text-sm text-muted-foreground">%</span>
        </span>
        <FieldError messages={at("gradePercent")} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Note</span>
        <input value={note} maxLength={WORKOUT_LIMITS.note} onChange={(e) => setNote(e.target.value)} placeholder="Shown in the player" className={INPUT} />
        <span className="text-xs text-muted-foreground">
          {note.trim().length} of {WORKOUT_LIMITS.note}
        </span>
        <FieldError messages={at("note")} />
      </label>
      <FieldError messages={other} />
    </PlanSheetPanel>
  );
}
