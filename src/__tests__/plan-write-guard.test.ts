import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the revision layer (docs/plans/revisions.md, 2.2).
 *
 * 1. Every write to plan tables runs inside the revision layer: on a
 *    transaction (`tx`) in a file that uses src/lib/plan-revisions.ts. A write
 *    on `db` skips revisions, and no package may add one (plan principle 5).
 * 2. Every read of a soft-deleted table hides deleted rows, or says why not
 *    with a `plan-read: includes deleted (...)` comment in the statement.
 *
 * Both are text scans, so they are coarse: they catch the plain mistake of a
 * new query that forgets, which is the one that ships.
 */

const ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const SKIP = new Set([
  "db/schema",
  "lib/plan-revisions.ts",
  "lib/plan-live.ts",
]);

const files = sourceFiles(ROOT)
  .map((path) => ({ path, rel: relative(ROOT, path) }))
  .filter(({ rel }) => ![...SKIP].some((s) => rel.startsWith(s)));

/** Writes that may skip revisions: demo and fake seed data an admin resets. */
const WRITE_ALLOWED = new Set(["lib/actions/admin.ts"]);

/** The statement around a match: back to the previous `;`, `{` or `}` at line end, forward to the next `;`. */
function statementAround(text: string, index: number): string {
  let start = index;
  while (start > 0) {
    const ch = text[start - 1];
    if (ch === ";" || ((ch === "{" || ch === "}") && text[start] === "\n")) break;
    start--;
  }
  const end = text.indexOf(";", index);
  return text.slice(start, end < 0 ? text.length : end);
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

describe("plan writes go through the revision layer", () => {
  it("has no write to a plan table outside a plan-write transaction", () => {
    const problems: string[] = [];
    const WRITE =
      /\.(insert|update|delete)\(\s*(programs|programExercises|programSets|trainingCycles|trainingCycleSlots|coachMemory|athleteProfiles|athleteThresholds|athleteInjuries|seasons|seasonRaces|plannedSessions)\s*\)/g;
    for (const { path, rel } of files) {
      if (WRITE_ALLOWED.has(rel)) continue;
      const text = readFileSync(path, "utf8");
      const usesLayer = text.includes("@/lib/plan-revisions");
      for (const m of text.matchAll(WRITE)) {
        const stmt = statementAround(text, m.index!);
        const onTx = /\btx\b/.test(stmt) && !/\bdb\s*\.\s*(insert|update|delete)\b/.test(stmt);
        if (!usesLayer || !onTx) problems.push(`${rel}:${lineOf(text, m.index!)} ${m[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("plan reads hide soft-deleted rows", () => {
  const MARKERS: Record<string, RegExp> = {
    programs: /livePrograms|programs\.deletedAt|plan-read: includes deleted/,
    programExercises: /liveProgramExercises|programExercises\.deletedAt|plan-read: includes deleted/,
    programSets: /liveProgramSets|programSets\.deletedAt|plan-read: includes deleted/,
    trainingCycles: /liveCycles|trainingCycles\.deletedAt|plan-read: includes deleted/,
    coachMemory: /coachMemory\.deletedAt|plan-read: includes deleted/,
    athleteProfiles: /athleteProfiles\.deletedAt|plan-read: includes deleted/,
    athleteThresholds: /athleteThresholds\.deletedAt|plan-read: includes deleted/,
    athleteInjuries: /athleteInjuries\.deletedAt|plan-read: includes deleted/,
    seasons: /seasons\.deletedAt|plan-read: includes deleted/,
    plannedSessions: /livePlannedSessions|plannedSessions\.deletedAt|plan-read: includes deleted/,
  };

  it("filters every read of programs, slots, sets and cycles", () => {
    const problems: string[] = [];
    const TABLES = "programs|programExercises|programSets|trainingCycles|coachMemory|athleteProfiles|athleteThresholds|athleteInjuries|seasons|plannedSessions";
    const READ = new RegExp(
      `\\.from\\(\\s*(${TABLES})\\s*\\)|Join\\(\\s*(${TABLES})\\s*,|query\\.(${TABLES})\\.find(?:First|Many)`,
      "g",
    );
    for (const { path, rel } of files) {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(READ)) {
        const table = m[1] ?? m[2] ?? m[3];
        const stmt = statementAround(text, m.index!);
        if (!MARKERS[table].test(stmt)) problems.push(`${rel}:${lineOf(text, m.index!)} ${table}`);
      }
      // Relational reads of the child tables.
      for (const m of text.matchAll(/\b(programExercises|programSets): \{/g)) {
        // The relation's own options: its `where` comes first, within a few lines.
        const block = text.slice(m.index!, m.index! + 160);
        if (!/deletedAt|liveProgram|plan-read: includes deleted/.test(block)) {
          problems.push(`${rel}:${lineOf(text, m.index!)} with ${m[1]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
