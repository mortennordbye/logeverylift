"use client";

import { useEffect, useState } from "react";

const LEVELS = [
  { value: 1, label: "Drained", emoji: "😴" },
  { value: 2, label: "Low",     emoji: "😕" },
  { value: 3, label: "OK",      emoji: "😐" },
  { value: 4, label: "Good",    emoji: "😊" },
  { value: 5, label: "Great",   emoji: "🔥" },
] as const;

type Props = {
  onConfirm: (level: number) => void;
};

/**
 * Pre-workout readiness check-in sheet.
 *
 * Shown once at the start of each workout session when readiness is unknown.
 * Auto-dismisses after 4 seconds with a neutral (3) score if ignored.
 * Disappears immediately when the user taps a level.
 */
export function ReadinessSheet({ onConfirm }: Props) {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(4);

  // Slide in after a short delay so the page renders first
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss after 4 seconds with neutral score
  useEffect(() => {
    if (!visible) return;
    if (countdown <= 0) {
      onConfirm(3);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [visible, countdown, onConfirm]);

  const handleSelect = (level: number) => {
    setVisible(false);
    onConfirm(level);
  };

  if (!visible && countdown === 4) return null; // not yet shown

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end transition-all duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className={`w-full bg-card rounded-t-3xl px-4 pb-10 pt-5 transition-transform duration-300 ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-base font-semibold">How are you feeling today?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This adjusts your targets. Auto-skipping in {countdown}s…
            </p>
          </div>
          <button
            onClick={() => handleSelect(3)}
            className="text-muted-foreground text-sm font-medium active:opacity-60"
          >
            Skip
          </button>
        </div>

        {/* Level buttons */}
        <div className="flex gap-2">
          {LEVELS.map((lvl) => (
            <button
              key={lvl.value}
              onClick={() => handleSelect(lvl.value)}
              className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-muted active:scale-95 transition-all min-h-[72px]"
            >
              <span className="text-2xl leading-none">{lvl.emoji}</span>
              <span className="text-[10px] font-semibold text-muted-foreground leading-none">
                {lvl.label}
              </span>
            </button>
          ))}
        </div>

        {/* Progress bar showing auto-dismiss countdown */}
        <div className="mt-4 h-0.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/40 rounded-full transition-all duration-1000"
            style={{ width: `${(countdown / 4) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
