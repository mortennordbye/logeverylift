"use client";

import { GarminDataExplorer } from "@/components/features/GarminDataExplorer";
import { GarminMetricsTab } from "@/components/features/GarminMetricsTab";
import { useState } from "react";

export type InsightsTab = "overview" | "data";

const TAB_LABEL: Record<InsightsTab, string> = { overview: "Overview", data: "Data" };

export function InsightsClient({ initialTab }: { initialTab: InsightsTab }) {
  const [tab, setTab] = useState<InsightsTab>(initialTab);
  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className="px-4 pt-8 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Insights</h1>
        <div className="flex bg-muted rounded-xl p-1 gap-1" role="tablist">
          {(Object.keys(TAB_LABEL) as InsightsTab[]).map((t) => (
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
