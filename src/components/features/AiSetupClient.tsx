"use client";

import { AiConsentSheet } from "@/components/features/AiConsentSheet";
import { recordAiSetupImport, type RevisionStart } from "@/lib/actions/ai-checkin";
import { editPlanWithAi } from "@/lib/actions/ai-generate";
import { importPlanPayload } from "@/lib/import-plan";
import { EDIT_CHIPS, EDIT_TEXT_MAX, OWN_AI_NEEDED, type EditChipId, type EditRequest } from "@/lib/utils/ai-edit";
import { aiGeneratingStartedAt, isAiGenerating, setAiGenerating } from "@/lib/utils/ai-generating";
import { aiPlanSchema, matchLibraryNames, toImportPayload, uniqueProgramNames, type AiPlan } from "@/lib/utils/ai-plan";
import { type PrData } from "@/lib/utils/ai-prompt";
import {
  AVOID_AREAS,
  buildTemplatePlan,
  estimateSessionMinutes,
  MAX_PRIORITIES,
  PRIORITY_MUSCLES,
  SESSION_MINUTES,
  SPLIT_DAYS,
  splitSupports,
  TEMPLATE_DAYS,
  templateDefaults,
  TEMPLATE_SPLITS,
  type AvoidArea,
  type PriorityMuscle,
  type SessionMinutes,
  type TemplateEquipment,
  type TemplateGoal,
  type TemplateLevel,
  type TemplateParams,
  type TemplateSplit,
} from "@/lib/utils/plan-templates";
import { templateParamsSchema } from "@/lib/validators/ai-setup";
import type { Exercise } from "@/types/workout";
import { ArrowLeft, Check, ChevronDown, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

// An AI edit can outlive the page: the result is parked here for the next visit.
const AI_PENDING_KEY = "ai_pending_edit";
const AI_PENDING_ERROR_KEY = "ai_pending_error";
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

const pendingSchema = z.object({
  picks: templateParamsSchema,
  chips: z.array(z.string()),
  text: z.string(),
  plan: aiPlanSchema,
  fromCache: z.boolean(),
  seconds: z.number(),
});
type PendingEdit = z.infer<typeof pendingSchema>;

const pendingErrorSchema = z.object({
  error: z.string(),
  picks: templateParamsSchema,
  chips: z.array(z.string()),
  text: z.string(),
});
type PendingError = z.infer<typeof pendingErrorSchema>;

function parseStored<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the result is only lost if the user left the page.
  }
}

type UserProfile = {
  gender: string | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: string[];
  experienceLevel: string | null;
};

type Option<T> = { value: T; label: string };

const GOAL_OPTIONS: Option<TemplateGoal>[] = [
  { value: "strength", label: "Strength" },
  { value: "muscle_gain", label: "Build muscle" },
  { value: "general_fitness", label: "General fitness" },
  { value: "weight_loss", label: "Lose fat" },
  { value: "endurance", label: "Endurance" },
];

const LEVEL_OPTIONS: Option<TemplateLevel>[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const DAY_OPTIONS: Option<TemplateParams["daysPerWeek"]>[] = TEMPLATE_DAYS.map((d) => ({ value: d, label: `${d}` }));

const MINUTE_OPTIONS: Option<SessionMinutes>[] = SESSION_MINUTES.map((m) => ({ value: m, label: `${m} min` }));

const SPLIT_LABELS: Record<TemplateSplit, string> = {
  auto: "Pick for me",
  full_body: "Full body",
  upper_lower: "Upper/Lower",
  ppl: "Push/Pull/Legs",
};

const EQUIPMENT_OPTIONS: Option<TemplateEquipment>[] = [
  { value: "full_gym", label: "Full gym" },
  { value: "barbell", label: "Barbell + rack" },
  { value: "dumbbells", label: "Dumbbells" },
  { value: "bodyweight", label: "Bodyweight" },
];

const WEEK_OPTIONS: Option<TemplateParams["weeks"]>[] = ([4, 6, 8, 10, 12, 16] as const).map((w) => ({ value: w, label: `${w} wk` }));

const PRIORITY_LABELS: Record<PriorityMuscle, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
};

