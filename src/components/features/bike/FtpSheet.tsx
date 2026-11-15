"use client";

import { ThresholdEditor } from "@/components/features/ThresholdEditor";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { setFtpAutomatic } from "@/lib/actions/bike-numbers";
import type { BikeNumbers } from "@/lib/bike-numbers";
import { callAction } from "@/lib/utils/stale-bundle";
import { DEFAULT_UNITS } from "@/lib/utils/units";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Choose how the FTP is set (docs/plans/bike-sessions.md, section 3 rule 3):
 * automatic from the rides, or by hand with a "How to test" note. Used in the
 * session page's FTP sheet and on Thresholds.
 */
export function FtpChoice({
  numbers,
  planFtpTestHref,
  onSaved,
}: {
  numbers: BikeNumbers;
  /** Where "Plan an FTP test" goes; the link shows only when set. */
  planFtpTestHref?: string;
  onSaved: () => void;
}) {
  const automatic = numbers.ftp?.source === "garmin";
  const [mode, setMode] = useState<"auto" | "hand">(numbers.ftp && !automatic ? "hand" : "auto");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimate = numbers.estimate ?? null;

  async function backToAutomatic() {
    setSaving(true);
    setError(null);
    const r = await callAction(setFtpAutomatic());
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-3" data-testid="ftp-choice">
      <div className="flex gap-2" role="radiogroup" aria-label="How your FTP is set">
        {(
          [
            ["auto", "Automatic (from your rides)"],
            ["hand", "Set by hand"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 min-h-[44px] rounded-xl px-2 text-sm font-medium active:opacity-70 ${mode === m ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "auto" ? (
        <div className="space-y-3">
          {estimate ? (
            <p className="text-sm" data-testid="ftp-estimate">
              {estimate.value} W, {estimate.basis}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No ride with power in the last 90 days. Set your FTP by hand for now.</p>
          )}
          {automatic ? (
            <p className="text-xs text-muted-foreground">
              Your FTP follows your rides. After each sync it changes when your rides show a change of 3 % or more.
            </p>
          ) : (
            estimate && (
              <button
                onClick={backToAutomatic}
                disabled={saving}
                className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
              >
                Back to automatic
              </button>
            )
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <ThresholdEditor kind="ftp" units={DEFAULT_UNITS} onSaved={onSaved} />
          <section className="rounded-xl bg-muted px-4 py-3 space-y-2" aria-label="How to test">
            <h3 className="text-sm font-medium">How to test</h3>
            <p className="text-sm text-muted-foreground">
              Warm up for 20 min. Ride 5 min hard, then 10 min easy. Then ride 20 min steady, as hard as you can hold. Your FTP is 95 % of the
              average power of the 20 min.
            </p>
            <p className="text-xs text-muted-foreground">A value you set or test stays until you go back to automatic or save a newer test.</p>
            {planFtpTestHref && (
              <Link href={planFtpTestHref} className="flex items-center min-h-[44px] text-sm font-medium text-primary active:opacity-60">
                Plan an FTP test
              </Link>
            )}
          </section>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** The "Change" control on the FTP line and its sheet. */
export function FtpSheet({ numbers, planFtpTestHref }: { numbers: BikeNumbers; planFtpTestHref?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="shrink-0 min-h-[44px] px-3 text-sm font-medium text-primary active:opacity-60" aria-label="Change FTP">
        Change
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} blur>
        {open && (
          <div className="bg-background rounded-t-2xl px-4 pt-5 pb-8 space-y-4 max-h-[85dvh] overflow-y-auto">
            <h2 className="text-lg font-semibold">FTP</h2>
            <FtpChoice
              numbers={numbers}
              planFtpTestHref={planFtpTestHref}
              onSaved={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
