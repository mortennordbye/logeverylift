"use client";

import { setDisplayUnits, setTimeZone } from "@/lib/actions/user-settings";
import { callAction } from "@/lib/utils/stale-bundle";
import type { DistanceUnit, SwimUnit } from "@/lib/utils/units";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

type Props = {
  timeZone: string | null;
  distanceUnit: DistanceUnit;
  swimUnit: SwimUnit;
  enduranceEnabled: boolean;
};

const noop = () => () => {};

/** The phone's zone, read after hydration so the server render stays stable. */
function useDeviceZone(): string | null {
  return useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    () => null,
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`h-11 px-4 rounded-xl text-sm font-semibold active:scale-95 transition-colors disabled:opacity-50 ${
            value === o.value ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Display units and the time zone (decision D14), plus whether the endurance
 * add-on is on. Values are stored on the user; the app reads them through
 * UserSettingsProvider, refreshed by router.refresh after a change.
 */
export function UnitsAndTimeSettings(props: Props) {
  const router = useRouter();
  const [distanceUnit, setDistance] = useState(props.distanceUnit);
  const [swimUnit, setSwim] = useState(props.swimUnit);
  const [zone, setZone] = useState(props.timeZone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceZone = useDeviceZone();

  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return zone && !all.includes(zone) ? [zone, ...all] : all;
  }, [zone]);

  async function save<T>(next: T, prev: T, apply: (v: T) => void, call: () => Promise<{ success: boolean; error?: string }>) {
    apply(next); // optimistic
    setSaving(true);
    setError(null);
    const result = await callAction(call());
    setSaving(false);
    if (!result.success) {
      apply(prev);
      setError(result.error ?? "Couldn't save");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium mb-1">Run and ride distance</p>
        <p className="text-xs text-muted-foreground mb-2">Distance, pace and speed</p>
        <Choice
          label="Distance unit"
          value={distanceUnit}
          disabled={saving}
          options={[
            { value: "km", label: "km" },
            { value: "mi", label: "miles" },
          ]}
          onChange={(v) => save(v, distanceUnit, setDistance, () => setDisplayUnits({ distanceUnit: v }))}
        />
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Swim distance</p>
        <p className="text-xs text-muted-foreground mb-2">Distance and pace per 100</p>
        <Choice
          label="Swim unit"
          value={swimUnit}
          disabled={saving}
          options={[
            { value: "m", label: "meters" },
            { value: "yd", label: "yards" },
          ]}
          onChange={(v) => save(v, swimUnit, setSwim, () => setDisplayUnits({ swimUnit: v }))}
        />
      </div>

      <div>
        <label htmlFor="time-zone" className="text-sm font-medium mb-1 block">
          Time zone
        </label>
        <p className="text-xs text-muted-foreground mb-2">Decides which day is today, for your plan and your workouts</p>
        <select
          id="time-zone"
          value={zone ?? ""}
          disabled={saving}
          onChange={(e) => {
            const v = e.target.value;
            if (v) void save<string | null>(v, zone, setZone, () => setTimeZone({ timeZone: v }));
          }}
          className="w-full rounded-xl bg-background px-4 min-h-[44px] text-base outline-none focus:ring-2 ring-primary"
        >
          {!zone && <option value="">Not set</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {deviceZone && zone && deviceZone !== zone && (
          <div className="flex items-center gap-3 mt-2">
            <p className="flex-1 text-xs text-muted-foreground">Your phone is in {deviceZone.replace(/_/g, " ")}.</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => save<string | null>(deviceZone, zone, setZone, () => setTimeZone({ timeZone: deviceZone }))}
              className="shrink-0 px-3 min-h-[44px] rounded-xl bg-background text-sm font-semibold active:opacity-70 disabled:opacity-50"
            >
              Use it
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <p className="text-sm font-medium">Endurance features: {props.enduranceEnabled ? "on" : "off"}</p>
        <p className="text-xs text-muted-foreground">Triathlon plans and race planning. An admin turns this on.</p>
      </div>
    </div>
  );
}
