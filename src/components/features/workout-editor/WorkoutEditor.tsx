"use client";

import { PlanSheetPanel, SHEET_CANCEL } from "@/components/features/PlanSheetPanel";
import { FormHeader, LABEL, PinnedBar, PRIMARY_BUTTON } from "@/components/features/season-ui";
import { STEP_LABEL } from "@/components/features/workout-editor/labels";
import { ProfileChart } from "@/components/features/workout-editor/ProfileChart";
import { SaveSheet, type EditorContext, type SaveOutcome } from "@/components/features/workout-editor/SaveSheet";
import { StepSheet } from "@/components/features/workout-editor/StepSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useBack } from "@/components/ui/BackLink";
import { undoPlanChangeSet } from "@/lib/actions/plan-revisions";
import { callAction } from "@/lib/utils/stale-bundle";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import {
  addStep,
  deleteNode,
  duplicateNode,
  errorsOf,
  findNode,
  flatten,
  insertNodes,
  moveBy,
  moveNode,
  nodePath,
  profileBlocks,
  scaleWorkout,
  setRepeatCount,
  ungroup,
  updateStep,
  type EditNumbers,
  type FlatItem,
} from "@/lib/utils/workout-edit";
import { WORKOUT_TEMPLATES } from "@/lib/utils/workout-templates";
import { WORKOUT_LIMITS, estimateWorkout, parseWorkout, targetLabel, type Workout, type WorkoutRepeat, type WorkoutStep } from "@/lib/utils/workout-steps";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const INPUT = "w-full min-h-11 rounded-xl bg-widget-2 px-3 text-base text-foreground outline-none focus:ring-2 ring-brand";
const ICON_BUTTON = "h-11 w-11 shrink-0 flex items-center justify-center text-muted-foreground active:opacity-70";

type Sheet = { kind: "step"; id: string } | { kind: "menu"; key: string } | { kind: "add" } | { kind: "save" } | { kind: "cancel" } | null;

