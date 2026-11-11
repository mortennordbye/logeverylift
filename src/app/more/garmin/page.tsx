/**
 * More → Garmin: the user's Garmin data (docs/plans/garmin-deep-data.md).
 * Only exists where the Garmin feature is enabled.
 */

import { GarminClient, type GarminTab } from "@/components/features/GarminClient";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function GarminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  const initialTab: GarminTab = (await searchParams).tab === "data" ? "data" : "overview";
  return <GarminClient initialTab={initialTab} />;
}
