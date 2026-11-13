"use client";

/**
 * "Resume" or "Results" for a guided run saved on this phone
 * (docs/plans/endurance-app.md, 3.8). localStorage is read after mount, so
 * the server render and the first client render agree.
 */

import { PLAYER_STORAGE_KEY } from "@/lib/utils/workout-player";
import Link from "next/link";
import { useEffect, useState } from "react";

export function savedRunFor(plannedSessionId: number): "running" | "finished" | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { plannedSessionId?: number; status?: string };
    if (s.plannedSessionId !== plannedSessionId) return null;
    if (s.status === "running" || s.status === "paused") return "running";
    if (s.status === "finished") return "finished";
    return null;
  } catch {
    return null;
  }
}

export function SavedRunLink({ plannedSessionId, compact = false }: { plannedSessionId: number; compact?: boolean }) {
  const [saved, setSaved] = useState<"running" | "finished" | null>(null);
  useEffect(() => {
    // Read after mount: localStorage is not readable on the server.
    setSaved(savedRunFor(plannedSessionId));
  }, [plannedSessionId]);
  if (!saved) return null;
  const href = saved === "running" ? `/planned/${plannedSessionId}/play` : `/planned/${plannedSessionId}/results?from=player`;
  const label = saved === "running" ? "Resume" : "Save results";
  return (
    <Link
      href={href}
      data-testid="saved-run"
      className={
        compact
          ? "min-h-11 inline-flex items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground active:opacity-80"
          : "min-h-12 rounded-2xl bg-amber-500/20 px-4 py-3 text-center text-base font-semibold active:opacity-80"
      }
    >
      {label}
    </Link>
  );
}