function minutesText(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

function endText(s: WorkoutStep): string {
  if (s.end.type === "lap") return "to Lap";
  if (s.end.type === "distance") return `${+(s.end.meters / 1000).toFixed(2)} km`;
  const { seconds } = s.end;
  return seconds % 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min` : `${seconds / 60} min`;
}

function stepLine(s: WorkoutStep, sport: Workout["sport"]): string {
  const parts: string[] = [];
  if (s.target) parts.push(targetLabel(s.target, sport));
  if (s.secondary) parts.push(targetLabel(s.secondary, sport));
  if (s.cadence) parts.push(`${s.cadence.low}-${s.cadence.high} rpm`);
  if (s.gradePercent !== undefined) parts.push(`${s.gradePercent} % grade`);
  return parts.join(" · ") || "No target";
}

function Handle({ label, listeners, attributes }: { label: string; listeners: ReturnType<typeof useSortable>["listeners"]; attributes: ReturnType<typeof useSortable>["attributes"] }) {
  return (
    <button type="button" className={`${ICON_BUTTON} touch-none cursor-grab`} {...attributes} {...listeners} aria-label={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
      </svg>
    </button>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={ICON_BUTTON}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>
  );
}

/** One row of the list: a step, a repeat's head (count stepper), or a repeat's end ("Add step to repeat"). */
function Row({
  item,
  draft,
  index,
  errors,
  onOpen,
  onMenu,
  onCount,
  onAddInto,
}: {
  item: FlatItem;
  draft: Workout;
  index: number;
  errors: string[];
  onOpen: (id: string) => void;
  onMenu: (key: string) => void;
  onCount: (id: string, count: number) => void;
  onAddInto: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled: item.kind === "end" });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const inRepeat = item.kind !== "step" || item.parent !== null;
  const box = inRepeat ? `bg-widget-2 ${item.kind === "head" ? "rounded-t-2xl pt-1" : item.kind === "end" ? "rounded-b-2xl pb-1 mb-2" : ""}` : "mb-2";

  if (item.kind === "end") {
    return (
      <li ref={setNodeRef} style={style} className={`${box} px-2`}>
        <button type="button" onClick={() => onAddInto(item.id)} className="min-h-11 w-full rounded-xl text-[15px] font-medium text-brand active:opacity-70">
          Add step to repeat
        </button>
      </li>
    );
  }
  if (item.kind === "head") {
    const r = findNode(draft, item.id) as WorkoutRepeat;
    return (
      <li ref={setNodeRef} style={style} className={`${box} flex items-center gap-1 pr-1`} data-testid="editor-repeat">
        <Handle label={`Reorder repeat ${r.count} times`} listeners={listeners} attributes={attributes} />
        <span className="flex-1 text-[15px] font-semibold">Repeat</span>
        <button type="button" aria-label="Fewer times" disabled={r.count <= WORKOUT_LIMITS.repeatCount.min} onClick={() => onCount(item.id, r.count - 1)} className={`${ICON_BUTTON} text-xl disabled:opacity-30`}>
          −
        </button>
        <span className="w-10 text-center text-base font-semibold tabular-nums" aria-live="polite" data-testid="repeat-count">
          {r.count} x
        </span>
        <button type="button" aria-label="More times" disabled={r.count >= WORKOUT_LIMITS.repeatCount.max} onClick={() => onCount(item.id, r.count + 1)} className={`${ICON_BUTTON} text-xl disabled:opacity-30`}>
          +
        </button>
        <MenuButton label="Repeat options" onClick={() => onMenu(item.key)} />
      </li>
    );
  }
  const s = findNode(draft, item.id) as WorkoutStep;
  const name = `${STEP_LABEL[s.type]} ${endText(s)}`;
  return (
    <li ref={setNodeRef} style={style} className={`${box} ${inRepeat ? "px-2 pb-1" : ""}`} data-testid="editor-step">
      <div className={`flex items-center gap-1 rounded-2xl bg-widget pr-1 ${errors.length ? "ring-1 ring-[#ff6b5a]" : ""}`}>
        <Handle label={`Reorder ${name}`} listeners={listeners} attributes={attributes} />
        <button type="button" onClick={() => onOpen(item.id)} aria-label={`Step ${index}: ${name}. Edit`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 text-left active:opacity-70">
          <span className="text-[15px] font-semibold">
            {STEP_LABEL[s.type]} · {endText(s)}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">{stepLine(s, draft.sport)}</span>
          {s.note && <span className="truncate text-[13px]">{s.note}</span>}
          {errors.map((e) => (
            <span key={e} className="text-[13px] text-[#ff6b5a]">
              {e}
            </span>
          ))}
        </button>
        <MenuButton label={`Options for ${name}`} onClick={() => onMenu(item.key)} />
      </div>
    </li>
  );
}

/**
 * The full workout editor (docs/plans/bike-sessions.md, 5.3): name, coach
 * note, a live summary with a profile chart, the step list with drag to
 * reorder and into or out of a repeat, the step sheet, Add (step, repeat,
 * template), Easier and Harder 5 %, and the save sheet. Every save is one
 * user change set, and Undo here undoes it.
 */
export function WorkoutEditor({
  initial,
  numbers,
  context: startContext,
  title,
  back,
}: {
  initial: Workout;
  numbers: EditNumbers;
  context: EditorContext;
  title: string;
  /** Where Cancel and Done go when there is no in-app history. */
  back: { href: string; label: string };
}) {
  const router = useRouter();
  const leave = useBack(back);
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [context, setContext] = useState(startContext);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const dirty = JSON.stringify(draft) !== baseline;
  const parsed = useMemo(() => parseWorkout(draft), [draft]);
  const errors = parsed.ok ? [] : parsed.errors;
  const items = flatten(draft);
  const thresholds = useMemo(() => ({ ...(numbers.ftp && { ftp: numbers.ftp }), ...(numbers.lthrBike && { lthr_bike: numbers.lthrBike }) }), [numbers]);
  const estimate = estimateWorkout(draft, thresholds);
  const load = workoutPlannedLoad(draft, thresholds);
  const blocks = profileBlocks(draft, numbers);
  const fieldErrors = (path: string) => [...errors.filter((e) => e.path === path).map((e) => e.message), ...(serverErrors[path] ?? [])];
  const stepNumber = new Map(items.filter((i) => i.kind === "step").map((i, n) => [i.key, n + 1]));

  function change(next: Workout) {
    setDraft(next);
    setServerErrors({});
    setNotice(null);
  }

  function onDragEnd(e: DragEndEvent) {
    if (e.over && e.active.id !== e.over.id) change(moveNode(draft, String(e.active.id), String(e.over.id)));
  }

  function addAndOpen(next: Workout) {
    const before = new Set(flatten(draft).map((i) => i.key));
    change(next);
    const added = flatten(next).find((i) => i.kind === "step" && !before.has(i.key));
    setSheet(added ? { kind: "step", id: added.key } : null);
  }

  async function undo() {
    if (!saved || pending) return;
    setPending(true);
    const r = await callAction(undoPlanChangeSet({ changeSetId: saved.changeSetId }));
    setPending(false);
    if (!r.success) {
      setNotice(r.error);
      return;
    }
    setBaseline(JSON.stringify(initial));
    setContext(startContext);
    setSaved(null);
    setNotice("Undone. Your edits are still here; save again or cancel.");
    router.refresh();
  }

  const menuItem = sheet?.kind === "menu" ? items.find((i) => i.key === sheet.key) : undefined;
  const menuRow = "flex w-full items-center min-h-[52px] px-3.5 border-b border-hairline last:border-b-0 text-left text-[15px] font-medium active:bg-foreground/5";

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <FormHeader
        title={title}
        sub={draft.name || undefined}
        left={
          <button type="button" onClick={() => (dirty ? setSheet({ kind: "cancel" }) : leave.go())} className="min-h-11 px-2 text-[15px] text-brand active:opacity-70">
            {saved && !dirty ? "Done" : "Cancel"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-36 flex flex-col gap-4">
        {saved && (
          <div role="status" className="flex flex-col gap-2 rounded-2xl bg-widget p-3" data-testid="editor-saved">
            <p className="text-[15px] font-semibold">{saved.message}</p>
            {saved.warnings.map((w) => (
              <p key={w} className="text-[13px] text-amber-700 dark:text-amber-300">
                Training limit: {w}
              </p>
            ))}
            <p className="text-[13px] text-muted-foreground">Undo is also in the plan history.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={pending} onClick={undo} className="min-h-11 rounded-xl bg-widget-2 text-[15px] font-medium active:opacity-70 disabled:opacity-50">
                Undo
              </button>
              <button type="button" onClick={() => leave.go()} className="min-h-11 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-80">
                Done
              </button>
            </div>
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input value={draft.name} maxLength={WORKOUT_LIMITS.name} onChange={(e) => change({ ...draft, name: e.target.value })} className={INPUT} placeholder="Tempo 2 x 15 min" />
          {fieldErrors("name").map((m) => (
            <span key={m} role="alert" className="text-[13px] text-[#ff6b5a]">
              {m}
            </span>
          ))}
        </label>
        <p className="text-sm text-muted-foreground">Sport: Bike</p>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Coach note</span>
          <textarea
            value={draft.description ?? ""}
            maxLength={WORKOUT_LIMITS.description}
            rows={2}
            onChange={(e) => change({ ...draft, description: e.target.value || undefined })}
            className={`${INPUT} py-2.5 resize-none`}
            placeholder="How the session should feel"
          />
          {fieldErrors("description").map((m) => (
            <span key={m} role="alert" className="text-[13px] text-[#ff6b5a]">
              {m}
            </span>
          ))}
        </label>

        <section aria-label="Summary" className="flex flex-col gap-2 rounded-2xl bg-widget p-3" data-testid="editor-summary">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-bold tabular-nums">
                {estimate.durationComplete ? "" : "≥ "}
                {minutesText(estimate.durationSeconds)}
              </p>
              <p className={LABEL}>Total</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{minutesText(estimate.hardSeconds)}</p>
              <p className={LABEL}>Hard</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">~{Math.round(load.load)}</p>
              <p className={LABEL}>Load</p>
            </div>
          </div>
          <ProfileChart blocks={blocks} />
        </section>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => change(scaleWorkout(draft, 0.95))} className="min-h-11 rounded-xl bg-widget text-[15px] font-medium active:opacity-70">
            Easier 5 %
          </button>
          <button type="button" onClick={() => change(scaleWorkout(draft, 1.05))} className="min-h-11 rounded-xl bg-widget text-[15px] font-medium active:opacity-70">
            Harder 5 %
          </button>
        </div>

        <section aria-label="Steps" className="flex flex-col">
          <h2 className={`${LABEL} mb-2`}>Steps</h2>
          {fieldErrors("steps").map((m) => (
            <p key={m} role="alert" className="mb-2 text-[13px] text-[#ff6b5a]">
              {m}
            </p>
          ))}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col" data-testid="editor-steps">
                {items.map((item) => {
                  const path = item.kind === "step" ? nodePath(draft, item.id) : null;
                  const own = [...errorsOf(errors, path).map((e) => `${e.field ? `${e.field}: ` : ""}${e.message}`)];
                  return (
                    <Row
                      key={item.key}
                      item={item}
                      draft={draft}
                      index={stepNumber.get(item.key) ?? 0}
                      errors={own}
                      onOpen={(id) => setSheet({ kind: "step", id })}
                      onMenu={(key) => setSheet({ kind: "menu", key })}
                      onCount={(id, n) => change(setRepeatCount(draft, id, n))}
                      onAddInto={(id) => addAndOpen(addStep(draft, { type: "work", end: { type: "time", seconds: 300 } }, id))}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
          <button type="button" onClick={() => setSheet({ kind: "add" })} className="min-h-[52px] rounded-2xl border border-dashed border-hairline text-[15px] font-medium text-brand active:opacity-70">
            Add
          </button>
        </section>
      </div>

      <PinnedBar>
        <button
          type="button"
          disabled={!parsed.ok}
          aria-describedby={parsed.ok ? undefined : "save-reason"}
          onClick={() => setSheet({ kind: "save" })}
          className={PRIMARY_BUTTON}
        >
          Save
        </button>
        {!parsed.ok && (
          <p id="save-reason" className="mt-2 text-center text-[13px] text-muted-foreground">
            Fix the marked fields to save.
          </p>
        )}
      </PinnedBar>

      <BottomSheet open={sheet?.kind === "step"} onClose={() => setSheet(null)}>
        {sheet?.kind === "step" && findNode(draft, sheet.id) && (
          <StepSheet
            key={sheet.id}
            workout={draft}
            step={findNode(draft, sheet.id) as WorkoutStep}
            numbers={numbers}
            onCancel={() => setSheet(null)}
            onDone={(s) => {
              change(updateStep(draft, sheet.id, s));
              setSheet(null);
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "menu"} onClose={() => setSheet(null)}>
        {menuItem && menuItem.kind !== "end" && (
          <PlanSheetPanel label="Step options" title={menuItem.kind === "head" ? "Repeat" : "Step"} testId="step-menu">
            <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
              {(
                [
                  ["Move up", () => moveBy(draft, menuItem.key, -1)],
                  ["Move down", () => moveBy(draft, menuItem.key, 1)],
                  ["Duplicate", () => duplicateNode(draft, menuItem.id)],
                  ...(menuItem.kind === "head" ? ([["Ungroup", () => ungroup(draft, menuItem.id)]] as const) : []),
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  type="button"
                  className={menuRow}
                  onClick={() => {
                    change(fn());
                    setSheet(null);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`${menuRow} text-[#ff6b5a]`}
                onClick={() => {
                  change(deleteNode(draft, menuItem.id));
                  setSheet(null);
                }}
              >
                {menuItem.kind === "head" ? "Delete repeat" : "Delete step"}
              </button>
            </div>
          </PlanSheetPanel>
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "add"} onClose={() => setSheet(null)}>
        {sheet?.kind === "add" && (
          <PlanSheetPanel label="Add" title="Add" testId="add-sheet">
            <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
              <button type="button" className={menuRow} onClick={() => addAndOpen(addStep(draft, { type: "work", end: { type: "time", seconds: 600 } }))}>
                Step
              </button>
              <button
                type="button"
                className={menuRow}
                onClick={() => {
                  change(
                    insertNodes(draft, [
                      {
                        type: "repeat",
                        count: 2,
                        steps: [
                          { type: "work", end: { type: "time", seconds: 300 } },
                          { type: "recovery", end: { type: "time", seconds: 120 } },
                        ],
                      },
                    ]),
                  );
                  setSheet(null);
                }}
              >
                Repeat
              </button>
            </div>
            <h3 className={LABEL}>From a template</h3>
            <div className="flex flex-col rounded-2xl bg-widget-2 overflow-hidden">
              {WORKOUT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={menuRow}
                  onClick={() => {
                    change(insertNodes(draft, t.nodes));
                    setSheet(null);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </PlanSheetPanel>
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "save"} onClose={() => setSheet(null)}>
        {sheet?.kind === "save" && parsed.ok && (
          <SaveSheet
            context={context}
            workout={parsed.workout}
            onCancel={() => setSheet(null)}
            onFieldErrors={setServerErrors}
            onSaved={(o) => {
              setSaved(o);
              setNotice(null);
              setBaseline(JSON.stringify(draft));
              if (o.workoutId != null && context.kind === "new") setContext({ kind: "library", workoutId: o.workoutId });
              setSheet(null);
              router.refresh();
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "cancel"} onClose={() => setSheet(null)}>
        {sheet?.kind === "cancel" && (
          <PlanSheetPanel label="Drop your changes?" title="Drop your changes?" testId="cancel-sheet">
            <p className="text-[15px] text-muted-foreground">You changed this workout and did not save it.</p>
            <button type="button" onClick={() => leave.go()} className="min-h-[52px] w-full rounded-2xl bg-destructive text-base font-semibold text-destructive-foreground active:opacity-80">
              Drop changes
            </button>
            <button type="button" onClick={() => setSheet(null)} className={SHEET_CANCEL}>
              Keep editing
            </button>
          </PlanSheetPanel>
        )}
      </BottomSheet>
    </div>
  );
}

