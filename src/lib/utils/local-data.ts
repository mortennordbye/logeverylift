/**
 * Device-wide display preferences, kept when someone signs out. Everything
 * else in localStorage (the active workout, rest timers, the offline queue,
 * AI drafts) belongs to the account and must not be left for the next person
 * on a shared phone.
 */
const DEVICE_PREFERENCES = ["theme", "accentColor", "customAccentHex", "uiScale"];

/** Writes from the offline queue that haven't reached the server yet. */
export function unsyncedChangeCount(): number {
  try {
    const queue = JSON.parse(localStorage.getItem("pendingMutationQueue") ?? "[]");
    return Array.isArray(queue) ? queue.length : 0;
  } catch {
    return 0;
  }
}

/** Remove the signed-in user's data from this browser: localStorage and the service worker's caches. */
export async function clearLocalUserData() {
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
