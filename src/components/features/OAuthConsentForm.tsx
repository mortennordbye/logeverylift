"use client";

import { authClient } from "@/lib/auth-client";
import { consentScope, type McpAccess } from "@/lib/mcp/scopes";
import { useState } from "react";

const CHOICES: { access: McpAccess; label: string; detail: string }[] = [
  { access: "read", label: "Read only", detail: "It can read your data and give advice. It cannot change anything." },
  { access: "write", label: "Read and change", detail: "It can also change your profile, body weight, programs and cycles." },
];

/**
 * The access choice and Allow or Deny on the OAuth consent page. The
 * oauth-provider client plugin sends this page's signed query along, and the
 * client follows the redirect the server answers with (back to the assistant,
 * with a code or an error). Allow sends the requested scopes narrowed to the
 * choice (src/lib/mcp/scopes.ts).
 */
export function OAuthConsentForm({
  requestedScopes,
  canRead,
  canWrite,
}: {
  requestedScopes: string[];
  canRead: boolean;
  canWrite: boolean;
}) {
  const choices = CHOICES.filter((c) => (c.access === "read" ? canRead : canWrite));
  const [access, setAccess] = useState<McpAccess | null>(choices[0]?.access ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setSaving(true);
    setError(null);
    const result = await authClient.oauth2.consent(
      accept && access ? { accept, scope: consentScope(requestedScopes, access) } : { accept },
    );
    if (result.error) {
      setSaving(false);
      setError("Couldn't save your answer. Start connecting again from your AI assistant.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This assistant did not ask for access to your LogEveryLift data, so it will not be able to use it.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Access" className="flex flex-col gap-2">
          {choices.map((c) => (
            <button
              key={c.access}
              role="radio"
              aria-checked={access === c.access}
              onClick={() => setAccess(c.access)}
              className={`w-full min-h-[44px] rounded-xl border px-4 py-3 text-left active:opacity-80 ${
                access === c.access ? "border-primary bg-primary/10" : "border-border bg-muted"
              }`}
            >
              <span className="block text-sm font-semibold">{c.label}</span>
              <span className="block text-xs text-muted-foreground">{c.detail}</span>
            </button>
          ))}
        </div>
      )}
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
