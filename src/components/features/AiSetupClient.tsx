"use client";

import { McpConnectCard } from "@/components/features/McpConnectCard";
import { generateWorkoutPlan } from "@/lib/actions/ai-generate";
import { importProgram } from "@/lib/actions/programs";
import { importCycle } from "@/lib/actions/training-cycles";
import { buildManualClipboardPrompt, type PrData, type PromptOptions } from "@/lib/utils/ai-prompt";
import type { Exercise } from "@/types/workout";
import { Check, ChevronDown, Clipboard, Copy, Dumbbell, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AI_PENDING_KEY = "ai_pending_result";
const AI_PENDING_ERROR_KEY = "ai_pending_error";
const AI_GENERATING_KEY = "ai_generating";

type UserProfile = {
  gender: string | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: string[];
  experienceLevel: string | null;
};

type PreviewProgram = { name: string; exercises: unknown[] };
type PreviewCycle = { name: string; weeks: number; sched: string };

function PreviewCard({
  parsed,
  onConfirm,
  onDiscard,
  importing,
}: {
  parsed: Record<string, unknown>;
  onConfirm: () => void;
  onDiscard: () => void;
  importing: boolean;
}) {
  const programs = (
    Array.isArray(parsed.programs) ? parsed.programs :
    parsed.program ? [parsed.program] : []
  ) as PreviewProgram[];

  const cycle = parsed.cycle as PreviewCycle | undefined;
  const totalExercises = programs.reduce((sum, p) => sum + (Array.isArray(p.exercises) ? p.exercises.length : 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Review before importing
      </p>
      <div className="rounded-xl bg-muted p-4 flex flex-col gap-3">
        {/* Summary line */}
        <div className="flex flex-wrap gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            {programs.length} program{programs.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Dumbbell className="w-3.5 h-3.5 text-primary" />
            {totalExercises} exercise{totalExercises !== 1 ? "s" : ""}
          </span>
          {cycle && (
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <RefreshCw className="w-3.5 h-3.5 text-primary" />
              {cycle.weeks}-week cycle
            </span>
          )}
        </div>

        {/* Program list */}
        <div className="flex flex-col gap-1">
          {programs.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{p.name}</span>
              <span className="text-muted-foreground text-xs">
                {Array.isArray(p.exercises) ? p.exercises.length : 0} exercises
              </span>
            </div>
          ))}
          {cycle && (
            <div className="flex items-center justify-between text-sm mt-1 pt-1 border-t border-border">
              <span className="text-foreground">{cycle.name}</span>
              <span className="text-muted-foreground text-xs">{cycle.weeks} weeks</span>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={importing}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
      >
        <Check className="w-4 h-4" />
        {importing ? "Importing…" : "Import"}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={importing}
        className="text-sm text-muted-foreground active:opacity-70 text-center py-1"
      >
        Discard and start over
      </button>
    </div>
  );
}

type Props = {
  exercises: Exercise[];
  userProfile: UserProfile;
  generationsToday: number;
  dailyLimit: number;
  prs: PrData[];
  existingProgramNames: string[];
  mcpEndpoint: string;
};

export function AiSetupClient({ exercises, userProfile, generationsToday, dailyLimit, prs, existingProgramNames, mcpEndpoint }: Props) {
  const router = useRouter();

  // Manual flow state
  const [copied, setCopied] = useState(false);
  const [pasteJson, setPasteJson] = useState("");
  const [status, setStatus] = useState<"idle" | "importing" | "error" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cycleCreated, setCycleCreated] = useState(false);

  // Automatic flow state
  const [autoDescription, setAutoDescription] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState<number | undefined>(undefined);
  const [equipment, setEquipment] = useState<PromptOptions["equipment"]>("full_gym");
  const [cycleDurationWeeks, setCycleDurationWeeks] = useState<PromptOptions["cycleDurationWeeks"]>(undefined);
  const [autoStatus, setAutoStatus] = useState<"idle" | "asking" | "waiting" | "preview" | "importing" | "error">("idle");
  const [autoError, setAutoError] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(dailyLimit - generationsToday);
  const [pendingJson, setPendingJson] = useState<Record<string, unknown> | null>(null);
  const generationPromise = useRef<ReturnType<typeof generateWorkoutPlan> | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(AI_PENDING_KEY);
    const storedError = localStorage.getItem(AI_PENDING_ERROR_KEY);
    if (stored) {
      localStorage.removeItem(AI_PENDING_KEY);
      localStorage.removeItem(AI_GENERATING_KEY);
      try {
        const parsed = JSON.parse(stored) as Record<string, unknown>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage on mount
        setPendingJson(parsed);
        setAutoStatus("preview");
      } catch {}
    } else if (storedError) {
      localStorage.removeItem(AI_PENDING_ERROR_KEY);
      localStorage.removeItem(AI_GENERATING_KEY);
      setReturnError(storedError);
    } else if (localStorage.getItem(AI_GENERATING_KEY)) {
      const startedAt = parseInt(localStorage.getItem(AI_GENERATING_KEY) ?? "0");
      if (Date.now() - startedAt < 10 * 60 * 1000) {
        setAutoStatus("waiting");
      } else {
        localStorage.removeItem(AI_GENERATING_KEY);
      }
    }
  }, []);

  // Poll while waiting for a background generation to complete
  useEffect(() => {
    if (autoStatus !== "waiting") return;
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const interval = setInterval(() => {
      const stored = localStorage.getItem(AI_PENDING_KEY);
      const storedError = localStorage.getItem(AI_PENDING_ERROR_KEY);
      if (stored) {
        localStorage.removeItem(AI_PENDING_KEY);
        localStorage.removeItem(AI_GENERATING_KEY);
        try {
          const parsed = JSON.parse(stored) as Record<string, unknown>;
          setPendingJson(parsed);
          setAutoStatus("preview");
        } catch {
          setAutoError("Could not read the generated plan. Please try again.");
          setAutoStatus("error");
        }
      } else if (storedError) {
        localStorage.removeItem(AI_PENDING_ERROR_KEY);
        localStorage.removeItem(AI_GENERATING_KEY);
        setReturnError(storedError);
        setAutoStatus("idle");
      } else {
        // Auto-clear stale key (e.g. if the server was restarted mid-generation)
        const startedAt = parseInt(localStorage.getItem(AI_GENERATING_KEY) ?? "0");
        if (Date.now() - startedAt > TIMEOUT_MS) {
          localStorage.removeItem(AI_GENERATING_KEY);
          setAutoStatus("idle");
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [autoStatus]);

  const AUTO_BUSY = autoStatus === "asking" || autoStatus === "importing";
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleCopyPrompt() {
    navigator.clipboard.writeText(buildManualClipboardPrompt(userProfile, exercises, prs, existingProgramNames, { daysPerWeek, equipment, cycleDurationWeeks }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  type ImportResult =
    | { success: true; successMsg: string; cycleCreated: boolean }
    | { success: false; error: string };

  async function handleImportParsed(raw: Record<string, unknown>): Promise<ImportResult> {
    const hasProgramData = raw.program !== undefined || raw.programs !== undefined;
    const hasCycle = raw.cycle !== undefined;

    if (!hasProgramData && !hasCycle) {
      return { success: false, error: 'The JSON doesn\'t contain any programs or a cycle. Make sure you pasted the full AI response and that it includes a "programs" or "cycle" key.' };
    }

    let programCount = 0;
    let cycleName: string | null = null;
    const warnings: string[] = [];

    if (hasProgramData) {
      const result = await importProgram(raw);
      if (!result.success) {
        return { success: false, error: result.error ?? "Failed to import programs." };
      }
      programCount = result.data.count;
      if (result.data.skippedExercises.length > 0) {
        warnings.push(`Some exercises couldn't be resolved and were skipped: "${result.data.skippedExercises.join('", "')}".`);
      }
    }

    if (hasCycle) {
      const result = await importCycle(raw.cycle);
      if (!result.success) {
        warnings.push(`Cycle couldn't be created: ${result.error ?? "unknown error"}`);
      } else {
        cycleName = result.data.cycleName;
        if (result.data.unresolvedPrograms.length > 0) {
          warnings.push(
            `Some cycle slots couldn't be linked: "${result.data.unresolvedPrograms.join('", "')}". You can assign them manually in the cycle editor.`,
          );
        }
      }
    }

    const parts: string[] = [];
    if (programCount > 0) parts.push(`${programCount} program${programCount > 1 ? "s" : ""}`);
    if (cycleName) parts.push(`cycle "${cycleName}"`);

    const base =
      parts.length > 0
        ? `Created ${parts.join(" and ")}.`
        : "Nothing was created — the response may have been empty.";
    const suffix = cycleName
      ? " Go to your cycles and start it when you're ready."
      : programCount > 0
        ? " You can find your programs in the Programs tab."
        : "";

    const successMsg = warnings.length > 0 ? `${base}${suffix}\n\n⚠️ ${warnings.join(" ")}` : `${base}${suffix}`;
    router.refresh();
    return { success: true, successMsg, cycleCreated: !!cycleName };
  }

  async function handleImport() {
    if (!pasteJson.trim()) return;
    setStatus("importing");
    setError(null);

    let text = pasteJson.trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace > 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setStatus("error");
      setError("Couldn't read the JSON — make sure you copied the full response from the AI, with no extra text before or after.");
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setStatus("error");
      setError("Unexpected response format — the AI should return a single JSON object, not an array or plain value.");
      return;
    }

    const result = await handleImportParsed(parsed as Record<string, unknown>);
    if (!result.success) {
      setStatus("error");
      setError(result.error);
    } else {
      setSuccessMsg(result.successMsg);
      setCycleCreated(result.cycleCreated);
      setStatus("success");
      setPasteJson("");
    }
  }

  async function handleGenerate() {
    if (!autoDescription.trim() || AUTO_BUSY) return;
    setAutoStatus("asking");
    setAutoError(null);

    const promise = generateWorkoutPlan(autoDescription, { daysPerWeek, equipment, cycleDurationWeeks });
    generationPromise.current = promise;

    // Set key immediately so bottom nav knows generation is active
    localStorage.setItem(AI_GENERATING_KEY, Date.now().toString());

    // Attach background completion handler before awaiting
    // isMounted.current will be false if the user navigated away before this resolves
    promise.then((result) => {
      if (isMounted.current) return; // user stayed on page — the await below handles it
      if (result.success) {
        const parsed = result.data.json;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          localStorage.setItem(AI_PENDING_KEY, JSON.stringify(parsed));
        }
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Your workout plan is ready!", {
            body: "Tap to review and import your AI-generated programs.",
            icon: "/icon-192x192.png",
          });
        }
      } else {
        localStorage.setItem(AI_PENDING_ERROR_KEY, result.error ?? "Generation failed.");
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("AI generation failed", {
            body: "Come back to AI Setup to try again.",
            icon: "/icon-192x192.png",
          });
        }
      }
      localStorage.removeItem(AI_GENERATING_KEY);
    }).catch(() => {
      // Network error while away (e.g. server restarted) — clear the key so user isn't stuck
      if (!isMounted.current) {
        localStorage.removeItem(AI_GENERATING_KEY);
      }
    });

    try {
      const result = await promise;
      generationPromise.current = null;

      // If the component unmounted while waiting, the .then() above already handled everything
      if (!isMounted.current) return;

      localStorage.removeItem(AI_GENERATING_KEY);

      if (!result.success) {
        setAutoStatus("error");
        setAutoError(result.error);
        return;
      }

      setRemaining(result.data.dailyLimit - result.data.generationsToday);
      const parsed = result.data.json;

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setAutoStatus("error");
        setAutoError("The AI returned an unexpected format. Please try again.");
        return;
      }

      setPendingJson(parsed as Record<string, unknown>);
      setAutoStatus("preview");
    } catch {
      generationPromise.current = null;
      if (!isMounted.current) return;
      localStorage.removeItem(AI_GENERATING_KEY);
      setAutoStatus("error");
      setAutoError("Connection lost. Please try again.");
    }
  }

  async function handleLeaveAndNotify() {
    if (!generationPromise.current) return;
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    router.push("/programs");
  }

  async function handleConfirmImport() {
    if (!pendingJson) return;
    const json = pendingJson;
    setAutoStatus("importing");
    setAutoError(null);
    const result = await handleImportParsed(json);
    if (!result.success) {
      // Keep the PreviewCard visible so the user can retry or discard
      setAutoError(result.error);
      setAutoStatus("preview");
    } else {
      setPendingJson(null);
      setSuccessMsg(result.successMsg);
      setCycleCreated(result.cycleCreated);
      setStatus("success");
      setAutoStatus("idle");
    }
  }

  function handleDiscard() {
    setPendingJson(null);
    setAutoStatus("idle");
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
          {cycleCreated ? "Go to Cycles" : "Go to Programs"}
        </button>
        <button
          type="button"
          onClick={() => { setStatus("idle"); setSuccessMsg(null); setCycleCreated(false); }}
          className="text-sm text-muted-foreground active:opacity-70"
        >
          Import more
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-4 pb-8">
      {/* Auto-generate section */}
      {autoStatus === "asking" ? (
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold">Building your plan…</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              This is free and uses AI models that can take <strong>1–3 minutes</strong>. You don&apos;t need to stay on this page.
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
      ) : autoStatus === "waiting" ? (
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-semibold">Your plan is still being generated…</p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              The AI is still working. This page will update automatically when it&apos;s ready.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(AI_GENERATING_KEY);
              setAutoStatus("idle");
            }}
            className="text-sm text-muted-foreground active:opacity-70"
          >
            Cancel and start over
          </button>
        </div>
      ) : (autoStatus === "preview" || autoStatus === "importing") && pendingJson ? (
        <div className="flex flex-col gap-3">
          {autoError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
              <p className="text-xs font-semibold text-destructive">Import failed</p>
              <p className="text-xs text-destructive/80 mt-0.5">{autoError}</p>
            </div>
          )}
          <PreviewCard
            parsed={pendingJson}
            onConfirm={handleConfirmImport}
            onDiscard={handleDiscard}
            importing={autoStatus === "importing"}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Auto-generate with AI
          </p>
          <p className="text-sm text-muted-foreground">
            Describe what you&apos;re looking for and the app will build your programs automatically.
          </p>
          <textarea
            value={autoDescription}
            onChange={(e) => {
              setAutoDescription(e.target.value);
              setAutoError(null);
            }}
            placeholder="e.g. 3-day push/pull/legs, intermediate lifter, progressive overload on the big lifts…"
            rows={4}
            className="w-full rounded-xl bg-muted px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary resize-none"
          />
          <div className="flex gap-2">
            <select
              value={daysPerWeek ?? ""}
              onChange={(e) => setDaysPerWeek(e.target.value ? Number(e.target.value) : undefined)}
              className="flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Days/week (any)</option>
              {[2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{d} days/week</option>
              ))}
            </select>
            <select
              value={equipment}
              onChange={(e) => setEquipment(e.target.value as PromptOptions["equipment"])}
              className="flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="full_gym">Full gym</option>
              <option value="barbell">Barbell + rack</option>
              <option value="dumbbells">Dumbbells only</option>
              <option value="bodyweight">Bodyweight only</option>
            </select>
          </div>
          <div className="flex gap-2">
            <select
              value={cycleDurationWeeks ?? ""}
              onChange={(e) => setCycleDurationWeeks(e.target.value ? Number(e.target.value) as PromptOptions["cycleDurationWeeks"] : undefined)}
              className="w-full rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Cycle length (AI decides)</option>
              {([4, 6, 8, 10, 12, 16] as const).map((w) => (
                <option key={w} value={w}>{w} weeks</option>
              ))}
            </select>
          </div>
          {returnError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-destructive">Last generation failed</p>
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
          {autoError && <p className="text-xs text-destructive">{autoError}</p>}
          <p className="text-xs text-muted-foreground">
            {dailyLimit === Infinity ? "Unlimited generations (admin)" : `${remaining} of ${dailyLimit} generations remaining today`}
          </p>
          <p className="text-xs text-muted-foreground">
            This is 100% free. AI models can take <strong>1–3 minutes</strong> — you don&apos;t need to wait on this page.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!autoDescription.trim() || AUTO_BUSY || remaining <= 0}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Generate
          </button>
        </div>
      )}

      {/* Power-user options umbrella — hidden by default */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center justify-center gap-2 text-xs text-muted-foreground active:opacity-70 py-1"
      >
        <span>Power-user options</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
        />
      </button>

      {showAdvanced && (
        <>
          {/* Connect an AI assistant over MCP */}
          <McpConnectCard endpoint={mcpEndpoint} />

          {/* Manual: copy a prompt for your own AI, paste the response back */}
          {/* Step 1 */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 1 — Copy the prompt
            </p>
            <p className="text-sm text-muted-foreground">
              Tap the button below to copy a ready-made prompt to your clipboard.
            </p>
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy Prompt"}
            </button>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 2 — Open ChatGPT, Gemini, or Claude
            </p>
            <p className="text-sm text-muted-foreground">
              Paste the prompt and send it. The AI will ask what you&apos;re looking for — describe your
              goals, how many days a week you can train, and whether you want a weekly schedule or just
              programs. You can ask for a full training block (e.g. &quot;12-week PPL, 4 days a
              week&quot;) or just standalone programs. When it&apos;s done, copy the entire response.
            </p>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step 3 — Paste the response here
            </p>
            {pasteJson ? (
              <>
                <div className="rounded-xl bg-muted px-3 py-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground truncate">{pasteJson.slice(0, 60)}…</p>
                  <button
                    type="button"
                    onClick={() => { setPasteJson(""); setStatus("idle"); setError(null); }}
                    className="text-xs text-muted-foreground underline underline-offset-2 shrink-0 active:opacity-70"
                  >
                    Clear
                  </button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={status === "importing"}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {status === "importing" ? "Importing…" : "Import"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) { setPasteJson(text); setStatus("idle"); setError(null); }
                    } catch {
                      // Clipboard permission denied — fall through to textarea
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80"
                >
                  <Clipboard className="w-4 h-4" />
                  Paste from Clipboard
                </button>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            )}
          </div>
        </>
      )}
      <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
    </div>
  );
}
