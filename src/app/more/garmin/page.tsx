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
import { GarminTrendsTab } from "@/components/features/GarminTrendsTab";
import { garminToday, getActivitiesData, getCorrelationDays, getSessionInsights, getLoadSeries, getOverviewData, getRaceProjection, getSleepData, getTodayData, getTrendsData, getVolumeData, latestGarminDate } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { rankInsights } from "@/lib/garmin/analytics/insights";
import { findings } from "@/lib/garmin/analytics/correlations";
import { wearableSuggestion } from "@/lib/periodization-sync";
import { notFound } from "next/navigation";
import { garminAllowed } from "@/lib/garmin/access";

export default async function GarminPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const auth = await requireSession();
  if (!garminAllowed(auth.user.role)) notFound();
  const params = await searchParams;
  const tab = garminView(params.tab);

  let content: React.ReactNode;
  if (tab === "overview") {
    // Today where the user is, read once for every query below.
    const today = await garminToday(auth.user.id);
    const [data, volume] = await Promise.all([getOverviewData(auth.user.id, today), getVolumeData(auth.user.id, today)]);
    const session = await getSessionInsights(auth.user.id, volume, today);
    content = <GarminOverviewTab data={{ ...data, insights: rankInsights([...data.insights, ...session]) }} volume={volume} />;
  } else if (tab === "day") {
    const latest = await latestGarminDate(auth.user.id);
    const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : latest;
    const today = await getTodayData(auth.user.id, date);
    // Session and race insights are about now, so only the newest day gets them.
    const localToday = await garminToday(auth.user.id);
    const session = date === latest ? await getSessionInsights(auth.user.id, await getVolumeData(auth.user.id, localToday), localToday) : [];
    content = <GarminTodayTab data={{ ...today, insights: rankInsights([...today.insights, ...session]) }} isLatest={date === latest} />;
  } else if (tab === "trends") {
    content = <GarminTrendsTab data={await getTrendsData(auth.user.id)} />;
  } else if (tab === "activities") {
    content = <GarminActivitiesTab data={await getActivitiesData(auth.user.id)} />;
  } else if (tab === "recovery") {
    const [sleep, days] = await Promise.all([getSleepData(auth.user.id), getCorrelationDays(auth.user.id)]);
    content = <GarminSleepTab data={sleep} findings={findings(days)} />;
  } else if (tab === "training") {
    const today = await garminToday(auth.user.id);
    const [{ series, computedAt }, volume] = await Promise.all([getLoadSeries(auth.user.id), getVolumeData(auth.user.id, today)]);
    const [race, suggestion] = await Promise.all([getRaceProjection(auth.user.id, series, today), wearableSuggestion(auth.user.id)]);
    content = <GarminLoadTab series={series} computedAt={computedAt} volume={volume} race={race} suggestion={suggestion} />;
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
