/**
 * Verify the file:line claims our docs make about the code.
 *
 * Specs and plans cite the source constantly ("`progression.ts:506`"). Those
 * citations rot silently as code moves, and worse, they can be wrong the day
 * they are written — a plan in this repo once cited `getAdaptationSignals`,
 * a function that has never existed, and nothing caught it for two review
 * passes. Prose is not type-checked; this makes the checkable part of it fail
 * the build instead.
 *
 * Two checks, both deliberately narrow to keep false positives near zero:
 *
 *   1. Every `path.ts:123` citation resolves to a real file, and line 123
 *      exists in it.
 *   2. Every code-looking `identifier` named in the same paragraph as a
 *      citation appears somewhere in the repo. This is the invented-symbol
 *      check; it does not care *where* the symbol is, only that it is real.
 *
 * What it deliberately does NOT do: assert that a cited line still means what
 * the prose says. That needs judgement. This catches drift and invention,
 * which is where the cheap mistakes live.
 *
 * Usage: pnpm check:docs [--verbose]
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");

/** Docs that make claims about code. Others (runbooks, READMEs) are skipped. */
const DOC_GLOBS = ["docs", "BACKLOG.md", "CLAUDE.md"];

/** Source roots a citation may point into. */
const SOURCE_DIRS = ["src", "scripts", "e2e", "drizzle"];

type Problem = { doc: string; line: number; message: string };

