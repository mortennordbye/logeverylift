/**
 * More → Garmin: the user's Garmin data (docs/plans/garmin-deep-data.md,
 * docs/plans/garmin-insights-design.md). Only exists where the Garmin feature is enabled.
 */

import { GarminShell } from "@/components/features/garmin/GarminShell";
import { garminView } from "@/components/features/garmin/tabs";
import { db } from "@/db";
import { garminConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { GarminActivitiesTab } from "@/components/features/GarminActivitiesTab";
import { GarminDataExplorer } from "@/components/features/GarminDataExplorer";
import { GarminLoadTab } from "@/components/features/GarminLoadTab";
import { GarminOverviewTab } from "@/components/features/GarminOverviewTab";
import { GarminSleepTab } from "@/components/features/GarminSleepTab";
import { GarminTodayTab } from "@/components/features/GarminTodayTab";
import { env } from "@/lib/env";
import { getActivitiesData, getLoadSeries, getOverviewData, getSleepData, getTodayData, latestGarminDate } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function GarminPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  const params = await searchParams;
  const tab = garminView(params.tab);

  let content: React.ReactNode;
  if (tab === "overview") {
    content = <GarminOverviewTab data={await getOverviewData(auth.user.id)} />;
  } else if (tab === "day") {
    const latest = await latestGarminDate(auth.user.id);
    const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : latest;
    content = <GarminTodayTab data={await getTodayData(auth.user.id, date)} isLatest={date === latest} />;
  } else if (tab === "activities") {
    content = <GarminActivitiesTab data={await getActivitiesData(auth.user.id)} />;
  } else if (tab === "recovery") {
    content = <GarminSleepTab data={await getSleepData(auth.user.id)} />;
  } else if (tab === "training") {
    const { series, computedAt } = await getLoadSeries(auth.user.id);
    content = <GarminLoadTab series={series} computedAt={computedAt} />;
  } else {
    content = <GarminDataExplorer />;
  }
  const [conn] = await db
    .select({ lastSyncedAt: garminConnections.lastSyncedAt })
    .from(garminConnections)
    .where(eq(garminConnections.userId, auth.user.id));
  return (
    <GarminShell tab={tab} lastSyncedAt={conn?.lastSyncedAt?.toISOString() ?? null}>
      {content}
    </GarminShell>
  );
}
