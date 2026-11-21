import { db } from "@/db";
import { users } from "@/db/schema/users";
import { getBodyMeasurements } from "@/lib/actions/body-measurements";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import { eq } from "drizzle-orm";

/** What the Measurements pages read: all of the user's values, today, and gender and height for the ratios. */
export async function loadMeasurements() {
  const session = await requireSession();
  const userId = session.user.id;
  const [result, today, [user]] = await Promise.all([
    getBodyMeasurements(),
    userToday(userId).then(toDateStr),
    db.select({ gender: users.gender, heightCm: users.heightCm }).from(users).where(eq(users.id, userId)),
  ]);
  return {
    rows: result.success ? result.data : [],
    error: result.success ? null : result.error,
    today,
    gender: user?.gender ?? null,
    heightCm: user?.heightCm ?? null,
  };
}
