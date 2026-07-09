# Testing Guide

Full reference for verifying this app — from fast unit tests to interactive MCP browser sessions.

---

## Quick reference

| Check | Command | Speed |
|-------|---------|-------|
| Unit tests | `pnpm test` | < 2s |
| Watch mode | `pnpm test:watch` | live |
| Single file | `pnpm test src/__tests__/progressive-suggestions.test.ts` | < 1s |
| Single test | `pnpm test -t "deload"` | < 1s |
| TypeScript | `docker-compose exec app pnpm exec tsc --noEmit` | ~15s |
| Lint | `docker-compose exec app pnpm lint` | ~10s |
| Build check | `docker-compose exec app pnpm build` | ~60s |
| Start dev | `./scripts/dev.sh` | ~30s |

---

## 1 — Unit tests (Vitest)

All pure logic lives in `src/__tests__/`. Run without Docker.

```bash
pnpm test                                                   # all 210 tests
pnpm test src/__tests__/progressive-suggestions.test.ts    # progression logic
pnpm test src/__tests__/format.test.ts                      # formatters
pnpm test src/__tests__/set-mapping.test.ts                 # drag-reorder logic
pnpm test src/__tests__/validators.test.ts                  # Zod schemas
pnpm test src/__tests__/training-cycle-validators.test.ts   # cycle validators
```

### What is covered

| File | Covers |
|------|--------|
| `progressive-suggestions.test.ts` | `buildSuggestion`, deload, retry, RPE gate, bodyweight fallback, time/distance confidence, readiness modulation |
| `format.test.ts` | `formatTime`, `buildSetSummary`, `setToken`, `restToken` |
| `set-mapping.test.ts` | `toFlatItems`, `computeMapping` — drag-and-drop reorder invariants |
| `validators.test.ts` | Zod input schemas for server actions |
| `training-cycle-validators.test.ts` | Cycle duration and week validation |

### Adding a regression test

When you find a bug in `progression.ts`, add a failing test first:

```ts
// src/__tests__/progressive-suggestions.test.ts
it("reproduces the bug", () => {
  const rows = [makeRow({ ... })];
  const result = buildSuggestion(rows, makePs({ progressionMode: "weight" }), null);
  expect(result?.reason).toBe("held"); // was wrong before fix
});
```

---

## 2 — Static analysis

```bash
# TypeScript (must be run inside container)
docker-compose exec app pnpm exec tsc --noEmit

# ESLint
docker-compose exec app pnpm lint

# Production build (catches server/client boundary errors Next.js catches at build time)
docker-compose exec app pnpm build
```

TypeScript errors Surface missing fields, wrong types in server actions, and Server/Client Component boundary issues that unit tests won't catch.

---

## 3 — Database commands

```bash
docker-compose exec app pnpm db:push          # apply schema changes
docker-compose exec app pnpm db:seed          # seed with realistic data
docker-compose exec app pnpm db:seed-fake     # seed with faker data (many sessions)
docker-compose exec app pnpm db:studio        # Drizzle Studio at localhost:4983
docker-compose exec app pnpm db:diagnose      # diagnose schema drift
```

Use `db:seed-fake` before MCP browser sessions to have realistic history for progression suggestions and insight banners.

---

## 4 — MCP browser testing (Playwright)

This is the primary way to catch integration bugs — UI state, server action errors, navigation, rest timers, and suggestion display.

### Prerequisites

1. Dev server running: `./scripts/dev.sh`
2. App seeded with data: `docker-compose exec app pnpm db:seed`
3. A Claude Code session with the Playwright MCP tools available

### Screenshot convention

Always save screenshots to `.playwright-mcp/<name>.png` (folder is gitignored):

```
mcp__playwright__browser_take_screenshot → path: ".playwright-mcp/login.png"
```

### MCP tool reference

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree (find selectors without screenshots) |
| `browser_click` | Tap a button or link |
| `browser_type` | Type into a focused input |
| `browser_fill_form` | Fill multiple fields at once |
| `browser_press_key` | Keyboard events (Enter, Tab, Escape) |
| `browser_wait_for` | Wait for element / network idle |
| `browser_take_screenshot` | Visual screenshot |
| `browser_console_messages` | Catch JS errors and console logs |
| `browser_network_requests` | Inspect fetch/XHR calls and status codes |
| `browser_evaluate` | Run arbitrary JS in the page |

