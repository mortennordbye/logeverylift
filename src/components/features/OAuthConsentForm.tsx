"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";

/**
 * Allow or Deny on the OAuth consent page. The oauth-provider client plugin
 * sends this page's signed query along, and the client follows the redirect
 * the server answers with (back to the assistant, with a code or an error).
 */
export function OAuthConsentForm() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setSaving(true);
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    if (result.error) {
      setSaving(false);
      setError("Couldn't save your answer. Start connecting again from your AI assistant.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        onClick={() => decide(true)}
        disabled={saving}
        className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
      >
        Allow
      </button>
      <button
        onClick={() => decide(false)}
        disabled={saving}
        className="w-full rounded-xl bg-muted py-4 text-sm font-semibold disabled:opacity-50 active:opacity-80"
      >
        Deny
      </button>
    </div>
  );
}
