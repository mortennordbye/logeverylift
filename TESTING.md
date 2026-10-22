# Testing

How this app is tested, and what a change has to come with. Written for whoever
changes the code next, person or agent.

The short version: **a change that could break a workout has to come with a test
that would have failed before the change.** Unit tests alone cannot carry that.
Most of what breaks a real workout happens where a pure function meets React
state, the database or the browser, and a suite that only tests pure functions
passes straight through those breaks.

---

## The four layers

| Layer | Runs | Where | Catches | Command |
|-------|------|-------|---------|---------|
| Unit | Node, no I/O | `src/__tests__/*.test.ts` | Logic in pure functions: progression, formatting, set mapping, payload building, queue retry rules | `pnpm test` |
| Component | jsdom + Testing Library | `src/__tests__/components/*.test.tsx` | React behaviour without a browser: timers, effects, providers, hydration order | `pnpm test` |
| Integration | Node + real Postgres | `src/__tests__/integration/*.test.ts` | Server Actions against real SQL: ownership, upsert keys, transactions, concurrency, migration data steps | `pnpm test:int` |
| End-to-end | Production build + WebKit and Chromium | `e2e/*.spec.ts` | Whole flows as a user does them: taps, drags, timers, reloads, offline | `make e2e` |

`pnpm verify` runs typecheck, lint, the doc-claims check, unit + component and
integration tests. CI runs all of that plus e2e on every PR, and the Docker
image is only built (so nothing deploys) when both pass.

---

## Which test a change needs

Pick the lowest layer that can fail for the bug you are guarding against. When
in doubt, go one higher.

| You changed | Add or update |
|-------------|---------------|
| A pure function in `src/lib/utils/` | Unit test |
| Logic inside a component (a handler that builds a payload, decides a state transition, merges overrides) | Move the logic into `src/lib/utils/` and unit-test it there; leave the component calling it |
| A timer, effect, context or provider (`src/contexts/`, `useEffect` with timers or storage) | Component test with fake timers |
| A Server Action, a query, a schema change or a migration | Integration test. A migration that rewrites existing rows also gets a test that runs its data step on legacy-shaped rows (see `migrations.test.ts`) |
| Anything in a critical flow: logging a set, the rest or exercise timer, editing a set, drag-reorder, finishing a workout, login | E2E spec, plus whichever of the above applies |
| A bug fix | A test that reproduces the bug, written and seen failing before the fix |

"Critical flow" is the list in `CLAUDE.md` under the smoke pass. If a flow has no
spec yet and you touch it, add one.

---

## Rules that apply to every layer

- **See it fail.** A new regression test is only proof once you have run it
  against the unfixed code and watched it fail. A test that passes either way
  guards nothing.
- **Assert the outcome, not the call.** "The row in `workout_sets` belongs to
  set A" beats "logWorkoutSet was called". The bugs that shipped had the right
  calls with the wrong keys.
- **No sleeps for correctness.** Wait for the condition: `expect.poll`,
  `waitForLiveSession`, `trackActions`, fake timers. A fixed wait is a race
  that is usually won.
- **No retries to make a test pass.** CI runs with `retries: 0`. A flaky test is
  either a test bug or an app bug; find out which. Two "flakes" this suite
  turned up were real bugs: the readiness sheet stalling, and the set editor
  cancelling its own write on iOS.
- **Every test sets up its own data.** Integration tests truncate before each
  test; e2e resets the e2e user before each spec. Never depend on order.

---

## Unit and component tests

Plain Vitest. Component tests opt into the browser-like environment with a
docblock on the first line:

```ts
// @vitest-environment jsdom
```

Mock Server Actions at the module boundary (`vi.mock("@/lib/actions/...")`),
never `@/db` from a component test. Use `vi.useFakeTimers()` for anything with a
countdown, a backoff or a debounce, and drive it with
`vi.advanceTimersByTimeAsync`. A component that re-renders on a clock should be
tested *with* a re-rendering parent: that is how the readiness auto-skip stall
was caught (`components/readiness-sheet.test.tsx`).

## Integration tests

```bash
pnpm test:int
```

Needs the compose Postgres up (`make dev`). The global setup creates
`logeverylift_int_test`, applies every committed migration (the same SQL prod
runs), and each test starts from empty tables.

