# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working approach

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Track unfinished work in BACKLOG.md

If you leave anything unfinished, partially implemented, or explicitly defer it, add an entry to `BACKLOG.md` in the repo root before reporting the task done. Don't bury deferrals in chat — they vanish next session.

Each entry needs four things: **what** the work is, **why** it was deferred, **what would unblock it**, and **where** the relevant code lives (file paths). Read existing entries for the format.

Don't put work-in-progress on `BACKLOG.md` — WIP belongs on a branch. The backlog is for *known gaps the team has agreed to leave for later*. If you finish an item, delete it.

What counts as "unfinished":
- Tier 1 / Tier 2 splits where you only shipped Tier 1.
- Out-of-scope items you noticed but didn't fix.
- Features behind a feature flag that still need ramping or cleanup.
- Tests skipped, mocks left in, debug logging not yet stripped.
- TODO comments you wrote (write the entry instead — TODOs rot in code).

What does NOT belong:
- Forward-looking ideas the user didn't agree to defer ("we could also..."). Either do them or drop them.
- Codebase-wide debts that pre-existed your work and the user didn't ask you to track.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Development

All development runs in Docker. **Do not use `npm run dev` directly.**

```bash
./scripts/dev.sh              # Start dev environment (app at localhost:3000)
./scripts/dev.sh --test       # Run tests before starting
./scripts/dev.sh --skip-build # Skip Docker image rebuild
./scripts/dev.sh --clean      # Force clean build
```

**Tests run locally** (no Docker needed):
```bash
pnpm test                                        # Run all tests once
pnpm test:watch                                  # Watch mode
pnpm test src/__tests__/format.test.ts           # Single file
pnpm test src/__tests__/format.test.ts -t "name" # Single test by name
```

## Before reporting a task complete

Run `pnpm verify` from the host. It runs `tsc --noEmit`, `eslint`, and the Vitest suite. If anything fails, fix it and re-run before declaring the task done.

Do not skip this even when the change "looks obviously correct" — the bugs that slip through are the unexpected ones.

A pre-push git hook (lefthook) runs `pnpm verify` automatically — install it once with `pnpm install` (the `prepare` script wires it up). Pre-commit is intentionally empty so commits stay fast for AI loops.

For changes that touch a critical user flow (workout logging, rest picker, set editing, drag-reorder, login), additionally run `pnpm verify:full` — it adds Playwright e2e on top of `verify`. Requires the dev server running at `localhost:3000` and `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` env vars set to a test account. Specs live in `e2e/`; add a new one when you ship a critical flow that doesn't have coverage.

## Pre-deploy smoke pass (Playwright MCP)

Before suggesting `git push` for any change that touches a **critical flow** — workout logging, set toggle, rest timer, exercise timer, set-edit view, drag-reorder, login, schema migration, or any mutating Server Action — run a manual smoke pass via the local Playwright MCP server. `pnpm verify` and Vitest don't render UI; the bugs that bite real users (timer not reaching 00:00, click handler racing the rest timer, JS error on a route, broken modal close) only surface in a real browser. This protocol catches them.

**Skip if:** the change is doc-only (CLAUDE.md, BACKLOG.md, comments), test-only, dependency bump with no code touch, or a `chore:` purely about formatting / lint silencing. Say "skipping smoke — change is X" so the skip is visible.

**Prereqs (verify before starting):**
- Dev server reachable at `http://localhost:3000`. If not, ask the user to run `./scripts/dev.sh` first; do not start it autonomously.
- `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` — the test-account credentials live in `.env.local` (gitignored) under those keys. Read them from there (e.g. `set -a; . ./.env.local; set +a`) rather than asking the user. Only ask if `.env.local` is absent or the keys are missing.

**Tools:** `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`, `browser_wait_for`, `browser_take_screenshot`, `browser_console_messages`. Save any failure screenshot to `.playwright-mcp/<flow>-fail.png` (folder is gitignored).

**Protocol — walk every step in order. On any failure, stop, screenshot, report, do NOT push:**

