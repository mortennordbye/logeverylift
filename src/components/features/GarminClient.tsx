import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/**
 * The Garmin page shell: back link, title and tab pills. Tabs live in the URL
 * (?tab=), so each tab is rendered on the server and the back gesture works.
 */

export const GARMIN_TABS = ["today", "load", "sleep", "overview", "data"] as const;
export type GarminTab = (typeof GARMIN_TABS)[number];

const TAB_LABEL: Record<GarminTab, string> = { today: "Today", load: "Load", sleep: "Sleep", overview: "Overview", data: "Data" };

export function GarminClient({ tab, children }: { tab: GarminTab; children: React.ReactNode }) {
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
        <nav className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar" aria-label="Garmin views">
          {GARMIN_TABS.map((t) => (
            <Link
              key={t}
              href={`/more/garmin?tab=${t}`}
              replace
              scroll={false}
              aria-current={tab === t ? "page" : undefined}
              className={`h-11 px-5 rounded-full text-sm font-medium flex items-center flex-none active:opacity-70 ${
                tab === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
      </div>
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-nav-safe-lg">{children}</main>
    </div>
  );
}
