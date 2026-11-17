import { resetUserSettings } from "@/contexts/user-settings-context";

/**
 * Device-wide display preferences, kept when someone signs out. Everything
 * else in localStorage (the active workout, rest timers, the offline queue,
 * AI drafts) belongs to the account and must not be left for the next person
 * on a shared phone.
 */
const DEVICE_PREFERENCES = ["theme", "accentColor", "customAccentHex", "uiScale"];

/** Writes from the offline queue that haven't reached the server yet, ride mode's taps included. */
export function unsyncedChangeCount(): number {
  let n = 0;
  try {
    const queue = JSON.parse(localStorage.getItem("pendingMutationQueue") ?? "[]");
    if (Array.isArray(queue)) n += queue.length;
  } catch {
    // A broken queue counts as empty.
  }
  try {
    // Ride id to taps (src/components/features/bike/useRide.ts).
    const rides = JSON.parse(localStorage.getItem("rideEventQueue") ?? "{}");
    if (rides && typeof rides === "object") for (const q of Object.values(rides)) if (Array.isArray(q)) n += q.length;
  } catch {
    // Same.
  }
  return n;
}

/** Remove the signed-in user's data from this browser: localStorage and the service worker's caches. */
export async function clearLocalUserData() {
  resetUserSettings();
  try {
    const kept = DEVICE_PREFERENCES.map((key) => [key, localStorage.getItem(key)] as const);
    localStorage.clear();
    for (const [key, value] of kept) if (value !== null) localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode): nothing was saved.
  }
  if (typeof caches !== "undefined") {
    const names = await caches.keys().catch(() => []);
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}
