/**
 * Remove ghost sessions: completed workouts with no logged sets, no notes and
 * no feeling (decision D23, docs/triathlon-coach-audit.md). The rule lives in
 * src/lib/ghost-sessions.ts.
 *
 * A dry run by default: it lists the ghosts and deletes nothing. Only
 * `--delete` deletes. Output holds session ids, user ids, dates and durations,
 * never names, emails or notes.
 *
 * Usage:
 *   pnpm db:cleanup-ghosts              # dry run
 *   pnpm db:cleanup-ghosts --delete     # delete
 * In the production image (bundled to /app/scripts):
 *   node /app/scripts/cleanup-ghost-sessions.js
 *   node /app/scripts/cleanup-ghost-sessions.js --delete
 */

import { deleteGhostSessions, findGhostSessions } from "../src/lib/ghost-sessions";

async function main() {
  const deleteMode = process.argv.includes("--delete");
  const ghosts = await findGhostSessions();

  const perUser = new Map<string, number>();
  for (const g of ghosts) perUser.set(g.userId, (perUser.get(g.userId) ?? 0) + 1);

  console.log(`${ghosts.length} ghost session(s) across ${perUser.size} user(s).`);
  for (const [userId, count] of perUser) console.log(`  user ${userId}: ${count}`);
  for (const g of ghosts) {
    console.log(`  #${g.id} user ${g.userId} ${g.date} ${g.hours == null ? "no end" : `${g.hours} h`}`);
  }

  if (!deleteMode) {
    console.log("Dry run: nothing deleted. Run again with --delete to delete these sessions.");
    process.exit(0);
  }

  const deleted = await deleteGhostSessions();
  console.log(`Deleted ${deleted.length} ghost session(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Ghost cleanup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
