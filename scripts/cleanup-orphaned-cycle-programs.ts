/**
 * One-time cleanup of orphaned cycle-generated programs.
 *
 * Programs the triathlon (and other cycle) generators created are now linked to
 * their cycle via programs.created_by_cycle_id and cascade-deleted with it. But
 * programs created BEFORE that FK existed were left behind when their cycle was
 * deleted — they clutter the Programs list and the slot picker. This prunes them.
 *
 * Safe by construction. A program is deleted only if ALL hold:
 *   - created_by_cycle_id IS NULL  (current generated programs cascade already)
 *   - its name matches a known generator template (never a user's own program)
 *   - it is NOT referenced by any training_cycle_slot   (no live cycle uses it)
 *   - it is NOT referenced by any workout_session       (no logged history)
 * Deleting a program cascades its program_exercises / program_sets.
 *
 * Usage (inside Docker):
 *   docker-compose exec app pnpm db:cleanup-programs            # delete
 *   DRY_RUN=true docker-compose exec app pnpm db:cleanup-programs   # preview only
 */

import { and, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { programs, trainingCycleSlots, workoutSessions } from "../src/db/schema";

// Names the cycle generators produce (current + historical labels).
const GENERATED_NAMES = [
  "Strength — Full Body A",
  "Strength A — Lower Body",
  "Run — Tempo",
  "Run — Threshold Intervals",
  "Swim — Endurance",
  "Bike — Endurance",
  "Strength B + Swim",
  "Strength B + Recovery Swim",
  "Long Bike + Brick Run",
  "Long Run",
];

async function cleanup() {
  const dryRun = process.env.DRY_RUN === "true";

  // Every program id referenced by a cycle slot or a workout session — off limits.
  const [slotRows, sessRows] = await Promise.all([
    db.select({ id: trainingCycleSlots.programId }).from(trainingCycleSlots),
    db.select({ id: workoutSessions.programId }).from(workoutSessions),
  ]);
  const referenced = new Set<number>();
  for (const r of [...slotRows, ...sessRows]) if (r.id != null) referenced.add(r.id);

  // Generator-named programs not owned by a current cycle.
  const candidates = await db
    .select({ id: programs.id, name: programs.name, userId: programs.userId })
    .from(programs)
    .where(and(isNull(programs.createdByCycleId), inArray(programs.name, GENERATED_NAMES)));

  const orphans = candidates.filter((p) => !referenced.has(p.id));

  if (orphans.length === 0) {
    console.log("✅ No orphaned generated programs found.");
    process.exit(0);
  }

  console.log(`${dryRun ? "🔎 [dry run] would delete" : "🧹 Deleting"} ${orphans.length} orphaned program(s):`);
  for (const o of orphans) console.log(`   - #${o.id} "${o.name}" (user ${o.userId})`);

  if (dryRun) {
    console.log("ℹ️  DRY_RUN=true — nothing deleted.");
    process.exit(0);
  }

  await db.delete(programs).where(inArray(programs.id, orphans.map((o) => o.id)));
  console.log("✅ Done — program_exercises and program_sets cascaded.");
  process.exit(0);
}

cleanup().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
