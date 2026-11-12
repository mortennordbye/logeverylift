"use client";

import type { ThresholdKind } from "@/db/schema/athlete-profile";
import { addThresholdValue } from "@/lib/actions/athlete-profile";
import { callAction } from "@/lib/utils/stale-bundle";
import {
  THRESHOLD_LABEL,
  THRESHOLD_MEASURE,
  formatThreshold,
  paceUnitLabel,
  parseMinSec,
  parseThresholdInput,
  protocolsFor,
  thresholdRangeError,
  valueFromTest,
  type ProtocolInput,
  type ProtocolSpec,
} from "@/lib/utils/thresholds";
import { METERS_PER_MILE, type Units } from "@/lib/utils/units";
import { useState } from "react";

export type SuggestionView = { kind: ThresholdKind; value: number; basis: string };

/** A test input in the user's units, as the metric number the test takes. */
function inputValue(input: ProtocolInput, text: string, units: Units): number | null {
  if (input.kind === "seconds") return parseMinSec(text);
  const n = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(n) || n <= 0) return null;
  if (input.kind === "meters") return n * (units.distance === "mi" ? METERS_PER_MILE : 1000);
  return n;
}

function inputHint(input: ProtocolInput, units: Units): string {
  if (input.kind === "seconds") return "min:ss";
  if (input.kind === "meters") return units.distance;
  return input.kind === "bpm" ? "bpm" : "W";
}

/**
 * Enter one threshold: type the value, or do a field test and let the app
 * compute it (docs/plans/athlete-profile.md, 2.3). Admins with Garmin data see
 * the Garmin estimate with "Use this". Used on the Thresholds page and in the
 * intake interview.
 */
export function ThresholdEditor({
  kind,
  units,
  suggestion,
  changeSetId,
  onSaved,
}: {
  kind: ThresholdKind;
  units: Units;
  suggestion?: SuggestionView | null;
  changeSetId?: string;
  onSaved: () => void;
}) {
  const protocols = protocolsFor(kind);
  const [mode, setMode] = useState<"enter" | number>("enter");
  const [text, setText] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const measure = THRESHOLD_MEASURE[kind];
  const unit = measure === "watts" ? "W" : measure === "bpm" ? "bpm" : `min:ss ${paceUnitLabel(measure, units)}`;
  const protocol: ProtocolSpec | null = mode === "enter" ? null : protocols[mode];

  let preview: { value: number } | { error: string } | null = null;
  if (protocol) {
    const data: Record<string, number> = {};
    let complete = true;
    for (const i of protocol.inputs) {
      const v = inputValue(i, inputs[i.key] ?? "", units);
      if (v == null) complete = false;
      else data[i.key] = v;
    }
    if (complete) preview = valueFromTest(kind, protocol.protocol, data);
  } else if (text.trim()) {
    const v = parseThresholdInput(kind, text, units);
    preview = v == null ? { error: "Enter a number" + (measure.endsWith("Pace") ? " as min:ss" : "") } : { value: v };
  }
  const rangeError = preview && "value" in preview ? thresholdRangeError(kind, preview.value) : null;

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const r = await callAction(addThresholdValue({ kind, ...(date ? { measuredOn: date } : {}), ...(changeSetId ? { changeSetId } : {}), ...body }));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setText("");
    setInputs({});
    onSaved();
  }

  function submit() {
    if (!preview || !("value" in preview) || rangeError) return;
    if (protocol) {
      const data: Record<string, number> = {};
      for (const i of protocol.inputs) data[i.key] = inputValue(i, inputs[i.key] ?? "", units)!;
      void save({ source: "test", protocol: protocol.protocol, testData: data });
    } else {
      void save({ source: "manual", value: preview.value });
    }
  }

  return (
    <div className="space-y-3" data-testid={`threshold-editor-${kind}`}>
      {suggestion && (
        <div className="rounded-xl bg-muted px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm">Garmin estimate: {formatThreshold(kind, suggestion.value, units)}</p>
            <p className="text-xs text-muted-foreground">
              From {suggestion.basis}.{kind === "run_threshold_pace" ? " A 30-minute test is better." : ""}
            </p>
          </div>
          <button
            onClick={() => save({ source: "garmin", value: suggestion.value })}
            disabled={saving}
            className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60 disabled:opacity-50"
          >
            Use this
          </button>
        </div>
      )}
      {protocols.length > 0 && (
        <div className="flex gap-2" role="radiogroup" aria-label="How">
          {(["enter", ...protocols.map((_, i) => i)] as const).map((m) => (
            <button
              key={String(m)}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 min-h-[44px] rounded-xl px-2 text-sm font-medium active:opacity-70 ${mode === m ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {m === "enter" ? "Enter value" : protocols[m].name}
            </button>
          ))}
        </div>
      )}
      {protocol ? (
        <div className="space-y-3">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
            {protocol.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {protocol.inputs.map((i) => (
            <label key={i.key} className="block">
              <span className="text-xs text-muted-foreground">
                {i.label} ({inputHint(i, units)})
              </span>
              <input
                inputMode={i.kind === "seconds" ? "text" : "decimal"}
                value={inputs[i.key] ?? ""}
                onChange={(e) => setInputs({ ...inputs, [i.key]: e.target.value })}
                aria-label={i.label}
                className="mt-1 w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">{protocol.evidence}</p>
        </div>
      ) : (
        <label className="block">
          <span className="text-xs text-muted-foreground">
            {THRESHOLD_LABEL[kind]} ({unit})
          </span>
          <input
            inputMode={measure.endsWith("Pace") ? "text" : "numeric"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={THRESHOLD_LABEL[kind]}
            placeholder={measure === "runPace" ? "4:30" : measure === "swimPace" ? "1:45" : ""}
            className="mt-1 w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
          />
        </label>
      )}
      <label className="block">
        <span className="text-xs text-muted-foreground">Date (leave empty for today)</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          className="mt-1 w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
        />
      </label>
      {preview && "value" in preview && !rangeError && (
        <p className="text-sm font-medium" data-testid="threshold-preview">
          {THRESHOLD_LABEL[kind]}: {formatThreshold(kind, preview.value, units)}
        </p>
      )}
      {((preview && "error" in preview) || rangeError) && (
        <p className="text-sm text-destructive">{preview && "error" in preview ? preview.error : rangeError}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || !preview || !("value" in preview) || !!rangeError}
        className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
      >
        Save {THRESHOLD_LABEL[kind]}
      </button>
    </div>
  );
}
