# <Feature name>

> **Status:** implemented | partial | planned
> **Last verified:** YYYY-MM-DD against `<sha>`
> **Source of truth:** `src/lib/utils/<x>.ts`, `src/lib/actions/<x>.ts`
>
> Stale check: `git log <sha>..HEAD -- src/lib/utils/<x>.ts`

One or two sentences: what this feature is for, in the language a lifter would use. Then the one idea a reader has to hold in their head to follow the rest.

Rule prefix: **`XX`**.

## Vocabulary

Terms this spec uses precisely. Only the ones that are ambiguous without a definition.

- **Term** — what it means here, and what it is *not*.

## Scope boundary

What this spec does **not** cover, especially any neighbouring system that shares vocabulary with it. Link where that one is documented.

## Inputs

What the behaviour reads: settings columns, logged data, session state. Point at [`../data-model.md`](../data-model.md) for the schema rather than restating it; note only what is non-obvious (a null that means "unset", a column doing double duty).

## <Behaviour area> — XX-1…n

### XX-1 — Short title
The normative statement. Present tense, one behaviour, testable.

*Why:* the reason this is the intended behaviour — the part that otherwise dies in a review thread.
*Covered by:* `<test file>` — "<test name>", or `none`.

## Divergences (intent vs code)

Where the code does not do what this spec says. Verify each against the source before listing it. Every open row needs a `BACKLOG.md` entry.

| Rule | Intended | Actual | Status |
|---|---|---|---|
| XX-n | … | … | open — `BACKLOG.md` § … |

_None known as of YYYY-MM-DD @ `<sha>`._

## Coverage

| Rule | Covered by |
|---|---|
| XX-1 | `…test.ts` — "…" |

Rules with no test are listed here as `none` rather than omitted.
