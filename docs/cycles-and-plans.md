# Training cycles & the triathlon plan

A **cycle** is a periodized weekly schedule. A **plan generator** builds one (cycle + slots + programs + sets) in a transaction.

## Cycle model

- `training_cycles` + `training_cycle_slots` (`src/db/schema/training-cycles.ts`). Each slot is a day-of-week (or rotation position) → a `programId` (null = rest day).
- Position logic for rotation cycles: `src/lib/utils/cycle-position.ts` (`walkRotation`).
- Read/display: `getActiveCycleForUser`, `getCyclePeriodization` (`src/lib/actions/training-cycles.ts`).

## Missed workouts, catch-up & failsafe

The home screen (`src/app/page.tsx`) surfaces scheduled workouts you skipped. All of it derives from `missedSlots`, computed in `getActiveCycleForUser`:

- **Detection.** Day-of-week mode: `findDayOfWeekMissed` flags the last 7 days where an active slot had no completed session. Rotation mode: `resolveRotation` flags slots whose expected day passed un-done ("X days overdue" badge). Both are pure functions in `cycle-position.ts`.
- **Catch-up (the subtle one).** The "Make up" link carries the missed day: `/programs/{id}/workout?makeup=YYYY-MM-DD`. `WorkoutSessionInitializer` reads the param and stamps `workout_sessions.intendedDate` on the new session. `getActiveCycleForUser` then treats a slot as satisfied if a completed session matches the slot date **OR** its `intendedDate`. **Why it matters:** a make-up is logged with today's `date`, so without `intendedDate` the original missed day would never clear and would nag until it aged out of the 7-day window. (Only the day-of-week branch consumes `intendedDate`; rotation already repeats the slot.)
- **Decline.** "Decline" next to "Make up" (`DeclineMakeupButton` → `dismissMissedWorkout`) writes a `dismissed_makeups` row (`userId` + missed `date`); `getActiveCycleForUser` filters those out. Permanent, keyed by date.
- **Off-switch.** `users.missedWorkoutsEnabled` (Settings → Workout). When false, `getActiveCycleForUser` returns an empty `missedSlots`, hiding **both** the day-of-week "Missed this week" card and the rotation overdue badge. It's a DB column, not localStorage, because the home page reads it server-side — see [gotchas.md](gotchas.md#settings-live-in-two-stores).
- **10-hour failsafe.** `closeStaleOpenSessions` (`workout-sessions.ts`), called on home load, auto-completes any session left open >10h (forgot to tap Finish, or tab evicted mid-workout). Complements the existing 1h orphan-sweep in `createWorkoutSession`, which only fires when the *next* workout starts — so a never-followed-up session would otherwise stay open forever.

## The triathlon plan generator

Two files:
- **Blueprint** (pure): `src/lib/utils/triathlon-plan.ts` → `buildTriathlonPlan({ weeks, restDays, goal, level })` returns a `PlanBlueprint` (days → exercises → sets). Unit-tested in `src/__tests__/triathlon-plan.test.ts`.
- **Persistence** (DB): `src/lib/actions/triathlon-plan.ts` → `generateTriathlonPlan` ensures the referenced exercises exist (`ENSURED_EXERCISES`), resolves names→ids, then inserts cycle + slots + programs + program_exercises + program_sets. UI: `src/components/features/TriathlonPlanForm.tsx` (`/cycles/triathlon`).

### Current week layout (2 strength + endurance)

| Day | Session |
|---|---|
| 1 Mon | **Workout A** — Squat & Horizontal (Front Squat, DB Bench, Pendlay Row, Bulgarian Split Squat, Seated Calf Raise, Pallof Press) |
| 2 Tue | Run — Threshold Intervals |
| 3 Wed | Bike — Endurance + Swim |
| 4 Thu | **Workout B** — Hinge & Vertical (RDL, Weighted Pull-up, DB Shoulder Press, Seated Leg Curl, Face Pull, Ab Wheel Rollout) |
| 5 Fri | Recovery Swim |
| 6 Sat | Long Run |
| 7 Sun | Long Bike + Brick Run |

Strength is a **flat, RIR-capped hypertrophy/maintenance block**: same target reps across working sets, no phase re-prescription (no `sessionRole: "strength"`), `weightKg: 0` (athlete loads to the target reps at the prescribed RIR), `weight` mode (the spec's `smart` is mapped to `weight` so reps stay static). Per-exercise type + per-set `targetRir` are set by the generator. Pallof Press is a **timed isometric hold** (`isTimed`, `durationSeconds`).

**Rest days:** `restDays` is an array of 1–2 days (1=Mon…7=Sun); `TriathlonPlanForm` defaults to `[5, 6]` (Fri + Sat). Rest days do **not** simply blank whatever session sits there. Each session has an importance rank (most→least: long bike+brick on Sun, long run on Sat, the two strength days, bike+swim, run intervals, recovery swim); with N rest days the N least-important sessions drop, and any surviving session whose natural weekday became a rest day slides onto a freed training day. So the default Fri+Sat rest drops the recovery swim + run intervals, relocates the Saturday long run onto the freed Tuesday slot, and keeps the long bike+brick on Sunday. Because key sessions relocate rather than vanish, no rest-day choice can silently wipe a strength or long session — but if you change the day layout or the `importance` map in `buildTriathlonPlan`, re-check which sessions drop first.

### Endurance prescription

Sessions are built from structured segments (`sessionFrom`, `intervalRun`, `swimEndurance`, `steady`), not one distance blob. Polarized 80/20: only interval reps are Z4 (`targetHeartRateZone`, `sessionRole: "work"`), everything else easy Z2. `peakDistanceMeters` is the race-prep anchor; week-1 `distanceMeters` is scaled below it by the periodization curve. Peak volumes per athlete level in `PEAK_VOLUMES`.

## Periodization & adaptation — `src/lib/utils/periodization.ts`

- `periodizedLoad(week, totalWeeks, goal, deloadCadence)` → the volume curve (phase + multiplier); `phaseLayout`, `deloadCadenceForLevel`, taper/deload factors.
- `uncoupledAcwr(weeklyLoads)` — acute:chronic workload injury guardrail.
- `intervalPhaseRecipe`/`strengthPhaseRecipe` — phase-aware zone/rest (used by the *endurance* sessions; strength is now flat).
- **No-wearable adaptation:** `computeAdaptationFactor({ adherence, avgReadiness, avgRpe })` → a ±band (90–105%). Wired in `computeCycleAdaptation` (`training-cycles.ts`), which averages real `workout_sets.rpe` (now RIR-derived) over the last 7 days, then `syncPeriodizedTargets` rewrites the week's endurance targets. Idempotent per week via `lastSyncedWeek`.
- It's **algorithmic, not an LLM.** The separate LLM path (`ai-generate.ts` + `ai-prompt.ts`, Gemini/OpenRouter) generates one-off strength programs and does **not** consume the adaptation factor.

## Deferred (see `BACKLOG.md`)

Wearable-based autoregulation (Tier B), prescribe-target-RIR was shipped, laterality (unilateral/bilateral) dimension, and a precise per-exercise type backfill (the `0039` migration's movement-pattern heuristic over-tags isolation work as compound).
