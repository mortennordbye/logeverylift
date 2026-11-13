import { getFriendsActivityFeed } from "@/lib/actions/friends";
import type { HomeContext } from "@/lib/home/core";

/**
 * One friend workout as the widget gets it. Another person's data, so the
 * shape is exactly this and built field by field (docs/home-widgets-audit.md,
 * 6.5): no feeling, notes, volume or exercise count.
 */
export type FriendWorkout = {
  name: string;
  image: string | null;
  date: string;
  programName: string | null;
  setCount: number;
  sessionId: number;
};

/**
 * The newest friend workouts, up to the L size's six. Reads through the
 * friends action, which only returns friends who show their activity
 * (`users.showActivityToFriends`); never queries their sessions directly.
 */
export async function loadFriendsActivity(_ctx: HomeContext): Promise<FriendWorkout[] | null> {
  const result = await getFriendsActivityFeed();
  if (!result.success) throw new Error("friends feed read failed");
  if (result.data.length === 0) return null;
  return result.data.slice(0, 6).map((r) => ({
    name: r.name,
    image: r.image,
    date: r.date,
    programName: r.programName,
    setCount: r.setCount,
    sessionId: r.sessionId,
  }));
}
