import { requireSession } from "@/lib/utils/session";
import { afterRideData } from "./after/load";
import { AfterRideView } from "./after/AfterRideView";

/** The after-ride view on the session page (bike-sessions.md 5.5): renders only for a session paired with a Garmin activity. */
export async function AfterRide({ plannedSessionId }: { plannedSessionId: number }) {
  const { user } = await requireSession();
  const data = await afterRideData(user.id, plannedSessionId);
  return data ? <AfterRideView data={data} /> : null;
}