---

## 5 — MCP test scenarios

Run these end-to-end. Each section is independent — reset state between sections using `db:seed`.

---

### 5.1 Authentication

```
navigate → http://localhost:3000
expect: redirect to /login
```

**Login flow**
```
navigate → http://localhost:3000/login
fill: email = morten03nordbye@gmail.com, password = <your password>
click: Sign in button
expect: redirect to / (home dashboard)
screenshot → .playwright-mcp/auth-logged-in.png
```

**Signup form validation**
```
navigate → http://localhost:3000/signup
click: Sign up without filling fields
expect: validation errors visible, no redirect
```

---

### 5.2 Program setup

```
navigate → http://localhost:3000/programs
screenshot → .playwright-mcp/programs-list.png
```

**Create a new program**
```
click: New Program (or "+" button)
type: program name "MCP Test Program"
click: Save / Create
expect: redirect to program detail page
screenshot → .playwright-mcp/program-created.png
```

**Add a strength exercise (bench press)**
```
navigate → /programs/<id>/add-exercise
search for: "Bench Press"
click: Bench Press
expect: exercise added to program, set list visible
```

**Add a set with weight + reps**
```
navigate → /programs/<id>/exercises/<programExerciseId>/sets/new
fill: targetReps = 8, weightKg = 80
click: Save
expect: set appears in list showing "8 x 80kg"
```

**Add a timed exercise (Plank)**
```
navigate → /programs/<id>/add-exercise
search: "Plank"
add exercise → navigate to sets/new
fill: durationSeconds = 60 (1:00)
save
expect: set shows "01:00"
```

**Add a running exercise**
```
add exercise: "Running" or "Treadmill"
navigate to sets/new
fill: distanceMeters = 5000, durationSeconds = 1800
save
expect: set shows "5.0 km · 30:00"
```

**Configure progression mode**
```
navigate → /programs/<id>/exercises/<programExerciseId>
look for: progression mode picker
change: "Weight" → "Smart"
verify: mode change is persisted (reload page)
```

---

### 5.3 Active workout — strength flow

```
navigate → /programs/<id>/workout
expect: insight banner visible (first_session or on_track)
expect: exercise list rendered
screenshot → .playwright-mcp/workout-start.png
```

**Complete a set**
```
tap: play (▶) button on Set 1
expect: circle fills with checkmark
expect: rest timer starts below the next set
expect: completed set fades to 50% opacity
screenshot → .playwright-mcp/set-completed.png
check console: no JS errors
```

**PR celebration**
```
(need a seeded session with lower previous weight)
complete a set at a higher weight
expect: 🏆 confetti animation appears
expect: "Personal Record" overlay with weight or 1RM value
screenshot → .playwright-mcp/pr-celebration.png
```

**Suggestion pills — weight progression**
```
(seed 2+ sessions where user completed sets at RPE ≤ 7)
navigate to workout
expect: "↑ 82.5kg" pill below the set row
tap the pill
expect: set row updates to show "8 x 82.5kg"
complete the set
verify: set is logged at 82.5kg, not 80kg
network_requests: confirm POST to logWorkoutSet contains weightKg=82.5
```

**Suggestion pills — deload**
```
(seed 3+ consecutive sessions where actualReps < targetReps)
navigate to workout
expect: "↓ 72kg — deload" pill (orange)
tap it
expect: set updates to 72kg
```

**Undo completed set**
```
tap checkmark on a completed set
expect: set reverts to uncompleted state (play button returns)
expect: rest timer clears
```

**Catch-up logging**
```
skip Set 1 (don't tap play)
tap play on Set 2
expect: Set 1 is auto-completed (catch-up)
check network_requests: two POST calls to logWorkoutSet (one for Set 1 with rest=0, one for Set 2)
```

---

### 5.4 Active workout — timed exercise (Plank)

