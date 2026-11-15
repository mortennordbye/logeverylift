"use client";

import { saveBikeHrZones } from "@/lib/actions/bike-numbers";
import { bandsFromFloors } from "@/lib/garmin/analytics/thresholds";
import { zoneFloorsError } from "@/lib/utils/bike-numbers";
import { callAction } from "@/lib/utils/stale-bundle";
import type { ZoneSet } from "@/lib/utils/workout-steps";
import { useState } from "react";

/**
 * Custom bike HR zones (docs/plans/bike-sessions.md, section 3 rule 5): the
 * start of each zone and max HR, as Garmin sets them. Saved zones override the
 * Garmin CYCLING zones; "Back to Garmin zones" clears them.
 */
export function BikeZonesEditor({ zones, onSaved }: { zones: ZoneSet | null; onSaved: () => void }) {
  const [texts, setTexts] = useState<string[]>(() => [
    ...[0, 1, 2, 3, 4].map((i) => (zones?.hr[i]?.low != null ? String(zones.hr[i].low) : "")),
    zones?.hr[4]?.high != null ? String(zones.hr[4].high) : "",
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nums = texts.map((t) => (t.trim() === "" ? NaN : Number(t)));
  const floors = nums.slice(0, 5);
  const maxHr = nums[5];
  const complete = nums.every((n) => Number.isFinite(n));
  const invalid = complete ? zoneFloorsError(floors, maxHr) : null;

  async function save(body: { floors: number[]; maxHr: number } | { clear: true }) {
    setSaving(true);
    setError(null);
    const r = await callAction(saveBikeHrZones(body));
    setSaving(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-3" data-testid="bike-zones-editor">
      <p className="text-sm text-muted-foreground">Enter where each zone starts and your max HR, in bpm. Each zone ends 1 bpm under the next.</p>
      <div className="grid grid-cols-2 gap-2">
        {["Zone 1 starts", "Zone 2 starts", "Zone 3 starts", "Zone 4 starts", "Zone 5 starts", "Max HR"].map((label, i) => (
          <label key={label} className="block">
            <span className="text-xs text-muted-foreground">{label}</span>
            <input
              inputMode="numeric"
              value={texts[i]}
              onChange={(e) => setTexts(texts.map((t, j) => (j === i ? e.target.value : t)))}
              aria-label={label}
              className="mt-1 w-full rounded-xl bg-muted px-4 py-3 text-base outline-none focus:ring-2 ring-primary"
            />
          </label>
        ))}
      </div>
      {complete && !invalid && (
        <p className="text-sm" data-testid="bike-zones-preview">
          {bandsFromFloors(floors, maxHr)
            .map((b, i) => `Z${i + 1} ${b.low}-${b.high}`)
            .join(" · ")}
        </p>
      )}
      {invalid && <p className="text-sm text-destructive">{invalid}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        onClick={() => save({ floors, maxHr })}
        disabled={saving || !complete || !!invalid}
        className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
      >
        Save bike HR zones
      </button>
      {zones?.source === "custom" && (
        <button
          onClick={() => save({ clear: true })}
          disabled={saving}
          className="w-full min-h-[44px] text-sm font-medium text-primary active:opacity-60 disabled:opacity-50"
        >
          Back to Garmin zones
        </button>
      )}
    </div>
  );
}
