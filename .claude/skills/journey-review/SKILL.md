---
name: journey-review
description: Screenshot review of every step of a feature's user journeys in the real app, with demo accounts, at 390 and 320 px, then fix rounds until a fresh pass finds nothing new. Use for major features, redesigns, and any change to a critical flow from CLAUDE.md (logging a set, the rest and exercise timers, set editing, drag-reorder, finishing a workout, login), or when asked to "screenshot the user journeys", "review flows", "walk the journeys" or do a "QA pass".
---

# Journey review

Tests prove the logic. A journey review proves what the user sees: every screen of every journey,
on a normal and a small phone, with data that holds the edge cases. The Plan tab redesign
(`docs/plans/plan-tab-redesign.md`) was the first feature reviewed this way.

Tooling: [`scripts/journeys/README.md`](../../../scripts/journeys/README.md).

## When to use it

- A major feature or a redesign of a screen or a tab.
- Any change to a critical flow (the list in CLAUDE.md, "Testing standard").
- When the owner asks for screenshots of the journeys, a flow review or a QA pass.

Not needed for a small fix that a test covers and that changes no screen.

## The loop

1. **Seed demo data.** One account per state, with edge cases: empty state, long names, many
   items, past and future dates, deleted items. Run the feature's demo seed
   (`pnpm db:seed-plan-demo` is the example).
2. **Capture.** `pnpm journeys <set> --seed` takes every step at 390 and 320 px.
3. **Review every screenshot yourself.** Open each PNG. In `manifest.json`, fill `note` with what
   the screen shows and `bug` with what is wrong (`null` if nothing). Look for text that is cut
   or wraps badly at 320, wrong or missing states, controls under 44 px, a missing Close or
   Cancel, wording that breaks the rules below, and anything in `errors`. A step in
   `run.json` `failures` is a finding too: the flow broke, or the step is out of date.
4. **Publish the review page.** `pnpm journeys:page <folder>`, then publish `index.html` with
   the shots as a private artifact (shots go in `files` as `shots/<file>`). Share the link with
   the owner.
5. **Fix rounds.** One bug at a time, each with a failing test first (TESTING.md). Run
   `pnpm verify`.
6. **Capture again** with the same step ids (`--label r2`, `r3`, and so on), so each step can be
   compared with the last capture. Review again.
7. **Fresh-eyes QA.** Start a new agent that has not seen any earlier report or review. Give it
   the capture folder and the journeys, not your findings, and ask it to review every shot.
8. **Repeat** 5 to 7 until a full pass finds nothing new.
9. **Only then** ask the owner to test.

## Rules

- Demo accounts (`@demo.local`) on the local database only. Never real accounts, never prod or
  a tunnel to it. The runner refuses other hosts and other accounts.
- Never commit screenshots. Captures live in `.journeys/` (gitignored).
- No colons and no em dashes in UI copy. Labels are words, not sentences with a colon.
- Keep step ids (`journey`, `step`, `slug`) stable across captures. Add new steps with new
  numbers; do not renumber.
- Do not run two captures against the same server at once. Check with
  `pgrep -fl "journeys/run.ts"` first.
- The review page is private. It shows demo data only, but share it only with the owner.

## Add journeys for a new feature

1. Write `scripts/seed-<feature>-demo.ts` like `scripts/seed-plan-demo.ts`: local hosts only,
   refuses `NODE_ENV=production`, idempotent, accounts `<feature>-<state>@demo.local`, dates
   relative to today, writes through the app's libraries. Add `db:seed-<feature>-demo` to
   `package.json`.
2. Write `scripts/journeys/<feature>.journeys.ts` like `plan.journeys.ts`: accounts, journeys
   (id, title, one line of summary), and one flow per account with `step("J<n> ...")` and
   `shot(...)` calls. Find elements by role and name.
3. Run `pnpm journeys <feature> --seed --journeys 1` first to check the flow, then the full set.
