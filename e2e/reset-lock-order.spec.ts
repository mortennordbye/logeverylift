import pg from "pg";
import { assertTestDatabase } from "../scripts/lib/test-database";
import { e2eUser } from "./fixtures/env";
import { resetE2EUser } from "./fixtures/reset";
import { expect, test } from "./fixtures/test";

/**
 * The reset fixture against a set write that is still running. The previous
 * spec's last write can still run on the server when the next spec's reset
 * starts. A set write takes the per-exercise records lock, writes a set into
 * one session, then a record on an earlier session's set (a rebuild). The
 * reset used to delete the sessions first, lock the earlier one, and wait on
 * the later one: "deadlock detected while deleting tuple in relation
 * workout_sessions" (miss-sheet on WebKit, 2026-11-13). Now it takes the
 * write's locks first and waits for it.
 */

test("the reset waits for a set write that is still running instead of deadlocking", async ({}, testInfo) => {
  const email = e2eUser(testInfo.parallelIndex).email;
  const a = new pg.Client({ connectionString: assertTestDatabase(process.env.DATABASE_URL).toString() });
  await a.connect();
  try {
    const {
      rows: [u],
    } = await a.query('select id from "user" where email = $1', [email]);
    // The reset deletes sessions in heap order: the first one is locked before the last.
    const {
      rows: [last],
    } = await a.query("select id from workout_sessions where user_id = $1 order by ctid desc limit 1", [u.id]);
    const {
      rows: [first],
    } = await a.query(
      "select ws.id as set_id, ws.session_id, ws.exercise_id from workout_sets ws join workout_sessions w on w.id = ws.session_id where w.user_id = $1 order by w.ctid, ws.id limit 1",
      [u.id],
    );
    expect(first.session_id).not.toBe(last.id);

    // The write, as logWorkoutSet and rebuildPRsFrom do it.
    await a.query("begin");
    await a.query("select pg_advisory_xact_lock(hashtext($1), $2)", [u.id, first.exercise_id]);
    await a.query("insert into workout_sets (session_id, exercise_id, set_number, actual_reps, weight_kg, rest_time_seconds) values ($1, $2, 99, 1, 1, 0)", [
      last.id,
      first.exercise_id,
    ]);
    const reset = resetE2EUser(email).then(
      () => null,
      (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message,
    );
    // Let the reset reach its first lock while the write is open.
    const me = (a as unknown as { processID: number }).processID;
    await expect
      .poll(async () => (await a.query("select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [me])).rows[0].n)
      .toBe(1);
    await a.query("insert into exercise_prs (user_id, exercise_id, pr_type, value, session_id, set_id) values ($1, $2, 'weight', 100, $3, $4)", [
      u.id,
      first.exercise_id,
      first.session_id,
      first.set_id,
    ]);
    await a.query("commit");
    expect(await reset).toBeNull();
  } finally {
    await a.query("rollback").catch(() => {});
    await a.end();
  }
});
