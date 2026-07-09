"use client";

import { useTheme } from "@/components/ui/theme-provider";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { setMissedWorkoutsEnabled } from "@/lib/actions/training-cycles";
import { exportAllSessions } from "@/lib/actions/workout-sessions";
import { requestNotificationPermission } from "@/lib/notifications";
import { sanitizeDecimalInput } from "@/lib/utils/format";
import { Bell, BookOpen, CheckIcon, ChevronLeft, ChevronRight, Download, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const accentColors = [
  { value: "blue", label: "Blue", color: "#5B8FFF" },
  { value: "white", label: "White", color: "#EBEBEB" },
  { value: "green", label: "Green", color: "#5BC27A" },
  { value: "purple", label: "Purple", color: "#A45DFF" },
  { value: "orange", label: "Orange", color: "#FF8C42" },
] as const;

const UI_SCALE_PRESETS = [0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.25] as const;
const KG_INCREMENT_PRESETS = [0, 1, 2.5, 5, 10] as const;
const REP_INCREMENT_PRESETS = [0, 1, 2, 3] as const;

const isKgPreset = (v: number): v is typeof KG_INCREMENT_PRESETS[number] =>
  (KG_INCREMENT_PRESETS as readonly number[]).includes(v);
const isRepPreset = (v: number): v is typeof REP_INCREMENT_PRESETS[number] =>
  (REP_INCREMENT_PRESETS as readonly number[]).includes(v);

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
      {children}
    </p>
  );
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`px-4 py-3.5 ${!last ? "border-b border-border/50" : ""}`}>
      {children}
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium mb-0.5">{children}</p>;
}

function RowDescription({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground mb-3">{children}</p>;
}

function NotificationsRow() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    // Sync from window.Notification (unavailable at SSR render).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function handleEnable() {
    const granted = await requestNotificationPermission();
    setPermission(granted ? "granted" : Notification.permission);
  }

  if (permission === "unsupported") return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <Bell className="w-5 h-5 text-muted-foreground flex-none" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Rest timer alerts</p>
        <p className="text-xs text-muted-foreground">
          {permission === "granted" && "You'll be notified when rest is done"}
          {permission === "default" && "Tap Enable to get notified when rest ends"}
          {permission === "denied" && (
            <>
              Blocked — go to{" "}
              <span className="font-medium text-foreground">
                iOS Settings → LogEveryLift → Notifications
              </span>{" "}
              to turn on
            </>
          )}
        </p>
      </div>
      {permission === "granted" && (
        <span className="text-xs font-semibold text-green-500 flex-none">On</span>
      )}
      {permission === "default" && (
        <button
          onClick={handleEnable}
          className="text-xs font-semibold text-primary flex-none active:opacity-70"
        >
          Enable
        </button>
      )}
      {permission === "denied" && (
        <span className="text-xs font-semibold text-destructive flex-none">Blocked</span>
      )}
    </div>
  );
}

function MissedWorkoutsRow({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    const result = await setMissedWorkoutsEnabled({ enabled: next });
    setSaving(false);
    if (!result.success) setEnabled(!next); // revert on failure
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <RowLabel>Missed workout reminders</RowLabel>
        <p className="text-xs text-muted-foreground">
          Show make-up prompts and overdue badges when you skip a scheduled workout
        </p>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle missed workout reminders"
        onClick={toggle}
        disabled={saving}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-primary" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function ExportHistoryButton() {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    const result = await exportAllSessions();
    setExporting(false);
    if (!result.success) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout-history-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="w-full flex items-center gap-3 px-4 py-3.5 active:opacity-60 transition-opacity text-left disabled:opacity-50"
    >
      <Download className="w-5 h-5 text-muted-foreground flex-none" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Export workout history</p>
        <p className="text-xs text-muted-foreground">
          Download every session + sets as JSON
        </p>
      </div>
      {exporting && (
        <span className="text-xs font-semibold text-muted-foreground flex-none">
          …
        </span>
      )}
    </button>
  );
}

