/**
 * Insights: the user's Garmin data, in its own section (docs/plans/garmin-deep-data.md).
 * Only exists where the Garmin feature is enabled.
 */

import { InsightsClient, type InsightsTab } from "@/components/features/InsightsClient";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  const initialTab: InsightsTab = (await searchParams).tab === "data" ? "data" : "overview";
  return <InsightsClient initialTab={initialTab} />;
}
