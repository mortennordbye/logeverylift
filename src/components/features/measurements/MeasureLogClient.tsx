"use client";

import { PartViews } from "@/components/features/measurements/BodyFigure";
import { MeasureGuide } from "@/components/features/measurements/measurement-ui";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useKeyboardHeight } from "@/components/ui/use-keyboard-height";
import type { BodySide } from "@/db/schema/body-measurements";
import { saveBodyMeasurement } from "@/lib/actions/body-measurements";
import {
  BODY_PARTS,
  CIRCUMFERENCE_STEPS,
  LENGTH_STEPS,
  mirrorTape,
  partOf,
  type BodyPart,
  type LogStep,
} from "@/lib/utils/body-measurement-parts";
import { formatChange, formatCm, round1, seriesOf, type MeasurementRow } from "@/lib/utils/body-measurements";
import { formatDateShort, sanitizeDecimalInput } from "@/lib/utils/format";
import { MIN_FIGURE_PX, fitMeasureStep } from "@/lib/utils/measure-step-fit";
import { callAction } from "@/lib/utils/stale-bundle";
import { Check, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

const SIDE_WORD: Record<BodySide, string> = { none: "", left: "Left", right: "Right" };
/** Saved values are kept per log date: going Back to change the date starts it empty. */
const keyOf = (s: LogStep, date: string) => `${date}|${s.site}:${s.side}`;

function subtitle(part: BodyPart, side: BodySide): string {
  if (part.kind === "length") return "Length · tape along the body";
  if (!part.sides) return "Trunk · tape around the body";
  const limb = part.site === "upper-arm" || part.site === "forearm" ? "arm" : "leg";
  return `${SIDE_WORD[side]} ${limb} · relaxed`;
}

/** The first sentence of where to measure, for the one line on a step. */
/** The figures' height beside the text while the keypad is open. */
const COMPACT_FIGURE_PX = 140;
const shortWhere = (where: string) => where.split(/(?<=\.)\s/)[0];

/** A typed value, or null when it is not a number from 1 to 300. */
function parseCm(text: string): number | null {
  const v = Number(text);
  return text.trim() !== "" && Number.isFinite(v) && v >= 1 && v <= 300 ? round1(v) : null;
}

/**
 * Logging as steps, one part per screen (docs/plans/body-measurements.md,
 * decisions 9 to 13). Each step saves when the user goes on; the Done screen
 * shows the values of the log date and corrects them.
 */
export function MeasureLogClient({ rows, today }: { rows: MeasurementRow[]; today: string }) {
  const hasLengths = rows.some((r) => partOf(r.site)?.kind === "length");
  const [steps] = useState(() => (hasLengths ? CIRCUMFERENCE_STEPS : [...CIRCUMFERENCE_STEPS, ...LENGTH_STEPS]));
  const [index, setIndex] = useState(0);
  const [date, setDate] = useState(today);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [fixing, setFixing] = useState<BodyPart | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const figures = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const keypad = useKeyboardHeight(true);
  const compact = keypad > 0;
  const [figureCap, setFigureCap] = useState<number | undefined>(undefined);
  const [, remeasure] = useReducer((n: number) => n + 1, 0);

  const done = index >= steps.length;
  const step = steps[Math.min(index, steps.length - 1)];
  const part = partOf(step.site)!;
  /** The latest value before the log date: "Last time", and what Same keeps. */
  const before = (s: LogStep) => seriesOf(rows, s.site, s.side).filter((r) => r.measuredOn < date).at(-1) ?? null;
  const onDate = (s: LogStep) => saved[keyOf(s, date)] ?? rows.find((r) => r.site === s.site && r.side === s.side && r.measuredOn === date)?.valueCm ?? null;
  const last = before(step);

  // Each step starts with the last value, selected, so typing replaces it.
  useEffect(() => {
    if (done) return;
    const start = onDate(step) ?? last?.valueCm ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each step starts with its last value, then selects it; the select must run after the new value is in the input
    setText(start === null ? "" : start.toFixed(1));
    setError(null);
    requestAnimationFrame(() => input.current?.select());
    // Only when the step or the log date changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done, date]);

  // The step down to Next fits in what the keypad leaves visible (and on a
  // small screen): the figures give up the height. Measured after each render.
  useLayoutEffect(() => {
    const svg = figures.current?.querySelector("svg");
    if (!svg || !actions.current || !form.current) return;
    const fit = fitMeasureStep({
      visible: window.innerHeight - keypad,
      bottom: actions.current.getBoundingClientRect().bottom,
      figure: svg.getBoundingClientRect().height,
    });
    // The whole step fits: undo the scroll that focusing the field at full size made.
    if (fit.scrollBy > 0) form.current.scrollTop += fit.scrollBy;
    else if (fit.figure > MIN_FIGURE_PX) form.current.scrollTop = 0;
    setFigureCap((cap) => (cap !== undefined && Math.abs(cap - fit.figure) < 1 ? cap : fit.figure));
  });
  useEffect(() => {
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, []);

  async function save(s: LogStep, valueCm: number): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await callAction(saveBodyMeasurement({ site: s.site, side: s.side, valueCm, measuredOn: date }));
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return false;
    }
    setSaved((prev) => ({ ...prev, [keyOf(s, date)]: result.data.valueCm }));
    return true;
  }

  async function next(valueText = text) {
    if (busy) return;
    if (valueText.trim() === "") return setIndex((i) => i + 1);
    const v = parseCm(valueText);
    if (v === null) return setError("Type a value from 1 to 300 cm");
    if (await save(step, v)) setIndex((i) => i + 1);
  }

  function nudge(by: number) {
    const base = parseCm(text) ?? last?.valueCm ?? null;
    if (base === null) return;
    setText(Math.min(300, Math.max(1, round1(base + by))).toFixed(1));
    setError(null);
  }

  // Buttons keep the focus in the field, so the keypad stays open between steps.
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  // Focused in the tap that closes the guide, so the keypad opens again.
  function closeGuide() {
    setGuideOpen(false);
    input.current?.focus();
    input.current?.select();
  }

  // A correction sheet opens without the error of an earlier save.
  function fix(p: BodyPart | null) {
    setError(null);
    setFixing(p);
  }

  if (done) return <DoneScreen steps={steps} date={date} onDate={onDate} before={before} onFix={fix} fixing={fixing} save={save} error={error} />;

  const tape = part.tape && (step.side === "left" ? mirrorTape(part.tape) : part.tape);
  const title = part.sides ? `${part.name} · ${SIDE_WORD[step.side].toLowerCase()}` : part.name;
  const quick = "flex-1 min-h-[44px] rounded-xl bg-muted text-sm font-medium active:opacity-60 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-30 w-full max-w-md mx-auto bg-background flex flex-col overflow-hidden" data-testid="measure-step">
      <div className="flex items-center justify-between px-4 pt-4 shrink-0">
        {index === 0 ? (
          <Link href="/more/account/measurements" replace className="min-h-[44px] flex items-center text-primary text-sm font-medium">
            Cancel
          </Link>
        ) : (
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setIndex((i) => i - 1)}
            aria-label="Back to the previous step"
            className="min-h-[44px] min-w-[44px] flex items-center gap-0.5 text-primary text-sm font-medium active:opacity-60"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>
        )}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {index > 0 && (
            <>
              <Link href="/more/account/measurements" replace className="min-h-[44px] flex items-center text-primary font-medium">
                Cancel
              </Link>
              <span aria-hidden="true">·</span>
            </>
          )}
          {index === 0 && (
            <label className="relative min-h-[44px] flex items-center text-primary font-medium">
              {date === today ? "Today" : formatDateShort(date)} ›
              <input
                type="date"
                aria-label="Log date"
                value={date}
                max={today}
                onChange={(e) => e.target.value && e.target.value <= today && setDate(e.target.value)}
                className="absolute inset-0 opacity-0"
              />
            </label>
          )}
          {index === 0 && <span aria-hidden="true">·</span>}
          <span data-testid="step-count">
            {index + 1} of {steps.length}
          </span>
        </div>
      </div>
      <div className="mx-4 h-1 rounded-full bg-muted overflow-hidden shrink-0">
        <div className="h-full bg-primary" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>

      <form
        ref={form}
        className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 flex flex-col gap-2"
        // Room under the keypad, so a step too tall for what is left can scroll Next above it.
        style={keypad > 0 ? { paddingBottom: keypad + 16 } : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {!compact && (
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">{subtitle(part, step.side)}</p>
          </div>
        )}
        {/* With the keypad open the figures sit beside the text, so the title stays in view. */}
        <div ref={figures} className={compact ? "rounded-xl bg-card p-3 shrink-0 flex items-center gap-3" : "rounded-xl bg-card px-3 pt-3 pb-1 shrink-0"}>
          <div className={compact ? "w-[45%] shrink-0" : undefined}>
            <PartViews tape={tape} rule={part.rule} name={part.name} className="w-full h-auto" maxHeight={compact ? Math.min(figureCap ?? COMPACT_FIGURE_PX, COMPACT_FIGURE_PX) : figureCap} />
          </div>
          <div className={compact ? "flex-1 min-w-0" : undefined}>
            {compact && <h1 className="text-lg font-semibold leading-tight">{title}</h1>}
            {/* Two lines high on every step, so the field stays in one place. */}
            <p className={compact ? "text-sm mt-1 line-clamp-3" : "text-sm mt-2 h-10 line-clamp-2"}>{shortWhere(part.where)}</p>
            <button type="button" onMouseDown={keepFocus} onClick={() => setGuideOpen(true)} className="min-h-[44px] text-sm text-primary font-medium">
              How to measure ›
            </button>
          </div>
        </div>
        <div className="flex items-baseline justify-center gap-2 pt-1">
          <input
            ref={input}
            autoFocus
            type="text"
            inputMode="decimal"
            enterKeyHint="next"
            aria-label={`${title} in cm`}
            value={text}
            onChange={(e) => {
              setText(sanitizeDecimalInput(e.target.value));
              setError(null);
            }}
            onFocus={(e) => e.target.select()}
            className="w-36 min-h-[48px] bg-transparent text-center text-4xl! font-bold tabular-nums outline-none border-b-2 border-primary"
          />
          <span className="text-base text-muted-foreground">cm</span>
        </div>
        <p className="text-xs text-muted-foreground text-center" data-testid="last-time">
          {last ? `Last time ${formatCm(last.valueCm)} cm · ${formatDateShort(last.measuredOn)}` : "First time"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive text-center">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onMouseDown={keepFocus} onClick={() => nudge(-0.5)} disabled={busy || (!last && parseCm(text) === null)} className={quick}>
            − 0.5
          </button>
          {last && (
            <button type="button" onMouseDown={keepFocus} onClick={() => next(String(last.valueCm))} disabled={busy} className={quick}>
              Same
            </button>
          )}
          <button type="button" onMouseDown={keepFocus} onClick={() => nudge(0.5)} disabled={busy || (!last && parseCm(text) === null)} className={quick}>
            + 0.5
          </button>
        </div>
        <div ref={actions} className="flex gap-2">
          <button type="button" onMouseDown={keepFocus} onClick={() => setIndex((i) => i + 1)} disabled={busy} className="flex-1 min-h-[48px] rounded-xl text-sm font-medium text-muted-foreground active:opacity-60">
            Skip
          </button>
          <button type="submit" onMouseDown={keepFocus} disabled={busy} className="flex-[2] min-h-[48px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80 disabled:opacity-50">
            {busy ? "Saving…" : "Next"}
          </button>
        </div>
      </form>

      <BottomSheet open={guideOpen} onClose={closeGuide} blur>
        <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">How to measure · {part.name.toLowerCase()}</h2>
            <button onClick={closeGuide} className="text-primary text-sm font-medium min-h-[44px] px-1">
              Close
            </button>
          </div>
          <MeasureGuide part={part} tape={tape} />
        </div>
      </BottomSheet>
    </div>
  );
}

function DoneScreen({
  steps,
  date,
  onDate,
  before,
  fixing,
  onFix,
  save,
  error,
}: {
  steps: LogStep[];
  date: string;
  onDate: (s: LogStep) => number | null;
  before: (s: LogStep) => MeasurementRow | null;
  fixing: BodyPart | null;
  onFix: (p: BodyPart | null) => void;
  save: (s: LogStep, v: number) => Promise<boolean>;
  error: string | null;
}) {
  const count = steps.filter((s) => onDate(s) !== null).length;
  const skipped = steps.length - count;
  const parts = BODY_PARTS.filter((p) => steps.some((s) => s.site === p.site));
  const stepsOf = (p: BodyPart) => steps.filter((s) => s.site === p.site).sort((a, b) => a.side.localeCompare(b.side));

  return (
    <div className="fixed inset-0 z-30 w-full max-w-md mx-auto bg-background flex flex-col overflow-hidden" data-testid="measure-done">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-8 pb-4 flex flex-col gap-4">
        <div className="flex flex-col items-center text-center gap-1">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="w-6 h-6" />
          </span>
          <h1 className="text-xl font-semibold mt-2">Saved · {formatDateShort(date)}</h1>
          <p className="text-sm text-muted-foreground">
            {count} of {steps.length} values{skipped > 0 && ` · ${skipped} skipped`}
          </p>
        </div>
        <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/50">
          {parts.map((p) => {
            const ss = stepsOf(p);
            const values = ss.map(onDate);
            const empty = values.every((v) => v === null);
            let shown: string;
            let change: string | null = null;
            if (empty) shown = "Skipped";
            else if (p.sides) shown = ss.map((s, i) => `${s.side === "left" ? "L" : "R"} ${values[i] === null ? "skipped" : formatCm(values[i]!)}`).join(" · ");
            else {
              shown = `${formatCm(values[0]!)} cm`;
              const prev = before(ss[0]);
              if (prev) change = formatChange(values[0]! - prev.valueCm);
            }
            return (
              <button key={p.site} onClick={() => onFix(p)} className="flex items-center gap-3 w-full px-4 min-h-[52px] py-3 text-left active:opacity-60" data-testid={`done-row-${p.site}`}>
                <span className="flex-1 text-sm">{p.name}</span>
                <span className={`text-sm tabular-nums ${empty ? "text-muted-foreground" : "font-semibold"}`}>{shown}</span>
                {change && <span className="text-xs text-muted-foreground tabular-nums">{change}</span>}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground text-center">Tap a value to correct it</p>
      </div>
      <div className="shrink-0 px-4 pt-3 pb-6">
        <Link
          href="/more/account/measurements"
          replace
          className="flex items-center justify-center w-full min-h-[52px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80"
        >
          Done
        </Link>
      </div>

      <BottomSheet open={fixing !== null} onClose={() => onFix(null)} blur>
        {fixing && <FixSheet key={fixing.site} part={fixing} steps={stepsOf(fixing)} onDate={onDate} save={save} error={error} onClose={() => onFix(null)} />}
      </BottomSheet>
    </div>
  );
}

/** Correct one part of the log date: a field per side. */
function FixSheet({
  part,
  steps,
  onDate,
  save,
  error,
  onClose,
}: {
  part: BodyPart;
  steps: LogStep[];
  onDate: (s: LogStep) => number | null;
  save: (s: LogStep, v: number) => Promise<boolean>;
  error: string | null;
  onClose: () => void;
}) {
  const [texts, setTexts] = useState(() => steps.map((s) => onDate(s)?.toFixed(1) ?? ""));
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);

  async function submit() {
    const values = texts.map((t) => (t.trim() === "" ? null : parseCm(t)));
    if (values.some((v, i) => v === null && texts[i].trim() !== "")) return setInvalid(true);
    setBusy(true);
    for (let i = 0; i < steps.length; i++) {
      if (values[i] !== null && values[i] !== onDate(steps[i]) && !(await save(steps[i], values[i]!))) return setBusy(false);
    }
    setBusy(false);
    onClose();
  }

  return (
    <form
      className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{part.name}</h2>
        <button type="button" onClick={onClose} className="text-primary text-sm font-medium min-h-[44px] px-1">
          Cancel
        </button>
      </div>
      {steps.map((s, i) => {
        const label = part.sides ? `${SIDE_WORD[s.side]} ${part.name.toLowerCase()}` : part.name;
        return (
          <label key={s.side} className="flex items-center gap-3">
            <span className="flex-1 text-sm">{label}</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus={i === 0}
              onFocus={(e) => e.target.select()}
              aria-label={`${label} in cm`}
              value={texts[i]}
              onChange={(e) => {
                const v = sanitizeDecimalInput(e.target.value);
                setTexts((prev) => prev.map((t, j) => (j === i ? v : t)));
                setInvalid(false);
              }}
              className="w-28 rounded-xl bg-muted px-4 py-3 text-sm text-right tabular-nums outline-none focus:ring-2 ring-primary"
            />
            <span className="text-sm text-muted-foreground w-6">cm</span>
          </label>
        );
      })}
      {(invalid || error) && (
        <p role="alert" className="text-xs text-destructive">
          {invalid ? "Type a value from 1 to 300 cm" : error}
        </p>
      )}
      <button type="submit" disabled={busy} className="w-full min-h-[52px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80 disabled:opacity-50">
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
