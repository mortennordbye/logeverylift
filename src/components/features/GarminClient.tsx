"use client";

import { GarminDataExplorer } from "@/components/features/GarminDataExplorer";
import { GarminMetricsTab } from "@/components/features/GarminMetricsTab";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type GarminTab = "overview" | "data";

const TAB_LABEL: Record<GarminTab, string> = { overview: "Overview", data: "Data" };

export function GarminClient({ initialTab }: { initialTab: GarminTab }) {
  const [tab, setTab] = useState<GarminTab>(initialTab);
  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link href="/more" className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Garmin</h1>
        <div className="flex bg-muted rounded-xl p-1 gap-1" role="tablist">
          {(Object.keys(TAB_LABEL) as GarminTab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors min-h-[36px] ${
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-nav-safe-lg">
        {tab === "overview" ? <GarminMetricsTab /> : <GarminDataExplorer />}
      </main>
    </div>
  );
}