Call the Server Action directly. Only two things are faked
(`src/__tests__/integration/setup.ts`): who is calling, via `asUser(id)`, and
Next's cache invalidation. Build data with the factories in `factories.ts`:

```ts
const user = await createUser();
asUser(user.id);
const { program, slots } = await createProgram(user.id, [{ exerciseId, sets: [{}, {}, {}] }]);
const session = await createSession(user.id, program.id);
const result = await logWorkoutSet({ sessionId: session.id, /* ... */ });
```

Always add a test that calls the action as a *different* user and checks it is
refused and nothing changed. The demo user shares tables with real users.

For concurrency, fire the calls with `Promise.all` and repeat a few rounds; a
race shows only sometimes (`workout-sets.test.ts`, "sets logged at once").

## End-to-end tests

```bash
make e2e                                   # everything, both engines
make e2e ARGS="e2e/drag-reorder.spec.ts"   # one file
make e2e ARGS="--project=webkit -g drag"   # one engine, by name
```

Needs only the compose Postgres. Playwright prepares `logeverylift_test`
(`scripts/e2e-prepare.ts`: create, migrate, seed, e2e user), builds the app,
and serves the standalone production build on port 3917
(`scripts/e2e-serve.sh`). It never reuses a running server, because one left
over from an interrupted run was built from older code. Projects: `webkit`
(iPhone 14 Pro) and `chromium` (Pixel 7).

Writing a spec:

- Import `test` and `expect` from `./fixtures/test`, never from
  `@playwright/test`. The fixture resets the e2e user's data before the spec
  (fixed-seed demo data from `scripts/lib/demo-data.ts`) and **fails the spec on
  any uncaught page exception**. The one exception it makes is WebKit's report
  of a request cancelled by a page load the spec itself started. A request the
  app cancels on its own still fails the spec, and so does an unhandled
  rejection. Do not widen the filter; fix the app or wait for its writes before
  navigating (`tapAndSave`, `trackActions`).
- Find elements by role and accessible name (`getByRole("button", { name: "Log set 1" })`),
  or by `data-testid` where there is no good name (`set-row`, `exercise-row`).
  Never by Tailwind classes. Adding an `aria-label` to an unlabeled button is
  usually the right fix and helps screen readers too.
- Navigate with the helpers in `e2e/helpers.ts`: `openWorkout`,
  `openFirstExercise`, `openTimedExercise`, `waitForLiveSession`. They handle
  the readiness sheet and WebKit's dropped taps.
- Wait for writes with `tapAndSave` (one tap) or `trackActions` (a drag or a
  multi-write flow) before reloading or querying. The app saves optimistically,
  and reloading too early cancels the write.
- Check what was written: `testDb()` from `./fixtures/reset` queries the test
  database directly. A drag spec that only looks at the screen passed while the
  logs were landing on the wrong sets.
- Drag with real pointer moves: press on the handle, move past dnd-kit's 8 px
  activation distance in steps, release over the target
  (`drag-reorder.spec.ts`).

When a spec fails, the trace is in `test-results/<spec>/trace.zip`
(`pnpm exec playwright show-trace <path>`); in CI, download the
`playwright-report` artifact.

---

## Manual checks

Automated tests do not replace a look at the real thing on a phone-sized screen.

- **Smoke pass before pushing a critical-flow change:** the Playwright MCP
  protocol in `CLAUDE.md`.
- **Exploratory checklist:** `UI_TESTS.md`, a screen-by-screen list of expected
  behaviour for a full manual run.
- **Real device:** gestures (the iOS edge swipe), haptics, notifications and
  backgrounding can only be checked on an iPhone.

## Test databases and safety

Everything that writes or wipes data on the tests' behalf goes through
`assertTestDatabase` (`scripts/lib/test-database.ts`), which refuses any
database not named `*_test`. URLs come from `scripts/lib/local-test-db.ts`:
`TEST_DATABASE_URL` / `E2E_DATABASE_URL` if set, the CI service in CI, otherwise
the port Docker reports for the compose Postgres. There is deliberately no
`localhost:5432` default: on a laptop that port can be a tunnel to a real
database.