export function SettingsClient({
  missedWorkoutsEnabled,
}: {
  missedWorkoutsEnabled: boolean;
}) {
  const {
    accentColor, setAccentColor,
    customAccentHex, setCustomAccentHex,
    weeklyGoal, setWeeklyGoal,
    defaultIncrementKg, setDefaultIncrementKg,
    defaultIncrementReps, setDefaultIncrementReps,
    uiScale, setUiScale,
  } = useTheme();
  const colorInputRef = useRef<HTMLInputElement>(null);

  // String buffer for the custom increment so partial decimals ("7." / "1,")
  // survive while typing; the parsed number is committed on blur. Resyncs during
  // render when defaultIncrementKg changes externally (preset tap or hydration).
  const [incrementStr, setIncrementStr] = useState(() =>
    isKgPreset(defaultIncrementKg) ? "" : String(defaultIncrementKg),
  );
  const [prevIncrementKg, setPrevIncrementKg] = useState(defaultIncrementKg);
  if (prevIncrementKg !== defaultIncrementKg) {
    setPrevIncrementKg(defaultIncrementKg);
    setIncrementStr(isKgPreset(defaultIncrementKg) ? "" : String(defaultIncrementKg));
  }

  const presetBtn = (active: boolean) =>
    `h-11 min-w-[44px] px-3 rounded-xl text-sm font-semibold active:scale-95 transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
    }`;

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <h1 className="text-3xl font-bold tracking-tight px-4 pt-2 pb-0 shrink-0">Settings</h1>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-6 flex flex-col gap-6">

        {/* ── Appearance ─────────────────────────────── */}
        <div>
          <SectionLabel>Appearance</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">

            <Row>
              <div className="flex items-center justify-between">
                <div>
                  <RowLabel>Dark Mode</RowLabel>
                  <p className="text-xs text-muted-foreground">Toggle between light and dark theme</p>
                </div>
                <ThemeToggle />
              </div>
            </Row>

            <Row>
              <RowLabel>Scale</RowLabel>
              <RowDescription>Adjust the size of the entire UI</RowDescription>
              <div className="flex flex-wrap gap-2">
                {UI_SCALE_PRESETS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setUiScale(s)}
                    className={`h-11 px-4 rounded-xl text-sm font-semibold active:scale-95 transition-colors ${uiScale === s ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}
                  >
                    {Math.round(s * 100)}%
                  </button>
                ))}
              </div>
            </Row>

            <Row last>
              <RowLabel>Accent Color</RowLabel>
              <div className="flex gap-3 flex-wrap mt-2">
                {accentColors.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setAccentColor(color.value)}
                    className="relative w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{ backgroundColor: color.color }}
                  >
                    {accentColor === color.value && (
                      <CheckIcon className="h-5 w-5 text-black" strokeWidth={3} />
                    )}
                  </button>
                ))}
                <label
                  className="relative w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-transform overflow-hidden cursor-pointer"
                  style={{
                    background: accentColor === "custom"
                      ? customAccentHex
                      : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                  }}
                >
                  {accentColor === "custom" && (
                    <CheckIcon className="h-5 w-5 text-black" strokeWidth={3} />
                  )}
                  <input
                    ref={colorInputRef}
                    type="color"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    value={customAccentHex}
                    onChange={(e) => setCustomAccentHex(e.target.value)}
                  />
                </label>
              </div>
            </Row>

          </div>
        </div>

        {/* ── Workout ────────────────────────────────── */}
        <div>
          <SectionLabel>Workout</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">

            <Row>
              <RowLabel>Weekly Goal</RowLabel>
              <RowDescription>Workouts you aim to complete each week</RowDescription>
              <div className="grid grid-cols-7 gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <button key={n} onClick={() => setWeeklyGoal(n)} className={`h-11 w-full rounded-xl text-sm font-semibold active:scale-95 transition-colors flex items-center justify-center ${weeklyGoal === n ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </Row>

            <Row>
              <RowLabel>Weight Increment</RowLabel>
              <RowDescription>How much to increase weight when you hit your target reps</RowDescription>
              <div className="flex gap-2">
                {KG_INCREMENT_PRESETS.map((n) => (
                  <button key={n} onClick={() => setDefaultIncrementKg(n)} className={presetBtn(defaultIncrementKg === n)}>
                    {n === 0 ? "—" : `+${n}`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-xs text-muted-foreground">Custom</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 7.5"
                  value={incrementStr}
                  onChange={(e) => setIncrementStr(sanitizeDecimalInput(e.target.value))}
                  onBlur={() => {
                    const v = parseFloat(incrementStr);
                    if (!isNaN(v) && v >= 0) setDefaultIncrementKg(v);
                  }}
                  className={`h-9 w-24 rounded-xl text-sm font-semibold text-center border-0 outline-none appearance-none ${
                    !isKgPreset(defaultIncrementKg)
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground"
                  }`}
                />
                {!isKgPreset(defaultIncrementKg) && (
                  <span className="text-xs text-muted-foreground">kg</span>
                )}
              </div>
            </Row>

            <Row>
              <RowLabel>Rep Increment</RowLabel>
              <RowDescription>Extra reps to add each progression cycle</RowDescription>
              <div className="flex gap-2">
                {REP_INCREMENT_PRESETS.map((n) => (
                  <button key={n} onClick={() => setDefaultIncrementReps(n)} className={presetBtn(defaultIncrementReps === n)}>
                    {n === 0 ? "—" : `+${n}`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-xs text-muted-foreground">Custom</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="e.g. 5"
                  value={isRepPreset(defaultIncrementReps) ? "" : defaultIncrementReps}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0) setDefaultIncrementReps(v);
                  }}
                  className={`h-9 w-24 rounded-xl text-sm font-semibold text-center border-0 outline-none appearance-none ${
                    !isRepPreset(defaultIncrementReps)
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground"
                  }`}
                />
                {!isRepPreset(defaultIncrementReps) && (
                  <span className="text-xs text-muted-foreground">reps</span>
                )}
              </div>
            </Row>

            <Row last>
              <MissedWorkoutsRow initialEnabled={missedWorkoutsEnabled} />
            </Row>

          </div>
        </div>

        {/* ── Notifications ──────────────────────────── */}
        <div>
          <SectionLabel>Notifications</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <Row last>
              <NotificationsRow />
            </Row>
          </div>
        </div>

        {/* ── Data ───────────────────────────────────── */}
        <div>
          <SectionLabel>Data</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden">
            <ExportHistoryButton />
          </div>
        </div>

        {/* ── Help ───────────────────────────────────── */}
        <div>
          <SectionLabel>Help</SectionLabel>
          <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("show-onboarding"))}
              className="w-full flex items-center gap-3 px-4 py-3.5 active:opacity-60 transition-opacity text-left"
            >
              <BookOpen className="w-5 h-5 text-muted-foreground flex-none" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">View intro</p>
                <p className="text-xs text-muted-foreground">Replay the getting started guide</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
            </button>
            <Link
              href="/more/install"
              className="flex items-center gap-3 px-4 py-3.5 active:opacity-60 transition-opacity"
            >
              <Smartphone className="w-5 h-5 text-muted-foreground flex-none" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Add to iPhone</p>
                <p className="text-xs text-muted-foreground">Install as a Home Screen app</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-none" />
            </Link>
          </div>
        </div>

        <div aria-hidden="true" className="pb-nav-safe-lg" style={{ height: "var(--kb-height, 0px)" }} />
      </div>
    </div>
  );
}