```
navigate to workout containing a plank set
tap: play button
expect: full-screen timer overlay appears
expect: countdown starts (60 → 59 → 58...)
screenshot → .playwright-mcp/exercise-timer.png
```

**Let timer run to 0**
```
(use browser_evaluate to fast-forward: document.dispatchEvent(...) or just wait)
expect: set auto-completes
expect: logged durationSeconds = target (60)
```

**Tap Done early (e.g. at 40s remaining)**
```
tap: Done button while 40s remain
expect: set completes
network_requests: confirm durationSeconds = 20 (60 - 40), not 60
```

**Tap Cancel**
```
tap: Cancel
expect: timer closes, set remains uncompleted
```

---

### 5.5 Active workout — running

```
navigate to workout with running exercise
tap: play button
expect: LogRunModal opens (not timer, not instant complete)
screenshot → .playwright-mcp/log-run-modal.png
```

**Pre-filled from suggestion**
```
first tap the "↑ 5.5km" distance suggestion pill
then tap play
expect: LogRunModal pre-fills distance as 5.5km (not 5.0km from program)
```

**Complete a run**
```
in LogRunModal:
  set distance to 5.0 km
  set duration to 28:00
  set RPE to 7
  set incline to 2%
confirm
expect: set marked complete
network_requests: distanceMeters=5000, durationSeconds=1680, inclinePercent=2, rpe=7
```

---

### 5.6 Finish workout

```
navigate to /programs/<id>/workout
complete all sets
tap: Finish Workout button
expect: session saved, redirect to /history/<sessionId>
expect: session detail shows all exercises, sets, weights
screenshot → .playwright-mcp/session-detail.png
```

**Session feeling**
```
on finish page: select feeling (Tired / OK / Good / Awesome)
submit
verify in DB: workoutSessions.feeling = selected value
docker-compose exec app pnpm db:studio (check manually)
```

---

### 5.7 Progression suggestions — full cycle

This is the most important flow to test.

**Setup (run in db:studio or seed script):**
- Create program with Bench Press
- Insert 2 completed sessions with { actualReps=8, targetReps=8, weightKg=80, rpe=7 }
- progressionMode = "weight", overloadIncrementKg = null (adaptive)

```
navigate to /programs/<id>/workout
expect: "↑ 82.5kg" suggestion pill (REQUIRED_HITS=2 met, adaptive increment = 2.5kg)
tap pill
expect: set shows 82.5kg
complete set
finish workout
navigate back to workout (new session)
expect: suggestion is now "↑ 85kg" (progressed again from 82.5)
```

**Deload cycle:**
```
seed 3 sessions with { actualReps=5, targetReps=8, rpe=9 } at 85kg
navigate to workout
expect: "↓ 76.5kg — deload" pill
tap deload, complete set
finish workout
navigate to workout again
expect: NO retry pill suggesting 85kg
expect: suggestion holds at 76.5kg until confidence rebuilds
```

**Bodyweight exercise:**
```
add pull-ups (weightKg=0, progressionMode="weight", overloadIncrementReps=1)
seed 2 sessions with { actualReps=8, targetReps=8, weightKg=0, rpe=6 }
navigate to workout
expect: "↑ 9 reps" pill (NOT "↑ 2.5kg")
```

**Timed exercise (RPE gate):**
```
add plank (progressionMode="time", durationSeconds=60)
seed 2 sessions with { durationSeconds=60, rpe=9 }
navigate to workout
expect: NO "↑ 70s duration" pill (RPE 9 does not count as confident)
change to 2 sessions with rpe=7
navigate to workout
expect: "↑ 70s duration" pill appears
```

---

### 5.8 History

```
navigate → /history
expect: list of completed sessions, newest first
click a session
expect: session detail with exercises grouped, sets showing actual weight/reps/RPE
screenshot → .playwright-mcp/history-detail.png
```

**Exercise PRs**
```
navigate to history detail for a session where a PR was hit
expect: 🏆 PR badge visible on the relevant set
```

---

### 5.9 Settings and profile

