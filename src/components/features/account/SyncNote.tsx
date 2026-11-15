"use client";

import { callAction } from "@/lib/utils/stale-bundle";
import type { ActionResult } from "@/types/workout";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Under a field Garmin can sync: where its value came from, and Garmin's
 * value with Use when it differs (docs/plans/account-profile.md, 6.4 and 6.5).
 */
export function SyncNote({ note, says, onUse }: { note: string | null; says: string | null; onUse: () => Promise<ActionResult<unknown>> }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function use() {
    setSaving(true);
    setError(null);
    const r = await callAction(onUse());
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  if (!note && !says) return null;
  return (
    <>
      {note && <p>{note}</p>}
      {says && (
        <p className="flex items-center gap-1 text-primary">
          <span>Garmin says {says} ·</span>
          <button onClick={use} disabled={saving} className="min-h-[44px] font-semibold underline active:opacity-60 disabled:opacity-50">
            Use
          </button>
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </>
  );
}