1. **Reachability** — `browser_navigate` to `http://localhost:3000`. Expect a redirect to `/login` (unauthenticated). Confirm the login form is visible. Capture `browser_console_messages`; any `error` level entry fails this step.
2. **Login** — fill email + password from env vars, submit. Confirm landing on `/` with the "LogEveryLift" header visible.
3. **Today's workout** — find the `Start Today's Workout` link or equivalent CTA. If absent (e.g. no active program), note it and skip steps 4–6.
4. **Strength set logging** — open the first exercise; tap the `w-7 h-7 rounded-full` toggle on the first set. Confirm the toggle gains `bg-primary` and a `REST mm:ss` countdown appears. Tap again to un-log (idempotent).
5. **Timed set countdown** — find an exercise whose set summary shows `mm:ss` without `kg`. If none, skip with a note. Open the first set's edit view, override duration to the `15s` preset, save. Back on the set list, tap play. Within 20 seconds, assert `00:00` is visible (this is the timer-completion bug class). Confirm the set then shows as logged.
6. **SetEditView notes** — tap a completed set to reopen the edit view. Confirm the notes textarea renders. Type a short note, save. Reopen and confirm the note persisted.
7. **History page** — navigate to `/history`. Confirm at least one session row OR the empty-state copy. Confirm the search filter input is present. No console errors.
8. **Metrics page** — navigate to `/more/metrics`. Confirm at least one section heading (e.g. "Volume", "This Week · Volume vs Target", "Personal Records"). No console errors.
9. **PR feed** — navigate to `/more/prs`. Confirm PR rows OR the empty-state. No console errors.

After all 9 pass, report `smoke ✓: 9/9 flows green` alongside the normal `pnpm verify` summary, then suggest the push. On any failure, report which step, what was expected, what was observed, and the screenshot path — the user decides whether to push anyway.

**In-container commands:**
```bash
docker-compose exec app pnpm lint          # ESLint
docker-compose exec app pnpm build         # Production build check
docker-compose exec app pnpm db:push       # Push schema changes to DB
docker-compose exec app pnpm db:seed       # Seed database
docker-compose exec app pnpm db:studio     # Drizzle Studio GUI
```

## Database migrations

Migration files in `drizzle/` are committed to git and **must never be regenerated at Docker build time**. The Dockerfile does not run `pnpm db:generate`.

**Workflow when changing the schema:**
1. Edit files in `src/db/schema/`
2. Run `pnpm db:generate` — answer the interactive prompts carefully (create vs rename)
3. Commit the generated `drizzle/*.sql` file **and** the updated `drizzle/meta/` snapshot in the same commit as the schema change
4. Apply locally: `docker-compose exec app pnpm db:migrate` (or `pnpm db:push` for quick dev iteration — but **never** ship `db:push`-only changes; prod doesn't run it)
5. Push — GitHub Action builds, ArgoCD deploys, the entrypoint runs `db:migrate` against prod which executes the new SQL

`pnpm db:generate` is intentionally NOT run by `dev.sh` — it requires human judgment on interactive prompts and must not be automated.

**Never ship a schema TS change without the matching `drizzle/<N>_*.sql` file.** Prod's `db:migrate` only runs committed SQL — a missing migration means prod's DB stays on the old schema while the deployed code references the new one, and queries crash at runtime (`column "X" does not exist`). The pre-push lefthook (`scripts/check-schema-migrations.sh`) blocks pushes that change `src/db/schema/` without adding a migration file in the same push range. If you genuinely have a type-only schema refactor that needs no migration, bypass with `git push --no-verify` (rare).

**Critical rules:**
- Never add `pnpm db:generate` back to the Dockerfile — it caused non-interactive prompt failures and generated non-idempotent SQL in CI
- `drizzle/` must not be in `.dockerignore` — the committed files must be copied into the image
- All `CREATE TYPE` statements in migration SQL must use a DO block to be idempotent:
  ```sql
  DO $$ BEGIN
    CREATE TYPE "public"."my_type" AS ENUM(...);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  ```
  See `drizzle/0000_quick_rhodey.sql` for the reference pattern.
- The production Docker entrypoint runs migrations on every boot, then seeds **only when `SEED_ON_BOOT=true`**. Seed is destructive on a populated DB — do not enable it in normal prod deploys. Use it once on a fresh environment.

## Server Action stability across deploys

Production must set `NEXT_PRIVATE_SERVER_ACTIONS_ENCRYPTION_KEY` to a stable 32-byte base64 value (`openssl rand -base64 32`). Without it, Next.js generates a fresh key per build, so action IDs are randomized on every deploy — PWA users with cached client bundles then call action IDs the new server doesn't recognize and see `Failed to find Server Action`. Those calls feed into the offline-replay queue, which retries 5× and drops them. Net effect: **silent data loss for any user mid-workout when a deploy lands**.

Set the secret once in the k8s/ArgoCD secret store and never rotate it. The boot-time `env.ts` warns if it's missing in production. Client-side, `src/lib/utils/stale-bundle.ts` detects the specific error and forces a Service Worker update + page reload instead of dropping the write — but the stable key is the only thing that prevents the failure mode in the first place.

## Architecture

**Mobile-first PWA** targeting a native iOS feel. Next.js 16 App Router with React Server Components, PostgreSQL + Drizzle ORM, Zod validation, Tailwind CSS 4 + shadcn/ui.

### Data flow rules

- **Server Components** do all data fetching — never fetch in Client Components unless required for interactivity
- **Server Actions** (`src/lib/actions/`) handle all mutations — no REST CRUD routes
- Every Server Action must validate input with a **Zod schema** before touching the database
- Types are **inferred from Drizzle schema** — never define them manually:
  ```ts
  type ProgramSet = typeof programSets.$inferSelect;
  ```
- ActionResult<T> is the standard return type for Server Actions

### Server Actions — canonical template

Copy from this template when adding a new action. Do not copy from a random existing action — many predate the auth helpers and the safe pattern is the one below.

```ts
"use server";

import { db } from "@/db";
import {
  ForbiddenError,
  assertOwner,
  requireAdmin,
  requireSession,
} from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const myActionSchema = z.object({ id: z.number(), name: z.string().min(1) });

export async function myAction(
  data: unknown,
): Promise<ActionResult<MyType>> {
  const auth = await requireSession();              // or requireAdmin() for admin-only
  const parsed = myActionSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const [existing] = await db
      .select({ userId: things.userId })
      .from(things)
      .where(eq(things.id, parsed.data.id));
    assertOwner(existing, auth.user.id);            // throws if missing or not owned

    const [row] = await db.update(things).set({ /* ... */ }).returning();
    revalidatePath("/some/path");
    return { success: true, data: row };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[myAction] failed", e);
    return { success: false, error: "Failed to update" };
  }
}
```

### Safety rules for AI-assisted changes

- Every Server Action starts with `requireSession()` or `requireAdmin()`. No exceptions.
- Every read or write of user-owned data filters by `userId` in the `WHERE` clause **or** runs through `assertOwner()`. The demo user shares tables with real users — a missing `userId` filter is a data leak.
- **Never accept `userId` as a parameter on a Server Action.** Always read it from the session inside the action (`auth.user.id`). A `userId` parameter lets callers query other users' data — even when current call sites pass the right value, the function signature invites the bug.
- Mutations that touch another user's data (admin actions, friend invites) require `requireAdmin()` *or* an explicit relationship check — never assume.
- Server Actions that use `requireAdmin()` or `assertOwner()` must wrap the body in `try/catch` and convert `ForbiddenError` to an ActionResult error (see template). Otherwise the throw becomes a generic 500 to the client.
- `console.error` in Server Actions: always tag with the action name in brackets, e.g. `console.error("[myAction] not_found", { id })`. This makes container logs greppable. Never log secrets, raw user input, or full user records — log IDs and short tags only.
- When adding a new action, copy from the template above, not from a random existing action.

### Environment variables

- Read env vars via `import { env } from "@/lib/env"` — never `process.env` in app code (`src/`). The exception is the `NEXT_RUNTIME` branch in `instrumentation.ts`, which Next.js sets and isn't user config.
- `env.ts` validates with Zod at import time. Adding a new env var: extend the schema in `src/lib/env.ts` and `.env.example`. The app will refuse to boot if a required var is missing.
- During `next build` env validation is skipped (`NEXT_PHASE === "phase-production-build"`) since prod secrets aren't available at build time. Validation runs at startup instead.
- CLI scripts in `scripts/` may read `process.env` directly — they aren't part of the app boot path.

### Directory layout

```
src/
├── app/              # Next.js routes and layouts only
├── components/
│   ├── features/     # Feature-specific Client Components (interactivity)
│   └── ui/           # shadcn/ui base components
├── contexts/         # React Contexts (e.g. WorkoutSessionContext)
├── db/
│   ├── index.ts      # Drizzle client (PostgreSQL pool)
│   └── schema/       # Schema definitions — single source of truth for types
├── lib/
│   ├── actions/      # Server Actions (one file per domain)
│   ├── utils/        # Pure utility functions (format, set-mapping)
│   └── validators/   # Zod schemas (colocated with actions)
├── __tests__/        # Vitest unit tests
└── types/            # Shared TypeScript types
```

### Key patterns

- `WorkoutSessionContext` holds active session state for Client Components
- `src/lib/utils/set-mapping.ts` (`toFlatItems`, `computeMapping`) handles drag-reorder logic for sets
- `src/lib/utils/format.ts` (`buildSetSummary`, `setToken`, `restToken`, `formatTime`) — shared formatters used across components
- Drag & drop via `@dnd-kit`
- `revalidatePath()` is called after mutations to refresh Server Component data

### UI rules

- Minimum **44×44px** touch targets
- Use `:active` for tap feedback, not `:hover`
- Primary actions go in pinned bottom bars; destructive actions at the bottom of the screen
- Fixed headers and bottom navigation for iOS native feel

### Code quality

- **Reuse before adding** — check `src/lib/utils/` and `src/components/` before writing new utilities or components
- **No dead code** — if a button has no `onClick`, implement or remove it
- **No premature abstractions** — only extract a helper when it's used in 2+ places
