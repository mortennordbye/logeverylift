/**
 * More → Garmin: the user's Garmin data (docs/plans/garmin-deep-data.md,
 * docs/plans/garmin-insights-design.md). Only exists where the Garmin feature is enabled.
 */

import { GARMIN_TABS, GarminClient, type GarminTab } from "@/components/features/GarminClient";
import { GarminDataExplorer } from "@/components/features/GarminDataExplorer";
import { GarminLoadTab } from "@/components/features/GarminLoadTab";
import { GarminMetricsTab } from "@/components/features/GarminMetricsTab";
import { env } from "@/lib/env";
import { getLoadSeries } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function GarminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  const asked = (await searchParams).tab;
  const tab: GarminTab = GARMIN_TABS.includes(asked as GarminTab) ? (asked as GarminTab) : "load";

  let content: React.ReactNode;
  if (tab === "load") {
    const { series, computedAt } = await getLoadSeries(auth.user.id);
    content = <GarminLoadTab series={series} computedAt={computedAt} />;
  } else if (tab === "overview") {
    content = <GarminMetricsTab />;
  } else {
    content = <GarminDataExplorer />;
  }
  return <GarminClient tab={tab}>{content}</GarminClient>;
}
