"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { setAiConsent } from "@/lib/actions/legal";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useState } from "react";

/** The one-time opt-in before AI Setup sends a request to an outside model. */
export function AiConsentSheet({ open, onClose, onAccept }: { open: boolean; onClose: () => void; onAccept: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setSaving(true);
    setError(null);
    const result = await callAction(setAiConsent({ consent: true }));
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onAccept();
  }

  return (
    <BottomSheet open={open} onClose={onClose} blur>
      <div className="bg-background rounded-t-2xl flex flex-col" style={{ maxHeight: "85dvh" }}>
        <div className="flex items-center justify-between px-4 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold">Turn on AI editing?</h2>
          <button onClick={onClose} className="text-primary text-sm font-medium min-h-[44px] px-1">
            Cancel
          </button>
        </div>
        <div className="overflow-y-auto flex flex-col gap-3 px-4 pb-10 text-sm">
          <p>
            AI editing sends your request through <strong>OpenRouter</strong> to a free AI model run by another
            company, possibly outside Europe, including the USA.
          </p>
          <p className="text-muted-foreground">
            Sent: your age band, gender, goals and experience level, what you picked (days, equipment, session
            length, muscles to prioritise, joints to spare), the exercise names available to you, the draft plan and
            the change you typed. Not sent: your name, email, body weight, weights lifted or training history.
          </p>
          <p className="text-muted-foreground">
            Free models may store requests and use them for training. Don&apos;t type anything in the request you
            wouldn&apos;t want kept. You can turn this off in Account. See the{" "}
            <Link href="/privacy" target="_blank" className="text-primary underline">
              privacy policy
            </Link>
            .
          </p>
          {error && <p className="text-destructive">{error}</p>}
          <button
            onClick={handleAccept}
            disabled={saving}
            className="mt-2 w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
          >
            {saving ? "Saving…" : "I agree, turn on AI editing"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
