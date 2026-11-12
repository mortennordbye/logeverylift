"use client";

import { refreshGarmin } from "@/lib/actions/garmin";
import { callAction } from "@/lib/utils/stale-bundle";
import { Activity, ChartLine, ChevronLeft, Database, LayoutDashboard, Moon, RefreshCw, Sun, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GARMIN_TABS, type GarminTab, type GarminView } from "./tabs";
import { useSwipe } from "./use-swipe";


const TABS: Record<GarminTab, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  day: { label: "Day", icon: Sun },
  training: { label: "Training", icon: TrendingUp },
  recovery: { label: "Recovery", icon: Moon },
  activities: { label: "Activities", icon: Activity },
  trends: { label: "Trends", icon: ChartLine },
};

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

function RefreshButton({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // "x min ago" is relative to the device clock, so it is set after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    const r = await callAction(refreshGarmin());
    setBusy(false);
    if (!r.success) setError(r.error);
    else if (r.data.syncError) setError(`Some data failed (${r.data.syncError})`);
    router.refresh();
  }

  return (
    <button onClick={refresh} disabled={busy} className="flex h-11 items-center gap-2 rounded-full pl-3 pr-1 text-[11px] text-muted-foreground active:opacity-60" aria-label="Refresh from Garmin">
      <span className={error ? "text-destructive" : ""}>{error ?? (busy ? "Syncing…" : now !== null ? `Synced ${ago(lastSyncedAt, now)}` : "")}</span>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-primary">
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      </span>
    </button>
  );
}

/**
 * The Garmin page: back link, refresh and the raw data icon, title, tab pills
 * with icons, and the tab content. Swiping the content left or right moves to
 * the next or previous tab; swipes that start on a chart or a scroll row are
 * left to them. The data explorer is a debug view, so it sits behind the
 * header icon, not in the tab row.
 */
export function GarminShell({ tab, lastSyncedAt, children }: { tab: GarminView; lastSyncedAt: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const pills = useRef<HTMLElement>(null);
  const i = tab === "data" ? -1 : GARMIN_TABS.indexOf(tab);
  const go = (t: GarminTab) => router.replace(`/more/garmin?tab=${t}`, { scroll: false });
  const next = i >= 0 ? GARMIN_TABS[i + 1] : undefined;
  const prev = i >= 0 ? GARMIN_TABS[i - 1] : undefined;
  const swipe = useSwipe({ onLeft: next ? () => go(next) : undefined, onRight: prev ? () => go(prev) : undefined });

  // Keep the active pill in view, so tabs off to the side are visible as you move.
  useEffect(() => {
    pills.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [tab]);

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
        <div className="flex items-center gap-1">
          <RefreshButton lastSyncedAt={lastSyncedAt} />
          <Link
            href="/more/garmin?tab=data"
            replace
            scroll={false}
            aria-label="Stored data"
            aria-current={tab === "data" ? "page" : undefined}
            className={`flex h-11 w-11 items-center justify-center rounded-full active:opacity-60 ${tab === "data" ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${tab === "data" ? "bg-foreground text-background" : "bg-muted"}`}>
              <Database className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </div>
      <div className="px-4 pt-1 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Garmin</h1>
        <nav ref={pills} className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar" aria-label="Garmin views">
          {GARMIN_TABS.map((t) => {
            const { label, icon: Icon } = TABS[t];
            return (
              <Link
                key={t}
                href={`/more/garmin?tab=${t}`}
                replace
                scroll={false}
                aria-current={tab === t ? "page" : undefined}
                className={`h-11 pl-3.5 pr-4 rounded-full text-sm font-medium flex items-center gap-1.5 flex-none active:opacity-70 ${
                  tab === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <main {...swipe.handlers} style={swipe.style} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-nav-safe-lg">
        {children}
      </main>
    </div>
  );
}
