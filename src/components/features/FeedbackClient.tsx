"use client";

import { submitFeedback } from "@/lib/actions/feedback";
import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type FeedbackType = "bug" | "feature" | "other";

const TYPE_OPTIONS: { value: FeedbackType; label: string; description: string }[] = [
  { value: "bug", label: "Bug", description: "Something isn't working" },
  { value: "feature", label: "Feature", description: "Suggest an improvement" },
  { value: "other", label: "Other", description: "General feedback" },
];

export function FeedbackClient() {
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    const result = await submitFeedback({ type, message: message.trim() });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Feedback</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        {submitted ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-semibold">Thanks for your feedback!</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              We read every submission and use it to improve the app.
            </p>
            <Link
              href="/more"
              className="mt-4 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-95 transition-all"
            >
              Back to More
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 pt-2">
            {/* Type selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Type
              </p>
              <div className="bg-card rounded-2xl overflow-hidden divide-y divide-border">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setType(opt.value)}
                    className="w-full flex items-center justify-between px-4 py-3.5 active:bg-muted/50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-sm text-muted-foreground">{opt.description}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      type === opt.value ? "border-primary bg-primary" : "border-muted-foreground/30"
                    }`}>
                      {type === opt.value && <div className="w-2 h-2 rounded-full bg-primary-foreground" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Message
              </p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue or your idea…"
                rows={6}
                className="w-full bg-card rounded-2xl px-4 py-3.5 text-base outline-none resize-none placeholder:text-muted-foreground/50"
              />
              <p className="text-xs text-muted-foreground text-right px-1">{message.length}/2000</p>
            </div>

            {error && (
              <p className="text-sm text-destructive px-1">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !message.trim()}
              className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Sending…
                </span>
              ) : (
                "Send Feedback"
              )}
            </button>
            <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
          </form>
        )}
      </div>
    </div>
  );
}
