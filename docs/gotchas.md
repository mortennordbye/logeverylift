# Gotchas

The traps that cost real time. Add to this whenever something bites you that wasn't obvious.

## Turbopack incremental-cache corruption (dev)

**Symptom:** the dev server shows phantom build errors — truncated source (`} ca` instead of `} catch`), "Export X doesn't exist", or "Unexpected token `<eof>`" — at exactly the lines you just edited, even though `pnpm typecheck` is **green**. The error often *changes* between reloads.

**Cause:** editing a schema file and/or several client+server files in one go corrupts Turbopack's incremental cache; it serves stale/partial compiled modules.

**Fix:** clear the cache and restart the container — a page reload is **not** enough.
```bash
docker-compose stop app && rm -rf .next && docker-compose start app
```
Touching a single file (re-save) sometimes only partially recompiles. When in doubt, full clear. `pnpm verify` passing while the browser 404s/errors is the tell that it's the cache, not your code.

## Local DB migrations

The dev DB was built with `db:push`, so `db:migrate` from `0000` fails (non-idempotent baseline). To apply a new column locally:
- `docker-compose exec app pnpm db:push` is **interactive** (arrow-key prompt) — doesn't work over a non-TTY exec.
- There's no `psql` in the *app* container, but the **`postgres` container has it** — simplest path is to pipe the committed migration's idempotent SQL straight in:
  ```bash
  docker-compose exec -T postgres psql -U postgres -d logeverylift_db -v ON_ERROR_STOP=1 <<'SQL'
  ALTER TABLE "foo" ADD COLUMN IF NOT EXISTS "bar" integer;
  CREATE TABLE IF NOT EXISTS "baz" (...);
  SQL
  ```
  (Make `ADD CONSTRAINT` idempotent with a `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block.)
- **Alternative** (app container, no psql): run the `ALTER` through the app's pg client:
  ```bash
  docker-compose exec -T app node -e '
    const {Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});
    p.query("ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar integer").then(()=>p.end());'
  ```
The committed `drizzle/*.sql` is still the source of truth for prod (`db:migrate` runs it on boot). Full workflow: [`CLAUDE.md`](../CLAUDE.md#database-migrations).

## Settings live in two stores

User-facing "settings" are split, and picking the wrong store silently fails:
- **Client-only prefs → localStorage** via `theme-provider.tsx` (`useTheme`): theme, accentColor, weeklyGoal, defaultIncrementKg/Reps, uiScale. `SettingsClient.tsx` reads/writes them through the context; the server never sees them.
- **Server-read prefs → a `users` DB column**: `showActivityToFriends`, `missedWorkoutsEnabled`, etc. — anything a Server Component or Server Action must honour.

**The trap:** the home page (`src/app/page.tsx`) and `getActiveCycleForUser` are server-side. A setting that gates server-rendered output (e.g. the missed-workout off-switch) **must** be a DB column. Add it to `theme-provider`/localStorage like the other settings and the server never sees it — the toggle does nothing.

**Recipe for a server-read setting:** `users` column (+ migration) → a Zod-validated Server Action that reads `auth.user.id` (`setMissedWorkoutsEnabled` in `training-cycles.ts` is the reference) → make `settings/page.tsx` a Server Component that fetches the flag and passes it as a prop into the client `SettingsClient` → render a toggle that calls the action optimistically. The "Missed workout reminders" switch is the worked example.

## Fail-safes for deleted entities

A program deleted out from under a persisted pointer (the bottom-nav "Workout" tab caches `lastWorkoutPath`) used to dead-end on a bare 404. Three layers now prevent that:
1. `src/app/programs/[id]/workout/page.tsx` — on `"Program not found"` it `redirect("/?staleWorkout=1")` instead of `notFound()` (a *transient* DB error still 404s, so a live workout isn't wiped).
2. `src/components/features/StaleWorkoutHealer.tsx` (mounted in `layout.tsx`) — catches `?staleWorkout=1`, calls `clearActiveWorkout()`, strips the flag.
3. `src/app/not-found.tsx` — a friendly universal 404 with "Back to Home" / "View Programs", so every other 404 has an escape.

If you add a route that the app's own nav/persistence can point at, give it the same "redirect to a safe parent" treatment rather than a bare `notFound()`.

## E2E / smoke credentials

`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` live in `.env.local` (gitignored). Source it (`set -a; . ./.env.local; set +a`) before the Playwright smoke pass — don't prompt for them.

## Server Action results: `success:false` conflates not-found and errors

`getProgramWithExercises` returns `{success:false, error:"Program not found"}` for genuine not-found/not-owned, but `{success:false, error:String(err)}` for a transient DB error. When you branch on failure (e.g. to redirect/heal vs preserve state), check the **message** — don't treat all failures the same.

## Ownership / the demo user

System exercises have `userId IS NULL`; the demo user shares tables with real users. **A read/write of user-owned data without a `userId` filter (or `assertOwner`) is a data leak.** Two browser sessions (e.g. Playwright vs the iOS simulator) may be different users — a program one created 404s for the other by design.
