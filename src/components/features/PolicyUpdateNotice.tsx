"use client";

import { markPolicySeen } from "@/lib/actions/legal";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useState } from "react";

/** Tells the user, once, that the privacy policy changed since they last saw it. */
export function PolicyUpdateNotice() {
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleDismiss() {
    setSaving(true);
    const result = await callAction(markPolicySeen({ version: LEGAL_VERSION }));
    setSaving(false);
    if (result.success) setHidden(true);
  }

  if (hidden) return null;

  return (
    <div className="rounded-2xl bg-muted p-4 shrink-0 flex items-center gap-3">
      <p className="flex-1 text-sm">
        We updated the{" "}
        <Link href="/privacy" className="text-primary">
          privacy policy
        </Link>
        .
      </p>
      <button
        onClick={handleDismiss}
        disabled={saving}
        className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium active:opacity-70 disabled:opacity-50"
      >
        Got it
      </button>
    </div>
  );
}