const AVOID_LABELS: Record<AvoidArea, string> = {
  knees: "Knees",
  shoulders: "Shoulders",
  lower_back: "Lower back",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_OPTIONS: Option<string>[] = WEEKDAYS.map((label, i) => ({ value: String(i + 1), label }));

function chipClass(active: boolean): string {
  return `min-h-[44px] min-w-[44px] rounded-full px-4 text-sm font-medium active:opacity-70 disabled:opacity-40 ${
    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
  }`;
}

function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: (value: T) => boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled?.(o.value)}
          onClick={() => onChange(o.value)}
          className={chipClass(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiChips<T extends string>({
  label,
  options,
  values,
  onChange,
  max,
}: {
  label: string;
  options: Option<T>[];
  values: T[];
  onChange: (values: T[]) => void;
  max?: number;
}) {
  const full = max !== undefined && values.length >= max;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={chipClass(on)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground text-right">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

type PlanExercise = AiPlan["programs"][number]["exercises"][number];

/** "3 × 8–12 · 40 kg", "3 × 45 s", "1 × 5 min", "1 warm-up + 3 × 5 · 60 kg". */
function exerciseSummary(exercise: PlanExercise): string {
  const working = exercise.sets.filter((s) => s.type === "working");
  const warmups = exercise.sets.length - working.length;
  const first = working[0] ?? exercise.sets[0];
  let target = "";
  if (first.durSec !== null && first.reps === null) target = first.durSec >= 120 && first.durSec % 60 === 0 ? `${first.durSec / 60} min` : `${first.durSec} s`;
  else if (first.distM !== null && first.reps === null) target = `${first.distM} m`;
  else if (first.repMin !== null && first.repMax !== null && first.repMin !== first.repMax) target = `${first.repMin}–${first.repMax}`;
  else target = `${first.reps ?? first.repMin ?? ""}`;
  const load = first.kg ? ` · ${first.kg} kg` : "";
  return `${warmups > 0 ? `${warmups} warm-up + ` : ""}${working.length} × ${target}${load}`;
}

// Each line of the building screen shows this long; the plan itself is ready at once.
const BUILD_STEP_MS = 650;

/**
 * "Building your plan": the rules build the plan at once, so this screen gives
 * the coach a moment to work, one line at a time (docs/plans/ai-coach-hub.md).
 */
function BuildingScreen({ daysPerWeek, onDone }: { daysPerWeek: number; onDone: () => void }) {
  const steps = [
    "Reading your goal and experience",
    "Picking exercises for your equipment",
    "Setting sets, reps and starting weights",
    `Placing ${daysPerWeek} sessions in your week`,
  ];
  const [done, setDone] = useState(0);

  // The parent doesn't re-render while this shows, so onDone stays the same.
  useEffect(() => {
    const t = setTimeout(() => (done < steps.length ? setDone(done + 1) : onDone()), BUILD_STEP_MS);
    return () => clearTimeout(t);
  }, [done, steps.length, onDone]);

  return (
    <div className="flex flex-col items-center text-center gap-5 py-10" role="status" aria-live="polite">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Sparkles className="w-9 h-9 text-primary animate-pulse" />
      </div>
      <p className="text-lg font-semibold">Building your plan</p>
      <ul className="flex flex-col gap-2 text-left text-sm">
        {steps.map((step, i) => (
          <li key={step} className={`flex items-center gap-2 ${i < done ? "text-foreground" : "text-muted-foreground"}`}>
            {i < done ? (
              <Check className="w-4 h-4 text-emerald-500 flex-none" />
            ) : (
              <span className={`w-2 h-2 m-1 rounded-full flex-none ${i === done ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
            )}
            {step}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanPreview({ plan }: { plan: AiPlan }) {
  const days = plan.cycle?.slots.filter((s) => s.day !== null).sort((a, b) => a.day! - b.day!) ?? [];
  return (
    <div className="flex flex-col gap-3">
      {plan.cycle && (
        <div className="rounded-xl bg-muted p-4 flex flex-col gap-1">
          <p className="text-sm font-semibold">{plan.cycle.name}</p>
          <p className="text-xs text-muted-foreground">
            {days.map((s) => `${WEEKDAYS[s.day! - 1]} ${s.prog}`).join(" · ")}
          </p>
        </div>
      )}
      {plan.programs.map((program) => (
        <div key={program.name} className="rounded-xl bg-muted p-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold" data-testid="plan-program-name">{program.name}</p>
            <p className="text-xs text-muted-foreground">~{Math.round(estimateSessionMinutes(program.exercises))} min</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {program.exercises.map((exercise, i) => (
              <li key={`${exercise.name}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-foreground">{exercise.name}</span>
                <span className="text-xs text-muted-foreground text-right shrink-0">{exerciseSummary(exercise)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Props = {
  exercises: Exercise[];
  userProfile: UserProfile;
  prs: PrData[];
  existingProgramNames: string[];
  /** Set when opened from a check-in answered "doesn't fit". */
  revision: RevisionStart | null;
  /** Admins call a model on a cache miss; users get saved answers only. */
  isAdmin: boolean;
  /** Whether the user has opted in to sending requests to outside models. */
  aiConsented: boolean;
};

type View = "picks" | "building" | "preview" | "editing" | "waiting" | "importing";

export function AiSetupClient({ exercises, userProfile, prs, existingProgramNames, revision, isAdmin, aiConsented: initialAiConsented }: Props) {
  const [aiConsented, setAiConsented] = useState(initialAiConsented);
  const [showAiConsent, setShowAiConsent] = useState(false);
  const router = useRouter();

  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cycleCreated, setCycleCreated] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Picks
  const defaults = templateDefaults(userProfile.goals, userProfile.experienceLevel);
  const [goal, setGoal] = useState<TemplateGoal>(defaults.goal);
  const [level, setLevel] = useState<TemplateLevel>(defaults.level);
  const [daysPerWeek, setDaysPerWeek] = useState<TemplateParams["daysPerWeek"]>(3);
  const [sessionMinutes, setSessionMinutes] = useState<SessionMinutes>(60);
  const [split, setSplit] = useState<TemplateSplit>("auto");
  const [equipment, setEquipment] = useState<TemplateEquipment>("full_gym");
  const [weeks, setWeeks] = useState<TemplateParams["weeks"]>(8);
  const [priorities, setPriorities] = useState<PriorityMuscle[]>([]);
  const [avoid, setAvoid] = useState<AvoidArea[]>([]);
  // null: the split picks the weekdays.
  const [weekdays, setWeekdays] = useState<number[] | null>(null);

  // Plan and AI edit
  const [view, setView] = useState<View>("picks");
  const [builtPlan, setBuiltPlan] = useState<AiPlan | null>(null);
  const [editedPlan, setEditedPlan] = useState<AiPlan | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [chips, setChips] = useState<EditChipId[]>([]);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  // The request behind editedPlan, recorded with the import for the check-in.
  const [appliedRequest, setAppliedRequest] = useState<EditRequest | null>(null);
  const [revisionOf, setRevisionOf] = useState<number | null>(null);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const editPromise = useRef<ReturnType<typeof editPlanWithAi> | null>(null);
  const isMounted = useRef(true);

  const picks = (): TemplateParams => ({
    goal, level, daysPerWeek, equipment, weeks, sessionMinutes, split, priorities, avoid,
    ...(weekdays && { weekdays: [...weekdays].sort((a, b) => a - b) }),
  });

  const athlete = () => ({
    bodyWeightKg: userProfile.weightKg,
    sex: userProfile.gender,
    lifts: Object.fromEntries(
      prs.flatMap((pr) => {
        const kg = pr.estimated1rm ?? pr.maxWeight;
        return kg ? [[pr.exerciseName, kg]] : [];
      }),
    ),
  });

  function buildPlan(p: TemplateParams): AiPlan {
    return uniqueProgramNames(
      matchLibraryNames(buildTemplatePlan(p, athlete()), exercises.map((e) => e.name)),
      existingProgramNames,
    );
  }

  function restorePicks(p: TemplateParams) {
    setGoal(p.goal);
    setLevel(p.level);
    setDaysPerWeek(p.daysPerWeek);
    setEquipment(p.equipment);
    setWeeks(p.weeks);
    setSessionMinutes(p.sessionMinutes ?? 60);
    setSplit(p.split ?? "auto");
    setPriorities(p.priorities ?? []);
    setAvoid(p.avoid ?? []);
    setWeekdays(p.weekdays ?? null);
  }

  function restoreRequest(p: TemplateParams, requestChips: string[], text: string) {
    restorePicks(p);
    setBuiltPlan(buildPlan(p));
    setChips(requestChips.filter((c): c is EditChipId => EDIT_CHIPS.some((chip) => chip.id === c)));
    setEditText(text);
  }

  function showEdit(pending: PendingEdit) {
    restoreRequest(pending.picks, pending.chips, pending.text);
    setEditedPlan(pending.plan);
    setAppliedRequest({ chips: pending.chips.filter((c): c is EditChipId => EDIT_CHIPS.some((chip) => chip.id === c)), text: pending.text });
    setEditNote(pending.fromCache ? "Edited with AI · saved result, instant" : `Edited with AI in ${pending.seconds} s`);
    setView("preview");
  }

  /** A failed edit from an earlier visit: back to the plan, request intact, ready to retry. */
  function showEditError(raw: string) {
    const pending = parseStored(pendingErrorSchema, raw);
    if (!pending) {
      setReturnError(raw);
      setView("picks");
      return;
    }
    restoreRequest(pending.picks, pending.chips, pending.text);
    setEditedPlan(null);
    setEditNote(null);
    setEditError(`Your last AI edit failed: ${pending.error}`);
    setView("preview");
  }

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Pick up an edit that finished (or failed) while the user was away.
  useEffect(() => {
    const stored = readStorage(AI_PENDING_KEY);
    const storedError = readStorage(AI_PENDING_ERROR_KEY);
    if (stored) {
      writeStorage(AI_PENDING_KEY, null);
      setAiGenerating(false);
      const pending = parseStored(pendingSchema, stored);
      if (pending) showEdit(pending);
    } else if (storedError) {
      writeStorage(AI_PENDING_ERROR_KEY, null);
      setAiGenerating(false);
      showEditError(storedError);
    } else if (isAiGenerating()) {
      if (Date.now() - aiGeneratingStartedAt() < PENDING_TIMEOUT_MS) setView("waiting");
      else setAiGenerating(false);
    } else if (revision) {
      startRevision(revision);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Poll while an edit started on an earlier visit is still running.
  useEffect(() => {
    if (view !== "waiting") return;
    const interval = setInterval(() => {
      const stored = readStorage(AI_PENDING_KEY);
      const storedError = readStorage(AI_PENDING_ERROR_KEY);
      if (stored) {
        writeStorage(AI_PENDING_KEY, null);
        setAiGenerating(false);
        const pending = parseStored(pendingSchema, stored);
        if (pending) showEdit(pending);
        else setView("picks");
      } else if (storedError) {
        writeStorage(AI_PENDING_ERROR_KEY, null);
        setAiGenerating(false);
        showEditError(storedError);
      } else if (Date.now() - aiGeneratingStartedAt() > PENDING_TIMEOUT_MS) {
        // Stale flag, e.g. the server restarted mid-edit.
        setAiGenerating(false);
        setView("picks");
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showEdit/showEditError only set state
  }, [view]);

  /** Opened from a check-in: the fixed picks, then the AI request on top, if any. */
  function startRevision(rev: RevisionStart) {
    restorePicks(rev.picks);
    setRevisionOf(rev.revisionOf);
    if (rev.request) {
      setChips(rev.request.chips);
      setEditText(rev.request.text);
    }
    const repickLabel = rev.repick === "daysPerWeek" ? "the days per week" : rev.repick === "equipment" ? "your equipment" : null;
    setRevisionNote(
      [
        ...rev.changes,
        repickLabel ? `Pick ${repickLabel} below, then build` : null,
        rev.request && !repickLabel ? "Your request is filled in below. Tap Change my plan to apply it" : null,
        rev.request && repickLabel ? "Your request will be filled in under the plan" : null,
      ]
        .filter(Boolean)
        .join(". ") + ".",
    );
    if (repickLabel) {
      setView("picks");
      return;
    }
    setBuiltPlan(buildPlan(rev.picks));
    setView("preview");
  }

  function handleDaysChange(days: TemplateParams["daysPerWeek"]) {
    setDaysPerWeek(days);
    if (!splitSupports(split, days)) setSplit("auto");
    if (weekdays && weekdays.length > days) setWeekdays(weekdays.slice(0, days));
  }

  function handleBuild() {
    setBuiltPlan(buildPlan(picks()));
    setEditedPlan(null);
    setEditNote(null);
    setAppliedRequest(null);
    // A revision keeps its AI request so it can be applied to the rebuilt plan.
    if (revisionOf === null) {
      setChips([]);
      setEditText("");
    }
    setEditError(null);
    setImportError(null);
    setView("building");
  }

  async function handleEdit(consented = aiConsented) {
    if (view === "editing") return;
    // Only an admin's miss goes to an outside model, so only admins consent.
    if (isAdmin && !consented) {
      setShowAiConsent(true);
      return;
    }
    const sent = picks();
    const request = { chips, text: editText };
    setView("editing");
    setEditError(null);
    const startedAt = Date.now();
    const promise = editPlanWithAi({ picks: sent, request });
    editPromise.current = promise;
    setAiGenerating(true);

    // If the user leaves, park the result for their next visit.
    promise
      .then((result) => {
        if (isMounted.current) return;
        if (result.success) {
          const pending: PendingEdit = {
            picks: sent,
            chips: request.chips,
            text: request.text,
            plan: result.data.plan,
            fromCache: result.data.fromCache,
            seconds: Math.round((Date.now() - startedAt) / 1000),
          };
          writeStorage(AI_PENDING_KEY, JSON.stringify(pending));
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Your edited plan is ready", { body: "Tap to review and import it.", icon: "/icon-192x192.png" });
          }
        } else {
          const pending: PendingError = { error: result.error, picks: sent, chips: request.chips, text: request.text };
          writeStorage(AI_PENDING_ERROR_KEY, JSON.stringify(pending));
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("AI edit failed", { body: "Come back to Your plan to try again.", icon: "/icon-192x192.png" });
          }
        }
        setAiGenerating(false);
      })
      .catch(() => {
        if (!isMounted.current) setAiGenerating(false);
      });

    try {
      const result = await promise;
      editPromise.current = null;
      if (!isMounted.current) return;
      setAiGenerating(false);
      if (!result.success) {
        setEditError(result.error);
        setView("preview");
        return;
      }
      setEditedPlan(result.data.plan);
      setAppliedRequest(request);
      setEditNote(
        result.data.fromCache
          ? "Edited with AI · saved result, instant"
          : `Edited with AI in ${Math.round((Date.now() - startedAt) / 1000)} s`,
      );
      setView("preview");
    } catch {
      editPromise.current = null;
      if (!isMounted.current) return;
      setAiGenerating(false);
      setEditError("Connection lost. Please try again.");
      setView("preview");
    }
  }

  function handleLeaveAndNotify() {
    if (!editPromise.current) return;
    // Ask for notifications without waiting: an unanswered prompt mustn't keep the user here.
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
    router.push("/programs");
  }

  function handleUndoEdit() {
    setEditedPlan(null);
    setEditNote(null);
    setAppliedRequest(null);
  }

  async function handleConfirmImport() {
    const plan = editedPlan ?? builtPlan;
    if (!plan) return;
    setView("importing");
    setImportError(null);
    const result = await importPlanPayload(toImportPayload(plan) as Record<string, unknown>);
    if (!result.success) {
      setImportError(result.error);
      setView("preview");
      return;
    }
    router.refresh();
    if (result.cycleId !== null) {
      // For the one-week check-in. Losing this only loses the check-in, so the import stands either way.
      await recordAiSetupImport({
        cycleId: result.cycleId,
        picks: picks(),
        edit: editedPlan ? appliedRequest : null,
        revisionOf,
      }).catch(() => undefined);
    }
    setBuiltPlan(null);
    setEditedPlan(null);
    setAppliedRequest(null);
    setRevisionOf(null);
    setRevisionNote(null);
    setSuccessMsg(result.successMsg);
    setCycleCreated(result.cycleId !== null);
    setStatus("success");
    setView("picks");
  }

  if (status === "success") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-500" />
        </div>
        <div>
          <p className="text-lg font-semibold mb-1">All done!</p>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{successMsg}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(cycleCreated ? "/cycles" : "/programs")}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground active:opacity-80"
        >
          {cycleCreated ? "Go to Plan" : "Go to Programs"}
        </button>
        <button
          type="button"
          onClick={() => { setStatus("idle"); setSuccessMsg(null); setCycleCreated(false); }}
          className="text-sm text-muted-foreground active:opacity-70"
        >
          Build another
        </button>
      </div>
    );
  }

  const shownPlan = editedPlan ?? builtPlan;
  const swapNeedsText = chips.includes("swap_named") && !editText.trim();
  const canEdit = (chips.length > 0 || editText.trim().length > 0) && !swapNeedsText;
  const weekdaysMissing = weekdays !== null && weekdays.length !== daysPerWeek;
  const splitHint =
    split === "auto"
      ? undefined
      : `${SPLIT_LABELS[split]} works with ${SPLIT_DAYS[split].join(", ")} days`;

  // Rare picks sit under "More options", which opens by itself once one is set.
  const moreSet = weekdays !== null || sessionMinutes !== 60 || split !== "auto" || weeks !== 8 || priorities.length > 0 || avoid.length > 0;
  const moreOpen = showMore || moreSet;

  return (
    <div className="flex-1 flex flex-col gap-6 px-4 pb-8">
      {view === "building" ? (
        <BuildingScreen daysPerWeek={daysPerWeek} onDone={() => setView("preview")} />
      ) : view === "editing" && !isAdmin ? (
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <p className="text-base font-semibold">Your coach is on it</p>
        </div>
      ) : view === "editing" ? (
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold">Editing your plan…</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              A saved edit comes back instantly. A new one uses free AI models and can take <strong>1–3 minutes</strong>. You don&apos;t need to stay on this page.
            </p>
          </div>
          <button
            type="button"
            onClick={handleLeaveAndNotify}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-muted text-foreground py-3.5 text-sm font-semibold active:opacity-80"
          >
            Continue using the app
          </button>
          <p className="text-xs text-muted-foreground">We&apos;ll notify you when it&apos;s ready</p>
        </div>
      ) : view === "waiting" ? (
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold">Your edit is still running…</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              This page updates automatically when it&apos;s ready.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAiGenerating(false);
              setView("picks");
            }}
            className="text-sm text-muted-foreground active:opacity-70"
          >
            Cancel and start over
          </button>
        </div>
      ) : (view === "preview" || view === "importing") && shownPlan ? (
        <div className="flex flex-col gap-5">
          <button
            type="button"
            onClick={() => setView("picks")}
            disabled={view === "importing"}
            className="self-start min-h-[44px] flex items-center gap-1.5 text-sm text-primary active:opacity-70"
          >
            <ArrowLeft className="w-4 h-4" />
            Change picks
          </button>

{revisionNote && (
            <div className="rounded-xl bg-primary/10 px-4 py-3">
              <p className="text-xs font-semibold text-primary">Revising your plan from your check-in</p>
              <p className="text-xs text-primary/80 mt-0.5">{revisionNote}</p>
            </div>
          )}
          {editNote && (
            <div className="rounded-xl bg-primary/10 px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-primary">{editNote}</p>
              <button
                type="button"
                onClick={handleUndoEdit}
                className="min-h-[44px] flex items-center gap-1 text-xs font-semibold text-primary active:opacity-70"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo edit
              </button>
            </div>
          )}

          <PlanPreview plan={shownPlan} />

          {importError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
              <p className="text-xs font-semibold text-destructive">Import failed</p>
              <p className="text-xs text-destructive/80 mt-0.5">{importError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={view === "importing"}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {view === "importing" ? "Starting…" : "Start this plan"}
          </button>

          <div className="flex flex-col gap-3 pt-2 border-t border-border">
            <div className="flex flex-col gap-1 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ask your coach to change it</p>
              <p className="text-sm text-muted-foreground">
                Pick what to change, or describe it. Your coach changes this plan and keeps the rest.
              </p>
            </div>
            <MultiChips
              label="Changes"
              options={EDIT_CHIPS.map((c) => ({ value: c.id, label: c.label }))}
              values={chips}
              onChange={(v) => { setChips(v); setEditError(null); }}
            />
            <div className="flex flex-col gap-1">
              <textarea
                value={editText}
                onChange={(e) => { setEditText(e.target.value.slice(0, EDIT_TEXT_MAX)); setEditError(null); }}
                maxLength={EDIT_TEXT_MAX}
                rows={2}
                placeholder={chips.includes("swap_named") ? "Which exercises? e.g. no lunges or dips" : "Anything else? e.g. add calf work on leg days"}
                className="w-full rounded-xl bg-muted px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{editText.length}/{EDIT_TEXT_MAX}</p>
            </div>
            {editError === OWN_AI_NEEDED ? (
              <div className="rounded-xl bg-muted px-4 py-3 flex flex-col gap-1" role="status">
                <p className="text-sm">{OWN_AI_NEEDED}</p>
                <Link href="/more/ai-coach/connect" className="min-h-[44px] flex items-center text-sm font-medium text-primary active:opacity-70">
                  Connect an assistant
                </Link>
                <Link href="/more/ai-coach/own-chat" className="min-h-[44px] flex items-center text-sm font-medium text-primary active:opacity-70">
                  Use your own AI chat
                </Link>
              </div>
            ) : (
              editError && <p className="text-xs text-destructive">{editError}</p>
            )}
            {editError !== OWN_AI_NEEDED && <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Admin. A change with no saved answer goes to a free AI model and is saved for everyone."
                : "Free. Your coach gives saved answers. For a new change, use your own AI."}
            </p>}
            <button
              type="button"
              onClick={() => handleEdit()}
              disabled={!canEdit}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-muted text-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              Change my plan
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {revisionNote && (
            <div className="rounded-xl bg-primary/10 px-4 py-3">
              <p className="text-xs font-semibold text-primary">Revising your plan from your check-in</p>
              <p className="text-xs text-primary/80 mt-0.5">{revisionNote}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground -mt-2">Four questions. You can change all of it later.</p>
          {returnError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-destructive">Last AI edit failed</p>
              <p className="text-xs text-destructive/80">{returnError}</p>
              <button
                type="button"
                onClick={() => setReturnError(null)}
                className="text-xs text-destructive underline underline-offset-2 text-left mt-0.5 active:opacity-70"
              >
                Dismiss
              </button>
            </div>
          )}
          <Field label="Goal">
            <Chips label="Goal" options={GOAL_OPTIONS} value={goal} onChange={setGoal} />
          </Field>
          <Field label="Experience">
            <Chips label="Experience" options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
          </Field>
          <Field label="Days per week">
            <Chips label="Days per week" options={DAY_OPTIONS} value={daysPerWeek} onChange={handleDaysChange} />
          </Field>
          <Field label="Equipment">
            <Chips label="Equipment" options={EQUIPMENT_OPTIONS} value={equipment} onChange={setEquipment} />
          </Field>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            disabled={moreSet}
            aria-expanded={moreOpen}
            className="min-h-[44px] flex items-center justify-between gap-2 border-t border-border pt-3 text-left active:opacity-70 disabled:active:opacity-100"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">More options</span>
              <span className="text-xs text-muted-foreground">Training days, session length, split, cycle length, focus, go easy on</span>
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground flex-none transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (<>
          <Field
            label="Training days"
            hint={weekdays ? `${weekdays.length} of ${daysPerWeek} picked` : undefined}
          >
            <Chips
              label="Training days"
              options={[{ value: "auto", label: "Pick for me" }, { value: "choose", label: "Choose days" }]}
              value={weekdays ? "choose" : "auto"}
              onChange={(v) => setWeekdays(v === "choose" ? [] : null)}
            />
            {weekdays && (
              <MultiChips
                label="Weekdays"
                options={WEEKDAY_OPTIONS}
                values={weekdays.map(String)}
                onChange={(v) => setWeekdays(v.map(Number))}
                max={daysPerWeek}
              />
            )}
          </Field>
          <Field label="Session length">
            <Chips label="Session length" options={MINUTE_OPTIONS} value={sessionMinutes} onChange={setSessionMinutes} />
          </Field>
          <Field label="Split" hint={splitHint}>
            <Chips
              label="Split"
              options={TEMPLATE_SPLITS.map((s) => ({ value: s, label: SPLIT_LABELS[s] }))}
              value={split}
              onChange={setSplit}
              disabled={(s) => !splitSupports(s, daysPerWeek)}
            />
          </Field>
          <Field label="Cycle length">
            <Chips label="Cycle length" options={WEEK_OPTIONS} value={weeks} onChange={setWeeks} />
          </Field>
          <Field label="Focus muscles" hint={`Optional, up to ${MAX_PRIORITIES}`}>
            <MultiChips
              label="Focus muscles"
              options={PRIORITY_MUSCLES.map((m) => ({ value: m, label: PRIORITY_LABELS[m] }))}
              values={priorities}
              onChange={setPriorities}
              max={MAX_PRIORITIES}
            />
          </Field>
          <Field label="Go easy on" hint="Optional">
            <MultiChips
              label="Go easy on"
              options={AVOID_AREAS.map((a) => ({ value: a, label: AVOID_LABELS[a] }))}
              values={avoid}
              onChange={setAvoid}
            />
          </Field>
          </>)}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleBuild}
              disabled={weekdaysMissing}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              Build my plan
            </button>
            {weekdaysMissing && (
              <p className="text-xs text-destructive">Pick {daysPerWeek} training days, or let us pick them.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Starting weights come from your logged lifts. You see the plan before anything is created.
            </p>
          </div>
        </div>
      )}

      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
      <AiConsentSheet
        open={showAiConsent}
        onClose={() => setShowAiConsent(false)}
        onAccept={() => {
          setAiConsented(true);
          setShowAiConsent(false);
          void handleEdit(true);
        }}
      />
    </div>
  );
}
