"use client";

/**
 * The result of a run threshold test on the run summary
 * (docs/plans/run-logger.md, 4.10 and section 5 "Threshold test result"):
 * "New threshold pace 5:30 /km · LTHR 176 · Save". Close to the current
 * values Save is the default. 6 to 10 bpm or 3 to 8% off, the current and new
 * values show side by side to choose. Further off, "Run the test again in 4
 * weeks" and Save is the second button, as it is when a check failed ("Test
 * may be invalid"). Save sends only the run id: the server works the values
 * out again.
 */

import { saveRunThreshold } from "@/lib/actions/run-test";
import { runTestCheckText, type RunTestView } from "@/lib/utils/run-test";
import { minSec } from "@/lib/utils/thresholds";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

const pace = (speed: number | null) => (speed ? `${minSec(1000 / speed)} /km` : "–");

export function RunTestLine({ rideId, test }: { rideId: number; test: RunTestView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = test.result;
  if (!r) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await callAction(saveRunThreshold({ rideId }));
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    router.refresh();
  };
  const failed = runTestCheckText(r.checks);
  const quiet = !r.valid || r.band === "retest";

  return (
    <div className="rounded-xl bg-muted pl-4 pr-2 py-1.5 text-sm flex flex-col" data-testid="summary-threshold">
      {r.band === "choose" && !test.saved ? (
        <div className="grid grid-cols-2 gap-x-3 py-1.5 pr-2 tabular-nums" data-testid="threshold-compare">
          <p className="text-xs text-muted-foreground">Now</p>
          <p className="text-xs text-muted-foreground">New</p>
          <div className="text-muted-foreground">
            {r.speed !== null && <p>{pace(test.current.speed)}</p>}
            {r.lthr !== null && <p>LTHR {test.current.lthr !== null ? Math.round(test.current.lthr) : "–"}</p>}
          </div>
          <div className="font-semibold">
            {r.speed !== null && <p>{pace(r.speed)}</p>}
            {r.lthr !== null && <p>LTHR {r.lthr}</p>}
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 min-h-11">
        <span className={`tabular-nums ${quiet ? "" : "font-semibold"}`} data-testid="threshold-values">
          {r.band === "choose" && !test.saved ? (
            "Choose the new values"
          ) : (
            <>
              New {r.speed !== null && <>threshold pace <span className="whitespace-nowrap">{pace(r.speed)}</span></>}
              {r.lthr !== null && (
                <>
                  {r.speed !== null && " "}
                  {/* The dot stays with LTHR, so a wrap never leaves it at the end of a line. */}
                  <span className="whitespace-nowrap">{`${r.speed !== null ? "· " : ""}LTHR ${r.lthr}`}</span>
                </>
              )}
            </>
          )}
        </span>
        {test.saved ? (
          <span className="min-h-11 px-3 inline-flex items-center text-muted-foreground">Saved</span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className={`min-h-11 px-3 whitespace-nowrap active:opacity-70 disabled:opacity-50 ${quiet ? "font-medium text-muted-foreground" : "font-semibold text-primary"}`}
          >
            Save
          </button>
        )}
      </div>
      {!test.saved && r.band === "retest" && (
        <p className="pb-1.5 text-muted-foreground" data-testid="threshold-retest">
          Far from your numbers now · Run the test again in 4 weeks
        </p>
      )}
      {!test.saved && !r.valid && (
        <p className="pb-1.5 text-muted-foreground" data-testid="threshold-invalid">
          <span className="font-semibold text-foreground">Test may be invalid</span> · {failed.join(" · ")}
        </p>
      )}
      {error && (
        <p role="alert" className="pb-1.5 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
