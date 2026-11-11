/**
 * More → Garmin: the user's Garmin data (docs/plans/garmin-deep-data.md,
 * docs/plans/garmin-insights-design.md). Only exists where the Garmin feature is enabled.
 */

import { GARMIN_TABS, GarminClient, type GarminTab } from "@/components/features/GarminClient";
import { GarminActivitiesTab } from "@/components/features/GarminActivitiesTab";
import { GarminDataExplorer } from "@/components/features/GarminDataExplorer";
import { GarminLoadTab } from "@/components/features/GarminLoadTab";
import { GarminMetricsTab } from "@/components/features/GarminMetricsTab";
import { GarminSleepTab } from "@/components/features/GarminSleepTab";
import { GarminTodayTab } from "@/components/features/GarminTodayTab";
import { env } from "@/lib/env";
import { getActivitiesData, getLoadSeries, getSleepData, getTodayData, latestGarminDate } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function GarminPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  const params = await searchParams;
  const tab: GarminTab = GARMIN_TABS.includes(params.tab as GarminTab) ? (params.tab as GarminTab) : "today";

  let content: React.ReactNode;
  if (tab === "today") {
    const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : await latestGarminDate(auth.user.id);
    content = <GarminTodayTab data={await getTodayData(auth.user.id, date)} />;
  } else if (tab === "activities") {
    content = <GarminActivitiesTab data={await getActivitiesData(auth.user.id)} />;
  } else if (tab === "sleep") {
    content = <GarminSleepTab data={await getSleepData(auth.user.id)} />;
  } else if (tab === "load") {
    const { series, computedAt } = await getLoadSeries(auth.user.id);
    content = <GarminLoadTab series={series} computedAt={computedAt} />;
  } else if (tab === "overview") {
    content = <GarminMetricsTab />;
  } else {
    content = <GarminDataExplorer />;
  }
  return <GarminClient tab={tab}>{content}</GarminClient>;
}
