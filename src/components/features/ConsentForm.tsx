"use client";

import { ConsentChecks, type ConsentState } from "@/components/features/ConsentChecks";
import { acceptTerms } from "@/lib/actions/legal";
import { LEGAL_VERSION } from "@/lib/constants/legal";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useState } from "react";

export function ConsentForm() {
  const [consent, setConsent] = useState<ConsentState>({ terms: false, healthData: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setSaving(true);
    setError(null);
    const result = await callAction(acceptTerms({ version: LEGAL_VERSION, ...consent }));
    if (!result.success) {
      setSaving(false);
      setError(result.error);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="flex flex-col gap-5">
      <ConsentChecks value={consent} onChange={(v) => { setConsent(v); setError(null); }} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        onClick={handleContinue}
        disabled={saving || !consent.terms || !consent.healthData}
        className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
      >
        {saving ? "Saving…" : "Continue"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t agree?{" "}
        <Link href="/more/account" className="text-primary">
          Download your data or delete your account
        </Link>
      </p>
    </div>
  );
}
