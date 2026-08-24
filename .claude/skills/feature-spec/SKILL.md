---
name: feature-spec
description: Write or update a behaviour spec in docs/specs/ — a numbered, citable statement of what a feature is SUPPOSED to do, verified rule-by-rule against the source. Use when asked to document how a feature works or is intended to work, to write/update a spec, to add rules to an existing spec, or to re-verify a spec whose stamp has gone stale. Not for reference maps (docs/*.md), READMEs, or ops runbooks.
---

# Writing a feature spec

A **spec** says what a feature is *supposed* to do. The maps in `docs/` say where code lives. A map can only be out of date; **a spec can be wrong** — and when the code contradicts it, that is a finding, not a stale doc.

The full standard is [`docs/specs/README.md`](../../../docs/specs/README.md). Read it before starting. This skill is the procedure for producing one that meets it.

The worked example is [`docs/specs/smart-incrementation.md`](../../../docs/specs/smart-incrementation.md) — 40 rules over the progression engine. Match its depth.

## What makes this different from ordinary doc work

Most of the value is not in the prose. It is in the **walk**: writing a rule down forces you to check whether the code actually does that, and that check is what surfaces bugs. A spec produced by paraphrasing the code is worthless — it will faithfully document the bug as if it were intent.

So: never describe a branch you have not read. Never cite a line you have not opened.

## Procedure

### 1. Scope it

One spec per subsystem, not per function and not per mode. If a precedence order spans several parts, they belong in one document — splitting hides exactly the thing that is hard to hold in your head.

Pick a permanent rule prefix (2 letters, e.g. `SI` for smart incrementation). Check `docs/specs/` for collisions.

### 2. Read the whole subsystem first

Read the pure logic end to end before writing anything — the engine, the action that feeds it, the validators, the consumers. Use `git show --stat` + the diff on the commits that built it: **commit bodies carry intent that the code cannot**, including admitted gaps.

Note as you go, but do not write rules yet.

### 3. Write the header block

```markdown
> **Status:** implemented | partial | planned
> **Last verified:** YYYY-MM-DD against `<sha>`
> **Source of truth:** `src/lib/utils/x.ts`, `src/lib/actions/x.ts`
>
> Stale check: `git log <sha>..HEAD -- src/lib/utils/x.ts`
```

`<sha>` is `git rev-parse --short HEAD`. The date is today. **The stamp records when a human walked the rules against the code — not when the file was edited.** Never move it as a side effect of editing.

### 4. Draw the scope boundary

Name any neighbouring system that shares vocabulary and point where it is documented. Shared *constant names* across subsystems are worth calling out explicitly — in this repo `DELOAD_FACTOR` is `0.9` in `progression.ts` and `0.75` in `periodization.ts`, which is a trap worth three lines.

### 5. Write the rules

Number from 1, group under `##` headings by behaviour area, one `###` per rule.

```markdown
### XX-4 — Short title
The normative statement. Present tense, one behaviour, testable.

*Why:* the reason this is the intended behaviour.
*Covered by:* `<test file>` — "<exact test name>", or `none`.
```

- **Falsifiable or it is not a rule.** "Handles bodyweight sensibly" — no. "When the last logged weight is 0, weight and smart modes fall back to a rep increment" — yes.
- **The *Why* is the point.** It is the part that dies in a review thread and never gets written anywhere else. If you cannot find a reason, that itself is a finding — say so.
- **`Covered by: none` is a valid answer.** An uncovered rule must be visible, never quietly omitted.
- **IDs are permanent.** Never renumber. A withdrawn rule stays, struck through, with a line saying what replaced it, so old references never dangle.

Where precedence exists, lead the section with a table of the order — it is usually the single most valuable thing in the document.

### 6. Verify every rule against the source

This is the step that cannot be skipped or delegated to memory.

For each rule: open the cited `file.ts:line` and confirm the statement holds. Then check your references mechanically:

```bash
# every cited line resolves to what you think it does
for r in "src/lib/utils/x.ts:419" "src/lib/actions/x.ts:1236"; do
  f="${r%:*}"; n="${r##*:}"; printf "%-40s %s\n" "$r" "$(sed -n "${n}p" "$f" | cut -c1-70)"
done
```

Line numbers drift while you write. Re-check them at the end, not just when you first note them.

Then confirm every test name you cited actually exists:

```bash
python3 - <<'PY'
import re
spec = open("docs/specs/<name>.md").read()
tests = open("src/__tests__/<suite>.test.ts").read()
names = {n for line in spec.splitlines() if "Covered by" in line
         for n in re.findall(r'"([^"]+)"', line)}
missing = [n for n in names if n.split("…")[0].strip().rstrip(".") not in tests]
print(f"{len(names)} cited;", "all found" if not missing else f"MISSING: {missing}")
PY
```

### 7. Fill the Divergences table last

Writing the rules is what reveals these. Every candidate must be **re-verified against the source** before it goes in — a false bug report costs more than a missing one.

| Rule | Intended | Actual | Status |
|---|---|---|---|
| XX-7 | … | … | open |

Three outcomes per candidate, and none may be left unresolved:

1. **Confirmed divergence** — row in the table + a `BACKLOG.md` entry.
2. **Intended after all** — delete the row, write it up as a rule instead.
3. **Intent genuinely unknown** — row marked `open — intent needed`. Say plainly in the doc that the spec cannot state a rule until someone decides. Do not invent the intent.

The table is **mandatory even when empty**: `_None known as of YYYY-MM-DD @ <sha>._` A missing table cannot be told apart from one nobody filled in.

### 8. Backlog entries

Every open row needs one, in the existing four-bullet format, cross-referenced by rule ID:

```markdown
### <Short title referencing the divergence IDs>
- **What:** the finding, with `file.ts:line` and the rule ID it contradicts.
- **Why deferred:** why it wasn't fixed now.
- **Unblocked by:** the decision or evidence that would let someone act.
- **Touchpoints:** the files.
```

Pair findings that share a single decision. Where `BACKLOG.md` **already** covers something, link that entry — do not add a second.

### 9. Wire it up

- Add a row to the Specs table in `docs/README.md` (spec, what it covers, last verified).
- Add a row to the index in `docs/specs/README.md`.
- Run `pnpm verify`. Doc-only work touches no source, so this is a regression check — but run it.
- Say `skipping smoke — change is doc-only`.

## Hard rules

- **No behaviour changes in a spec pass.** Findings are recorded, never fixed in the same change. Mixing them makes the diff unreviewable and the progression logic is high blast-radius.
- **State intent, not implementation.** Cite `file.ts:line` as evidence, never as the subject. A refactor that moves code without changing behaviour moves only the stamp.
- **Link, don't restate.** Schema goes in `docs/data-model.md`, conventions in `CLAUDE.md`, gaps in `BACKLOG.md`.
- **House formatting:** no front-matter, one `#`, depth no deeper than `###`, tables with `|---|`, `✓`/`—` for yes/no, backticked paths, no emoji, and no assistant or tooling names anywhere in prose.

## Reviewing an existing spec

Same procedure, narrowed. Run the stale check from the header, read only what changed, then:

- Behaviour changed → update the rule, keep its ID.
- Behaviour removed → strike the rule through, keep it, note what replaced it.
- Behaviour added → append a new ID at the end of its section. Never renumber to make it tidy.
- Nothing changed → move the stamp, but only after actually re-reading.
