/**
 * The race page (docs/plans/garmin-insights-design.md, 2.13): where training
 * stands against race day. Opened from the Overview race strip.
 */

import { GarminRaceView } from "@/components/features/GarminRaceView";
import { env } from "@/lib/env";
import { getRaceData } from "@/lib/garmin/queries";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function GarminRacePage() {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) notFound();
  return <GarminRaceView data={await getRaceData(auth.user.id)} />;
}
