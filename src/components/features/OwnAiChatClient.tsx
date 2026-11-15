"use client";

import { importPlanPayload } from "@/lib/import-plan";
import { buildManualClipboardPrompt, type PrData } from "@/lib/utils/ai-prompt";
import type { Exercise } from "@/types/workout";
import { Check, Clipboard, Copy, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type UserProfile = Parameters<typeof buildManualClipboardPrompt>[0];

/**
 * "Use your own AI chat" under the AI coach hub (docs/plans/ai-coach-hub.md):
 * copy a prompt, paste the answer of ChatGPT, Gemini or Claude, import it.
 * Nothing is sent from our server; the prompt goes only where the user pastes it.
 */
export function OwnAiChatClient({
  exercises,
  userProfile,
  prs,
  existingProgramNames,
}: {
  exercises: Exercise[];
  userProfile: UserProfile;
  prs: PrData[];
  existingProgramNames: string[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pasteJson, setPasteJson] = useState("");
  const [status, setStatus] = useState<"idle" | "importing" | "error" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cycleCreated, setCycleCreated] = useState(false);

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(buildManualClipboardPrompt(userProfile, exercises, prs, existingProgramNames));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Allow the clipboard for this site and try again.");
    }
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
      setError("Couldn't read the answer. Copy the whole answer from the AI and paste it again.");
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setStatus("error");
      setError("This is not a plan. Ask the AI to answer with the plan only, then paste it again.");
      return;
    }

    const result = await importPlanPayload(parsed as Record<string, unknown>);
    if (!result.success) {
      setStatus("error");
      setError(result.error);
      return;
    }
    router.refresh();
    setSuccessMsg(result.successMsg);
    setCycleCreated(result.cycleId !== null);
    setStatus("success");
    setPasteJson("");
  }

  if (status === "success") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-500" />
        </div>
        <div>
          <p className="text-lg font-semibold mb-1">Plan saved</p>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{successMsg}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push(cycleCreated ? "/cycles" : "/programs")}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground active:opacity-80"
        >
          {cycleCreated ? "Go to Plan" : "Go to Programs"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-4 pb-8">
      <p className="text-sm text-muted-foreground">
        For when you already use an AI chat. Nothing is linked to your account.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1 · Copy the prompt</p>
        <p className="text-sm text-muted-foreground">
          It holds your age, height, body weight and best lifts, and goes only to the AI you paste it into.
        </p>
        <button
          type="button"
          onClick={handleCopyPrompt}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-semibold active:opacity-80"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2 · Open ChatGPT, Gemini or Claude</p>
        <p className="text-sm text-muted-foreground">
          Paste the prompt and send it. Tell the AI your goal, how many days a week you train and if you want a
          weekly schedule or only programs. When it is done, copy the whole answer.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3 · Paste the answer here</p>
        {pasteJson ? (
          <>
            <div className="rounded-xl bg-muted px-3 py-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground truncate">{pasteJson.slice(0, 60)}…</p>
              <button
                type="button"
                onClick={() => { setPasteJson(""); setStatus("idle"); setError(null); }}
                className="min-h-[44px] text-xs text-muted-foreground underline underline-offset-2 shrink-0 active:opacity-70"
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
                  // Clipboard permission denied: the textarea below still works.
                }
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-muted text-foreground py-3.5 text-sm font-semibold active:opacity-80"
            >
              <Clipboard className="w-4 h-4" />
              Paste from clipboard
            </button>
            <textarea
              aria-label="AI answer"
              onChange={(e) => { if (e.target.value) { setPasteJson(e.target.value); setStatus("idle"); setError(null); } }}
              rows={3}
              placeholder="Or paste the answer here"
              className="w-full rounded-xl bg-muted px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