```
navigate → /settings
fill: experience level = Intermediate
fill: goal = Strength
save
navigate to a workout
expect: adaptive increment uses 2.5kg baseline (not beginner 5kg)
```

---

### 5.10 Navigation and layout

```
tap each bottom nav tab: Home, Programs, History, More
expect: correct page loads, no crashes
screenshot → .playwright-mcp/nav-home.png
```

**iOS safe area**
```
browser_resize → width: 390, height: 844 (iPhone 14)
navigate to /programs/<id>/workout
expect: content not cut off by bottom nav bar
expect: complete button reachable without scrolling over nav
screenshot → .playwright-mcp/mobile-workout.png
```

**Keyboard on inputs**
```
navigate to /programs/<id>/exercises/<id>/sets/<id>
tap weight input
expect: number keyboard appears, value editable
type: 85
blur / press Done
expect: weight field shows 85
```

---

### 5.11 Console and network health checks

Run these on every major page:

```
browser_console_messages
→ expect: no errors (ignore "DevTools listening" and manifest 404s)

browser_network_requests
→ expect: no 4xx or 5xx responses
→ server actions are POST to the same origin — verify 200 OK
```

Key server action endpoints to watch:
- `POST /programs/[id]/workout` — `logWorkoutSet`
- `POST /programs/[id]/exercises/[id]` — `updateProgramSet`
- `POST /programs/page` — create/delete programs

---

### 5.12 Error states

**Invalid program ID**
```
navigate → /programs/999999/workout
expect: 404 page or graceful error (not unhandled exception)
```

**Network failure simulation**
```
browser_evaluate: window.fetch = () => Promise.reject(new Error("offline"))
tap: play button on a set
expect: no crash, UI reverts or shows error state
```

**Empty program**
```
create a program with no exercises
navigate to workout
expect: empty state message, not a blank/broken UI
```

---

## 6 — Progressive overload algorithm — manual verification

After running the app for several sessions, verify the suggestion data against what `buildSuggestion` would compute.

### Fetch suggestion data directly

```bash
# In Drizzle Studio (localhost:4983 while dev is running):
# Check workoutSets for a given exerciseId — confirm actualReps, weightKg, rpe
# Check programExercises.progressionMode and overloadIncrementKg
```

### Compute expected suggestion manually

```ts
// Run in node REPL or test file:
import { buildSuggestion } from "@/lib/utils/progression";

const rows = [
  { exerciseId: 1, setNumber: 1, actualReps: 8, targetReps: 8,
    weightKg: "82.50", durationSeconds: null, feeling: "Good",
    date: "2026-04-17", rpe: 7 },
  { exerciseId: 1, setNumber: 1, actualReps: 8, targetReps: 8,
    weightKg: "80.00", durationSeconds: null, feeling: "Good",
    date: "2026-04-10", rpe: 6 },
];
const ps = {
  programSetId: 1, setNumber: 1, targetReps: 8,
  durationSeconds: null, exerciseId: 1,
  overloadIncrementKg: null, overloadIncrementReps: 0,
  progressionMode: "weight", movementPattern: "push",
};
console.log(buildSuggestion(rows, ps, { experienceLevel: "intermediate", goal: "strength" }, 4));
// Expected: { reason: "progressed", suggestedWeightKg: 85 }
```

---

## 7 — Bug reporting checklist

When you find a bug, collect:

- [ ] Screenshot (`.playwright-mcp/<name>.png`)
- [ ] Console errors (`browser_console_messages`)
- [ ] Network requests showing wrong payload or status (`browser_network_requests`)
- [ ] Exact navigation path to reproduce
- [ ] Seed state (what sessions/data was in DB)
- [ ] Expected vs. actual behaviour

Then write a unit test in `src/__tests__/progressive-suggestions.test.ts` (for logic bugs) or a repro note (for UI bugs) before fixing.

---

## 8 — CI / automated checks

The GitHub Action runs on every push:
- `pnpm build` — TypeScript + Next.js build
- Docker image build
- ArgoCD deploys and runs `db:migrate` automatically

There is no automated E2E CI yet. The MCP browser session above is the manual equivalent.