function gitLs(pathspec: string): string[] {
  try {
    return execFileSync("git", ["ls-files", pathspec], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const docFiles = DOC_GLOBS.flatMap((g) => gitLs(g)).filter((f) => f.endsWith(".md"));
const sourceFiles = SOURCE_DIRS.flatMap((d) => gitLs(d));

/** basename -> repo-relative paths, for resolving bare `Foo.tsx:12` citations. */
const byBasename = new Map<string, string[]>();
for (const f of sourceFiles) {
  const base = f.split("/").pop()!;
  byBasename.set(base, [...(byBasename.get(base) ?? []), f]);
}

/** Every identifier that appears anywhere in the source, for check 2. */
const sourceText = sourceFiles
  .filter((f) => /\.(ts|tsx|sql)$/.test(f))
  .map((f) => readFileSync(join(ROOT, f), "utf8"))
  .join("\n");
const sourceSymbols = new Set(sourceText.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);

const lineCountCache = new Map<string, number>();
function lineCount(relPath: string): number {
  if (!lineCountCache.has(relPath)) {
    lineCountCache.set(relPath, readFileSync(join(ROOT, relPath), "utf8").split("\n").length);
  }
  return lineCountCache.get(relPath)!;
}

/**
 * Resolve a cited path. Docs cite both full paths (`src/lib/x.ts`) and bare
 * filenames (`WorkoutSetsList.tsx`), the latter only when unambiguous.
 */
function resolveCited(cited: string): { paths: string[]; error?: string } {
  if (existsSync(join(ROOT, cited))) return { paths: [cited] };
  const withSrc = SOURCE_DIRS.map((d) => join(d, cited)).find((p) => existsSync(join(ROOT, p)));
  if (withSrc) return { paths: [withSrc] };
  const matches = byBasename.get(cited.split("/").pop()!) ?? [];
  if (matches.length === 0) return { paths: [], error: "no such file" };
  // Several files share the basename (schema/workout-sets.ts vs
  // actions/workout-sets.ts). Docs cite these bare and rely on context, which
  // is fine and not worth rewriting 200 citations over. Prefer a path that
  // ends with what was cited, else accept the line if it is valid in ANY
  // candidate — that still catches a line number that exists nowhere.
  const suffixMatch = matches.filter((m) => m.endsWith(cited));
  return { paths: suffixMatch.length > 0 ? suffixMatch : matches };
}

// A citation: `some/path.ts:123` or `path.ts:123-456`, inside backticks.
const CITATION = /`([\w./-]+\.(?:ts|tsx|sql|md)):(\d+)(?:-(\d+))?`/g;
// A bare `:123` continuation, e.g. "(`progression.ts:139`, `:506`)".
const CONTINUATION = /`:(\d+)(?:-(\d+))?`/g;
// Code-looking backticked symbols: camelCase or snake_case, no dots or spaces.
// camelCase only. snake_case backticks in a *plan* are usually columns that do
// not exist yet (`rep_range_max`), and flagging those would make the tool cry
// wolf on every design doc.
const SYMBOL = /`([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)`/g;

/** Prose words that look like identifiers but are not symbols. */
const IGNORE = new Set([
  "javaScript", "typeScript", "postgreSQL", "iOS", "aMRAP", "rIR", "rPE",
  "onDelete", "onConflictDoUpdate", // real, but may live in node_modules typings
  "scrollHeight", "clientHeight", "offsetHeight", // DOM API, not repo symbols
]);

const problems: Problem[] = [];
let citationCount = 0;
let symbolCount = 0;

for (const doc of docFiles) {
  const text = readFileSync(join(ROOT, doc), "utf8");
  // A point-in-time audit's citations describe the code as it was; rewriting
  // them to today's line numbers would falsify the record. Opt such docs out
  // with `<!-- doc-claims: skip -->` near the top.
  if (/<!--\s*doc-claims:\s*skip/.test(text)) {
    if (VERBOSE) console.log(`  (skipping ${doc} — opted out)`);
    continue;
  }
  const lines = text.split("\n");
  // Paragraphs, so a symbol is only checked against citations near it.
  const paragraphs = text.split(/\n\s*\n/);

  // ── Check 1: citations resolve, and the line exists ──
  let lastResolved: string[] = [];
  lines.forEach((lineText, idx) => {
    for (const m of lineText.matchAll(CITATION)) {
      citationCount++;
      const [, cited, startStr, endStr] = m;
      const { paths, error } = resolveCited(cited);
      if (paths.length === 0) {
        problems.push({ doc, line: idx + 1, message: `cites \`${cited}\` — ${error}` });
        continue;
      }
      lastResolved = paths;
      const end = Number(endStr ?? startStr);
      const fits = paths.some((pth) => Number(startStr) >= 1 && end <= lineCount(pth));
      if (!fits) {
        const sizes = paths.map((pth) => `${pth} has ${lineCount(pth)}`).join(", ");
        problems.push({
          doc,
          line: idx + 1,
          message: `cites \`${cited}:${startStr}${endStr ? `-${endStr}` : ""}\` but ${sizes}`,
        });
      }
    }
    // Bare `:123` refers back to the last cited file on the same line or above.
    if (lastResolved.length > 0 && !lineText.match(CITATION)) {
      for (const m of lineText.matchAll(CONTINUATION)) {
        citationCount++;
        const end = Number(m[2] ?? m[1]);
        // Same tolerance as a full citation: valid in any candidate is valid.
        if (!lastResolved.some((pth) => end <= lineCount(pth))) {
          const sizes = lastResolved.map((pth) => `${pth} has ${lineCount(pth)}`).join(", ");
          problems.push({
            doc,
            line: idx + 1,
            message: `cites \`:${m[1]}\` but ${sizes}`,
          });
        }
      }
    }
  });

  // ── Check 2: symbols named alongside a citation actually exist ──
  for (const para of paragraphs) {
    if (!CITATION.test(para)) {
      CITATION.lastIndex = 0;
      continue;
    }
    CITATION.lastIndex = 0;
    for (const m of para.matchAll(SYMBOL)) {
      const sym = m[1];
      if (IGNORE.has(sym) || sym.length < 4) continue;
      symbolCount++;
      if (!sourceSymbols.has(sym)) {
        const lineNo = lines.findIndex((l) => l.includes(`\`${sym}\``)) + 1;
        problems.push({
          doc,
          line: lineNo || 1,
          message: `names \`${sym}\` beside a code citation, but no such symbol exists in the repo`,
        });
      }
    }
  }
}

const checked = `${citationCount} citations, ${symbolCount} symbols, across ${docFiles.length} docs`;

if (problems.length === 0) {
  console.log(`✓ doc claims verified (${checked})`);
  process.exit(0);
}

console.error(`✗ ${problems.length} doc claim problem(s) (${checked})\n`);
for (const p of problems) {
  console.error(`  ${p.doc}:${p.line}`);
  console.error(`    ${p.message}`);
}
console.error(
  `\nFix the doc, or the code moved and the citation needs updating.` +
    (VERBOSE ? "" : `\nRun with --verbose for more detail.`),
);
process.exit(1);
