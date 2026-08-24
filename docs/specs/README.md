# Feature specs

A **spec** says what a feature is *supposed* to do. The docs one level up ([`../README.md`](../README.md)) are **maps** — they say where code lives and how it flows. Both are needed and they answer different questions:

| | Answers | Changes when |
|---|---|---|
| Map (`docs/*.md`) | "Where does X live? How does Y flow?" | The code moves |
| Spec (`docs/specs/*.md`) | "What should happen, and why?" | The *intent* changes |

The point of writing intent down separately is that it can be **disagreed with**. A map can only be out of date; a spec can be wrong — and when the code contradicts it, that is a finding, not a matter of taste.

## The rules

**1. State intent, not implementation.** Describe the behaviour and the reason for it. Cite `file.ts:line` as evidence, never as the subject. If a refactor moves the code but the behaviour is unchanged, only the revision stamp moves.

**2. Every behaviour is a numbered rule.** Each spec picks a short prefix (`SI` for smart incrementation) and numbers its rules from 1. IDs are permanent: cite them in review, in bug reports, in test names. A rule that is withdrawn stays in place, struck through, with a line saying what replaced it — so an old reference never dangles.

**3. A rule must be falsifiable.** You have to be able to point at code or a test and say "that's wrong". "Handles bodyweight sensibly" is not a rule. "When the last logged weight is 0, weight and smart modes fall back to a rep increment" is.

**4. Each rule carries three things:**

```markdown
### SI-4 — Felt-easy override
The consensus gate is satisfied on its own when the most recent logged set
is marked `wasEasy` **and** met its target.

*Why:* the lifter has already answered the question the gate exists to ask.
*Covered by:* `progressive-suggestions.test.ts` — "progresses off a single easy set…"
```

`Covered by: none` is a valid and useful answer. An uncovered rule should be visible, not quietly omitted.

**5. Carry a header block.** Required on every spec:

```markdown
> **Status:** implemented | partial | planned
> **Last verified:** YYYY-MM-DD against `<sha>`
> **Source of truth:** `src/lib/utils/thing.ts`, `src/lib/actions/thing.ts`
>
> Stale check: `git log <sha>..HEAD -- src/lib/utils/thing.ts`
```

Specs drift, and a stale spec that reads as authoritative is worse than no spec. The stamp records when a human last walked the rules against the code — not when the file was last edited. Re-verify and move the stamp only when you have actually re-read the source.

**6. Draw the scope boundary.** Where a neighbouring system could be mistaken for this one, name it and point elsewhere. Shared vocabulary between two subsystems is a trap worth spending three lines on.

**7. The Divergences table is mandatory** — including when it is empty, in which case it reads `None known as of YYYY-MM-DD @ <sha>`. A missing table can't be told apart from a table nobody ever filled in.

Anything confirmed there also gets a `BACKLOG.md` entry, cross-referenced by rule ID. A finding that lives only in a doc is a finding nobody will action.

**8. Link, don't restate.** Schema detail belongs in [`../data-model.md`](../data-model.md), conventions in [`../../CLAUDE.md`](../../CLAUDE.md), known gaps in `BACKLOG.md`. Reference them by name and anchor.

## Writing one

The `feature-spec` skill (`.claude/skills/feature-spec/`) carries the full procedure — scoping, the rule format, the verification walk, and how to resolve a divergence. Invoke it rather than working from memory.

Copy [`TEMPLATE.md`](TEMPLATE.md). Formatting follows the house style in [`../README.md`](../README.md): no front-matter, one `#`, headings no deeper than `###`, tables with `|---|`, `✓`/`—` for yes/no, backticked paths, no emoji.

Fill the Divergences table *last* — writing a rule down is what makes you check whether the code agrees, and that check is most of the value.

## Index

| Spec | Covers | Last verified |
|---|---|---|
| [smart-incrementation.md](smart-incrementation.md) | Progressive overload: increment sizing, the confidence/consensus gates, deload, retry, readiness, felt-easy, the seven progression modes, the plan ratchet | 2026-08-24 @ `3a09857` |
