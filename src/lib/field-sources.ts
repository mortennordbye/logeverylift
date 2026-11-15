import { db } from "@/db";
import { users } from "@/db/schema";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import type { FieldSource, SyncedField } from "@/lib/utils/field-sources";
import { eq, sql } from "drizzle-orm";

/** Record who set a synced field today; "you" locks it against the Garmin sync. */
export async function markField(userId: string, field: SyncedField, by: FieldSource["by"]) {
  const source: FieldSource = { by, on: toDateStr(await userToday(userId)) };
  await db
    .update(users)
    .set({ fieldSources: sql`${users.fieldSources} || jsonb_build_object(${field}::text, ${JSON.stringify(source)}::jsonb)` })
    .where(eq(users.id, userId));
}
