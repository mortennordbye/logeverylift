# Feature build briefs

Seven features picked from a gap review on 2026-10-25. Each brief here is written to be built in a
fresh session with no conversation history.

## How to start one

1. Read `CLAUDE.md`, then the brief.
2. Branch off `main`, one PR per brief (web push is two PRs).
3. Build to the brief. If something it says turns out wrong in the code, trust the code, fix the
   brief in the same PR, and say so in the PR body.
4. Settle anything under **Open decisions** with the user before writing code for it.
5. When merged: set the status below to `done`, and delete the BACKLOG entries the brief lists.

Names marked *new* in a brief don't exist yet; everything else was checked against the code
when the brief was written.

## Build order

| # | Brief | Status | Schema change | Critical flow |
|---|---|---|---|---|
| 1 | [Show hidden data](show-hidden-data.md) | done | no | no |
| 2 | [Plate calculator and warm-ups](plates-and-warmups.md) | todo | no | yes |
| 3 | [Exercise detail page](exercise-detail-page.md) | todo | yes | no |
| 4 | [Edit past sessions](edit-past-sessions.md) | todo | no | yes |
| 5 | [Quick workout and session-only swap](quick-workout-and-swap.md) | todo | yes | yes |
| 6 | [Share card and recap](share-card-and-recap.md) | todo | no | no |
| 7 | [Web push and reminders](web-push-and-reminders.md) | todo | yes | yes (rest timer) |

Why this order:
- 1 is small, has no schema change, and clears two BACKLOG items.
- 2 adds pure helpers and one action, but touches set numbering mid-workout.
- 3 fixes a progress chart bug and extracts the chart component that 6 reuses.
- 4 has the riskiest logic (rebuilding records). It ships alone so it gets full attention.
- 5 changes the core workout model, which is easier once 4 has settled the session and
  record code.
- 6 depends on 3's chart and 4's correct records.
- 7 has the most new parts (a dependency, env vars, service worker code, a policy update), so
  it goes last and blocks nothing.

## Risks that cross briefs

- **Migrations:** 3, 5 and 7 each add one. Merge them one at a time. If another migration
  landed first, rebase and re-run `pnpm db:generate` so the Drizzle journal doesn't clash.
- **Program readers:** program shares, export, and the AI/MCP program tools read programs. Once
  5 adds session-only exercise slots and ad-hoc programs, every one of those readers must
  filter them out.
- **Critical flows:** 2, 4, 5 and 7 change one. Run `make e2e` and the 9-step smoke pass in
  CLAUDE.md before merging.
