# Endurance in the app, and load without Garmin

Packages C6 and D1 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md), in one branch and one
PR (`feat/endurance-app-c6-d1`). Inputs: the audit (`docs/triathlon-coach-audit.md`, sections 3b
and 4, decisions D3, D9, D11, D13, D15, D18, T5, T6), the research
(`docs/research/endurance-training-reference.md`: "Race intensity sets the ceiling for training
load", "CTL ramp limits are conventions", "Plans become data"), `CLAUDE.md` (the rest and exercise
timers are critical flows), `TESTING.md`, and the merged briefs [`foundations.md`](foundations.md)
(units, time zone), [`revisions.md`](revisions.md), [`ai-coach.md`](ai-coach.md),
[`seasons.md`](seasons.md), [`athlete-profile.md`](athlete-profile.md) (thresholds) and
[`sessions.md`](sessions.md) (C2, dated sessions). Package C4 and C5 (structured workouts,
compliance, sick periods) is built in parallel on `feat/workouts-c4-c5`; its brief is
`docs/plans/workouts-and-compliance.md` on that branch. This brief builds on its API. Section 13
lists what depends on its final code.

Status: built, 2026-11-13, on `main` after C4 and C5 (PR #231). The findings describe `main` at
0eceb0b (after PR #230); every `file:line` in them was opened then. Section 13 records the check
against C4 and C5's merged code, and section 18 where the build differs from this brief.

## 0. Goal

After this PR, for a user with the endurance switch on:

1. **Today and week.** The home screen shows today's endurance sessions with their steps, total
   time and distance, and each target in the user's own numbers and units (watts, bpm, pace per km
   or mile, swim pace per 100 m or 100 yd). A new week view shows Monday to Sunday with each
   session, its state from C5, and totals per sport, planned against done.
2. **Guided player.** An indoor session (trainer, treadmill) runs step by step in the app: a step
   timer, the current and next target, a sound and a screen flash at each step change, pause, skip,
   extend, and the screen kept awake. It survives a reload, an app switch and the lock screen
   without losing time.
3. **Pool view.** A swim shows in large text, block by block, with an optional send-off clock.
4. **Per-step results.** After the player, or by hand for any done session with a workout, the user
   sees planned against done per step and can add RPE, an optional measured value and notes.
5. **Load without Garmin (D1).** Every completed session gets a load on one scale (100 = one hour
   at threshold): run pace load from the threshold pace, swim load from CSS, session RPE for the
   rest, and the existing session-RPE load for strength. Fitness, fatigue and form come from these
   loads when the user has no Garmin data. For a Garmin user, app sessions that Garmin did not
   record are added to the Garmin series, and a session never counts twice.
6. The assistant reads the load and the step results, and writes step results, over MCP.

**A lifter sees no change.** Every screen and tool in this PR needs the endurance switch. The
existing rest and exercise timers are not changed (section 3.1).

Out of scope: the step editor (open question 2, a follow-up PR), delivery to a watch (E3, D13
open), Garmin laps mapped to steps, Bluetooth trainer control (audit 3b: out of scope), the
training limits that use load (D2).

## 1. Findings in the code

### 1.1 The timers today (critical flow)

- The rest timer and the exercise timer both live inside `WorkoutSetsList`, as component state
  (`src/components/features/WorkoutSetsList.tsx:171-172`). Both count from an end timestamp, not
  from ticks: the rest countdown recomputes `Math.ceil((endMs - now) / 1000)` every second
  (`src/components/features/WorkoutSetsList.tsx:691-715`), and the exercise timer does the same
  from `endsAt` (`src/components/features/WorkoutSetsList.tsx:769-776`).
- Both resync when the app comes back, on `visibilitychange`, `pageshow` and `focus`, because
  iOS suspends the interval while the PWA is in the background
  (`src/components/features/WorkoutSetsList.tsx:717-752`, `:780-800`).
- The exercise timer holds "00:00" on screen for 600 ms before it completes the set, so the last
  frame the user sees is 00:00 (`src/components/features/WorkoutSetsList.tsx:758-767`). An e2e spec
  guards this (`e2e/exercise-timer.spec.ts:22`).
- Rest end times persist in localStorage under `restTimerEnds`
  (`src/contexts/workout-session-context.tsx:38`, written at
  `src/contexts/workout-session-context.tsx:217-229`). The exercise timer's `endsAt` does not
  persist, so a cold eviction during a timed set loses it. The BACKLOG entry "iOS backgrounding"
  records this gap (`BACKLOG.md:126`).
- The only cue at the end of a rest is an in-app `Notification`
  (`src/contexts/workout-session-context.tsx:151-175`, `src/lib/notifications.ts:26-33`). It does
  not fire while iOS has the app suspended.
- Haptics use the Vibration API, which iOS Safari ignores (`src/lib/utils/haptics.ts:4-5`). There
  is no sound anywhere in `src/` (no `AudioContext`, no audio files) and no Wake Lock use.
- The overlay is a full-screen ring with Cancel and Done
  (`src/components/features/WorkoutSetsList.tsx:1149-1252`). `formatTime` formats it
  (`src/lib/utils/format.ts:21`).
- There is no component test for either timer. They are covered by e2e specs only
  (`e2e/exercise-timer.spec.ts:22`, `e2e/exercise-timer-delay.spec.ts`, `e2e/rest-picker.spec.ts`).

### 1.2 Logging endurance today

- A logged endurance set holds `durationSeconds`, `distanceMeters` and an `rpe`
  (`src/db/schema/workout-sets.ts:94-95`, `src/db/schema/workout-sets.ts:106`), and a free-text
  note (`src/db/schema/workout-sets.ts:109`). A session's `source` is `app`, `auto` or
  `assistant`, and a session can link to its planned session
  (`src/db/schema/workout-sessions.ts:71`, `src/db/schema/workout-sessions.ts:75`).
- The run logger offers RPE 6 to 10 only (`src/components/features/LogRunModal.tsx:10`), so an
  easy run cannot be logged below 6.

### 1.3 Load and fitness today (Garmin only)

- Per-activity load is on one scale, 100 = one hour at threshold. Garmin activities get power load
  (bikes only), else HR (TRIMP from the stream, else from time in zones), else Garmin's own TSS
  (`src/lib/garmin/analytics/activity.ts:86-112`). The methods are an enum
  (`src/lib/garmin/analytics/load.ts:10`).
- Strength uses session RPE: minutes x sRPE x 0.22, so one hour at RPE 7.5 is about 100. sRPE is
  the mean RPE of working sets, else from the feeling, else 6
  (`src/lib/garmin/analytics/load.ts:124-133`).
- The Garmin design planned run pace load (`hours x IF^2 x 100`, IF = speed / threshold speed) and
  swim load (`hours x IF^3 x 100`, IF = speed / CSS)
  (`docs/plans/garmin-insights-design.md:99-100`). Neither was built: `activity.ts` has no pace or
  swim method.
- Fitness, fatigue and form: CTL with a 42-day and ATL with a 7-day time constant, TSB = CTL - ATL
  of the day before, per sport and in total, seeded from the mean of the first 28 days and
  "calibrating" for 42 days (`src/lib/garmin/analytics/pmc.ts:1-18`, `computePmc` at
  `src/lib/garmin/analytics/pmc.ts:46-81`). `rampBand` calls up to 5 a week normal, 5 to 8 fast,
  above 8 a warning (`src/lib/garmin/analytics/pmc.ts:86-88`). The module is pure and imports no
  Garmin client code.
- `buildDailyMetrics` adds Garmin activities and LogEveryLift strength sessions. A strength session
  that overlaps a Garmin strength activity by half or more is one entry, not two
  (`matchStrength`, `src/lib/garmin/analytics/daily.ts:82-99`; assembly at
  `src/lib/garmin/analytics/daily.ts:101-141`). The model version is
  `src/lib/garmin/analytics/daily.ts:16`.
- The worker reads only strength sets from completed `app` sessions
  (`src/lib/garmin/metrics-job.ts:162-193`, filters at `src/lib/garmin/metrics-job.ts:180-181`),
  caps a session at 180 minutes (`src/lib/garmin/metrics-job.ts:40`), and stores the daily series
  in `garmin_daily_metrics` (`src/lib/garmin/metrics-job.ts:244-285`). So endurance sessions logged
  in the app never count, and sessions logged by an assistant never count.
- The series is read by `getLoadSeries` (`src/lib/garmin/queries.ts:50`). Garmin is on only for
  admins with the key (`garminAllowedFor`, `src/lib/garmin/access.ts:20`).
- Over MCP, fitness, fatigue and form come only inside `get_garmin_status`
  (`src/lib/mcp/tools/garmin.ts:35-52`). A user without Garmin has no load anywhere.

### 1.4 Home, week and units

- The home card lists several sessions today with `TodaySessionsList`
  (`src/components/features/home/widgets/today/View.tsx:99`); each row starts a program workout
  (`src/components/features/TodaySessionsList.tsx:30`). The week strip reads the dated sessions
  (`src/lib/home/core.ts:167`). The calendar is `/more/calendar`
  (`src/app/more/calendar/page.tsx:12`). The planned-session read shape is `PlannedView`
  (`src/lib/planned-sessions.ts:306-324`).
- Units: `Units` is `{ distance, swim }` with km and m as the default
  (`src/lib/utils/units.ts:12`, `src/lib/utils/units.ts:16`), read on the server with
  `getUserSettings` (`src/lib/user-settings.ts:14-16`) and on the client with `useUnits`
  (`src/contexts/user-settings-context.tsx:55`). Pace helpers are in
  `src/lib/utils/thresholds.ts:68-88`; `currentThresholds` picks the current value per kind
  (`src/lib/utils/thresholds.ts:336`).
- The endurance switch is read with `enduranceEnabledFor` (`src/lib/endurance.ts:18`). The MCP
  route registers the switch-gated tools with it (`src/app/api/[transport]/route.ts:107-125`).

### 1.5 Offline and browser storage

- The service worker precaches the build and uses Serwist's default runtime caching
  (`src/app/sw.ts:41-45`). Logged sets queue offline under `pendingMutationQueue`
  (`src/contexts/pending-queue-context.tsx:73`).
- The privacy inventory lists every localStorage key (`docs/privacy/data-inventory.md:41`);
  `clearLocalUserData` empties them on sign-out (`src/lib/utils/local-data.ts:22`).
- The training log row of the inventory covers sets with duration, distance, heart rate zone and
  RPE (`docs/privacy/data-inventory.md:20`).

### 1.6 What C4 and C5 bring (from their brief and pure modules on their branch)

Not on `main` yet, so named without line numbers:

- A workout is JSON checked by one Zod schema in `src/lib/utils/workout-steps.ts`: steps
  (warm-up, work, recovery, cool-down, rest), one level of repeats, an end per step (time, distance
  or lap), a target as a share of FTP, LTHR, max HR, threshold pace or CSS, or absolute. Every node
  gets a stable id (`s1`, `s2`, ...) that stays on edit, "so C6 can store per-step results".
- The module exports the schema check, the resolver (targets to watts, bpm or pace in the user's
  units, with the missing anchors listed), the estimate (time and distance, with "complete" flags),
  the one-line summary, and the hard-workout rule.
- A planned session holds its own copy of a workout (column `workout` on `planned_sessions`), or a
  program, never both. Swim workouts have the pool length, strokes and send-off times.
- C5 derives each session's state (planned, done, missed, unconfirmed, illness, sick, skipped) and
  its compliance band from duration, then distance. "TSS waits for D1" (its decision 12).
- C5 moves the session write of MCP `log_session` into `src/lib/logged-sessions.ts`, and its "Yes,
  I did it" writes a linked session with one set on the sport's system exercise through it.
- C5 pairs Garmin activities to planned sessions of the same sport on the same day, closest
  duration first, each activity used once.

## 2. Design overview

- **The player is new code beside the timers, not a change to them.** A pure state machine plus
  one client hook. It copies the proven pattern (end timestamps, resync on the three events, hold
  00:00) and leaves `WorkoutSetsList` and the workout context untouched (open question 1).
- **Time is always derived from timestamps.** The player stores when each step started and how
  long it was paused. A suspended app loses no time: on return, it closes every time step that
  ended meanwhile with its true end time.
- **One save path.** A finished session is a normal logged session with one set, written through
  C5's `src/lib/logged-sessions.ts` and linked to the planned session, plus one row of step results.
  C5's state and compliance then see it as done (linked) with no new rule.
- **Load is computed on read, not stored**, from logged sessions and the current thresholds. Only
  the Garmin worker keeps storing its series, as today.
- **One source of fitness per user.** A user with Garmin data reads the Garmin series, which now
  also holds the app sessions Garmin did not record. A user without reads the app series. The two
  are never added together.

## 3. The guided player (C6)

### 3.1 Why not reuse the timer components

The plan says "reuse the existing timer code with care: it is a critical flow". The timer code is
inline state in a 2,300-line component that also logs sets and runs the rest timers (1.1).
Extracting it would change the critical flow for no gain to lifters. So:

- **Reused:** the pattern (end timestamps, `Math.ceil` of the remaining milliseconds, resync on
  `visibilitychange`, `pageshow` and `focus`, a 600 ms hold on 00:00), `formatTime`, the
  `haptics` helpers (they still vibrate on Android), and the full-screen layout style.
- **Not touched:** `WorkoutSetsList`, `WorkoutSessionProvider`, `restTimerEnds`, the pending queue.
  The e2e timer specs must stay green without edits.

### 3.2 Steps to play

`src/lib/utils/workout-player.ts` (*new*, pure, unit tested) expands a workout into a flat list of
up to 400 play steps (the C4 limit). Each play step has:

- `key`: the step id, plus `#n` for round n of a repeat (`s3#2`). Stable, because C4 keeps ids.
- the step type, end, target, cadence, note, stroke and send-off, and its round ("2 of 5").
- `seconds`: the planned time when the end is time; for a swim step with a send-off, the send-off
  (the rep and its rest); null for a distance or lap step.

### 3.3 State machine

```text
PlayerState = {
  v: 1, plannedSessionId, workoutHash,        // hash of the workout JSON the run started with
  status: "ready" | "running" | "paused" | "finished",
  index,                                      // current play step
  stepStartedAt,                              // ms; moved forward by each pause
  pausedAt | null, pausedTotalMs,
  extendSeconds,                              // added to the current step
  startedAt, finishedAt | null,
  runs: StepRun[]                             // closed steps, in order
}
StepRun = { key, startedAt, endedAt, activeSeconds, status: "done" | "skipped" | "partial", extendedSeconds }
```

Events, each `(state, now) => state`:

| Event | Effect |
|---|---|
| `start` | `ready` to `running`; step 0 starts now |
| `tick` | While running: closes every time step whose end (start + seconds + extend) is at or before now, each with its exact end time, and starts the next at that time. Stops at a distance or lap step, or at the end. Returns how many steps changed, for the cue |
| `pause` / `resume` | Freezes the remaining time; resume moves `stepStartedAt` forward by the pause |
| `skip` | Closes the current step as `skipped` with its active time so far |
| `lap` | Closes a distance or lap step as `done` (the user taps when done) |
| `extend(30 \| 60)` | Adds time to the current time step |
| `finish` | Closes the current step as `partial`, status `finished` |

`remaining(state, now)` and `elapsed(state, now)` are derived. The last step ends the run
(`finished`). A distance step indoors cannot be measured, so the screen shows the target distance,
the elapsed time and the estimate from C4, and waits for Lap.

### 3.4 Client hook and screen

`useGuidedPlayer` (*new*, `src/components/features/guided/`) holds the state, runs `tick` every
250 ms from `Date.now()` (so a cue is never more than a quarter second late), resyncs on the three
events, and saves the state on every event.

The screen (`/planned/[id]/play`, full screen, no bottom nav):

- Top: step "4 of 23", the step type as a word and a colour, round "2 of 5".
- Middle: the remaining time in large digits (the elapsed time on a lap step), the target in the
  user's numbers ("220-233 W", "4:27-4:42 /km", "Z2 HR, 128-139 bpm"), cadence, and the note.
- Under it: "Next: 5 min easy, 125-170 W".
- Bottom bar: Pause or Resume, Skip, +30 s, Lap (on lap and distance steps), and Finish behind a
  confirm. 44 px targets at least; the main button is larger.
- A missing threshold shows the target as a share ("88-93% FTP, no FTP set"), from C4's resolver.
- Leaving the page asks first. The run keeps its time; the home card shows "Resume" (3.8).

### 3.5 Sound and screen cues (iOS constraints)

iOS ignores vibration (1.1), so the cue is sound plus the screen.

- **Sound.** Web Audio beeps from an oscillator, no audio files: three short beeps in the last 3
  seconds of a time step, one long beep at the change, a two-tone beep when a work step starts.
  `src/lib/audio-cues.ts` (*new*, client only).
- **Unlock.** iOS plays Web Audio only after a user gesture. The audio context is made and resumed
  in the Start tap, with a silent buffer. If iOS suspends it (app switch, phone call), the screen
  shows "Tap to turn sound back on" until a tap resumes it.
- **Mixing.** Where the browser has `navigator.audioSession`, the player sets the type to
  `transient`, so a cue lowers the user's music briefly instead of stopping it. Whether cues play
  with the ring switch on silent must be checked on a device; the ready screen says "Turn off
  silent mode to hear cues" and has a "Test sound" button.
- **Screen.** At each change the background flashes in the next step's colour for one second, and
  an `aria-live="assertive"` region reads the new step for VoiceOver users. `haptics.tap()` runs too.
- No spoken cues in version 1 (open question 5).

### 3.6 Screen kept awake

- `navigator.wakeLock.request("screen")` on Start and on Resume; released on Finish and on leave.
  The browser drops the lock when the page hides, so the hook asks again on `visibilitychange` to
  visible while running or paused.
- Where the API is missing or refused (older iOS, or a home-screen app on a version where it does
  not work), the player shows one line: "The screen may lock. Timing goes on; set Auto-Lock to
  Never for this session." No hidden-video trick (open question 6).

### 3.7 Background and lock screen

- While the phone is locked or the app is in the background, iOS suspends JavaScript: there are no
  cues. Timing is not lost (3.3).
- On return, `tick` closes the steps that ended meanwhile. A toast says "3 steps passed while the
  app was closed" and one cue plays for the current step.
- The ready screen says this in one line: "Keep the app open: cues stop when the phone locks."
- Cues outside the app need web push, which is its own brief (`web-push-and-reminders.md`, todo).

### 3.8 Persistence and offline

- **Saved run.** The state (3.3) is saved in localStorage under `guidedWorkout` after every event:
  ids, timestamps and step statuses, no names or notes. On mount the player restores it when the
  planned session and `workoutHash` match. A run older than 24 hours is dropped. A changed workout
  offers "Finish with what was recorded". This closes, for the player, the cold-eviction gap the
  exercise timer still has (1.1).
- **Offline.** The player page loads the workout, the resolved targets and the units in one server
  render. After that it needs no network. Starting from a cold, offline app is not supported in
  version 1: the page must be opened once online that day (open question 7, BACKLOG entry).
- **Results offline.** The result is kept in the same key with status `finished` until the server
  confirms the save. The save is idempotent by a `clientKey` made when the run starts, so a retry
  never writes twice. The results screen shows "Not saved yet" with Retry, and retries on the
  `online` event. This does not use the pending queue for sets, which stays untouched.

### 3.9 Strength workout open at the same time

The player does not read or change the active strength workout. Both can be open; each saves its
own session. The ready screen notes "A strength workout is open" when one is (open question 18).

## 4. Views (C6)

All behind the endurance switch, all server rendered with a `loading.tsx` each, all client calls
through `callAction()`. Targets resolve with C4's resolver from `currentThresholds` and the user's
units.

### 4.1 Today (home)

- The strength card stays as it is today, word for word, for every user.
- With the switch on, each of today's sessions with a workout gets a row in a new "Endurance today"
  card under it: sport icon, name, the C4 summary line, estimated time and distance, state and band
  from C5, and one button: "Start guided" (bike and run), "Pool view" (swim), "Resume" (a saved
  run), or "Results" (done). Tapping the row opens the session detail.
- A session with a workout is left out of `TodaySessionsList`, so it is not offered as a program
  workout (it has no program). C5 decides how its home reads list these sessions; this card uses
  the same read (section 13).

### 4.2 Week view

- `/week` (*new*), linked from the home week strip header and from the calendar. `?w=` picks a
  Monday; arrows move a week.
- One block per day, Monday first, in the user's zone: each session with its summary, priority
  (key, support, optional), state and band (C5), and done numbers when done.
- Totals per sport for the week: planned and done time, distance and load (section 6). Strength
  shows as a session count and load.
- A "Load" card: fitness, fatigue and form today, a 6-week line, and this week's ramp with
  `rampBand`. "Calibrating" in the first 42 days. "2 sessions have no load: add RPE" links to them.
  An info sheet shows each method with its evidence label (section 6.6).

### 4.3 Session detail

`/planned/[id]` (*new*): the workout as a list of steps and repeat blocks with targets resolved,
total time, distance and planned load, missing anchors with a link to Thresholds, and the actions
of 4.1. For a done session: the step results (section 5) or "Add step results".

### 4.4 Pool view

`/planned/[id]/pool` (*new*), for swims:

- **List mode** (default): one block per screen, very large text, high contrast, landscape-friendly:
  "10 × 100 free on 2:00", the target "1:47-1:50 /100m" (CSS + 2 to + 5 s), stroke and equipment.
  Tap anywhere or swipe for the next block. Works with wet hands through a pouch: targets at least
  88 px, no small controls.
- **Send-off clock** (from the list's Start button): the player (3.3) with a swim layout. Each
  send-off rep is a time step of the send-off length, so the clock shows "Rep 3 of 10, leave at
  :40" and a pace-clock second hand; a cue plays at each send-off. A distance step with no send-off
  is a Lap step.
- Pool length and units come from the workout and the user's swim unit.

## 5. Per-step results (C6)

### 5.1 Data model: `workout_step_results` (*new*)

One row per logged session that has step results.

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `workout_session_id` | integer, FK `workout_sessions`, cascade, unique | The logged session |
| `planned_session_id` | integer, null, FK `planned_sessions`, set null | The planned session it was for |
| `source` | text enum `player`, `manual`, `assistant` | Who made it |
| `client_key` | text, null | Idempotency key of a player save; unique per user where not null |
| `workout` | jsonb, not null | The workout as run, valid by C4's schema, ids filled |
| `anchors` | jsonb, not null | The threshold values used to resolve the targets (metric), so a later retest does not change what was planned |
| `steps` | jsonb, not null | The step results, below |
| `started_at`, `finished_at` | timestamp, null | From the player |
| `paused_seconds` | integer, not null, default 0 | |
| `created_at`, `updated_at` | timestamp | |

A step result, checked by a Zod schema in `src/lib/utils/step-results.ts` (*new*, pure):

```text
StepResult = { key, status: "done" | "skipped" | "partial" | "not_done",
               activeSeconds?, distanceMeters?, extendedSeconds?,
               value?,      // one measured number in the target's metric unit (W, bpm, m/s, rpm)
               rpe?,        // 1-10
               notes? }     // at most 280 chars
```

Rules: keys must exist in the stored workout's play steps (3.2); at most 400 entries; the JSON at
most 64 KB; unknown keys fail. Planned values are not copied: they come from `workout` and
`anchors` on read, so there is one copy of each fact.

Step results are logged data, like `workout_sets`. They are not plan data, so they make no
revisions (A4 revisions cover plan objects only). Owner: the user and the assistant.

### 5.2 Saving

`saveStepResults` (*new* Server Action) and the MCP tool (section 7) share
`src/lib/step-results.ts` (*new*):

1. Check the planned session is the user's, live, has a workout, and the switch is on.
2. If a completed app or assistant session already links to it, attach the results to that session
   (replace when they exist). Else write a new completed session through C5's
   `src/lib/logged-sessions.ts`: dated on the user's day the run started, linked to the planned
   session, one set on the sport's system exercise with the active time (all steps, no pauses),
   the distance when given, the session RPE and notes. So C5 reads it as "done (linked)".
3. Insert the step results row in the same transaction. A repeated `clientKey` returns the first
   save.

A planned session that C5 marked done by a Garmin pick still gets the app session: the run is real
data. The load never counts twice, because the Garmin pairing (6.4) drops the app session's load.

### 5.3 The results screen

`/planned/[id]/results` (*new*). After the player it opens filled from the run; by hand it opens
with every step as planned and "done".

- First, one row: "How hard was it?" RPE 1 to 10, one tap. Not required (open question 10); with
  no RPE and no pace anchor the session has no load, and the screen says so.
- Distance for the session (optional, from the trainer or treadmill display), in the user's unit.
- Each step: planned against done time (or distance), a band from C5's `complianceBand` on that
  step, skipped and extended marks. Work steps can take a measured value (avg watts, bpm or pace),
  shown against the target as "in range", "below" or "above", and a step RPE and note. Collapsed
  by default; repeats show as one block with a row per round.
- Save in a pinned bottom bar. A failed save keeps everything on screen and in the saved run.

## 6. Load without Garmin (D1)

### 6.1 Session load

`src/lib/utils/training-load.ts` (*new*, pure, unit tested). One scale with the Garmin code: 100 =
one hour at threshold (I-3 in the Garmin design). The first method that applies wins:

| Sport | Method | Formula | Needs |
|---|---|---|---|
| Run | `run_pace` | `load = hours x IF^2 x 100`, `IF = (distance / time) / threshold speed` | Current `run_threshold_pace`; distance at least 400 m; time at least 5 min; incline 0 or none; IF 0.3 to 1.5, else fall through |
| Swim | `swim_css` | `load = hours x IF^3 x 100`, `IF = speed / CSS` | Current `swim_css`; distance and time; time is the moving time from step results (rest steps left out) when there are any, else the logged time |
| Run, swim, bike | `srpe` | `load = minutes x RPE x 0.22` | An RPE: the duration-weighted mean of the session's endurance sets |
| Strength | `srpe` (existing) | The existing strength formula, unchanged | As today |
| Any | `none` | No load; the session is counted as "no load" and listed | |

- Bike: sRPE only. The app has no power data (no Bluetooth; audit 3b).
- A session with sets of two sports splits: each discipline's sets give that sport's load; the
  strength part gets the wall time minus the endurance time, at most 180 minutes, as today.
- Only the user's own current thresholds are used (C3), never a Garmin estimate: the research says
  Garmin's auto threshold pace reads about 12% slow.
- Swim time with wall rest lowers IF and the load. Step results remove most of it.

### 6.2 Planned load

`plannedLoad(workout, thresholds)` for the week totals and the session detail, labelled
"estimate":

- A step with a power target (% FTP) or a pace target (% threshold speed, or CSS + offset) has IF =
  the middle of the target over the anchor; bike and run use `IF^2`, swim `IF^3`.
- A step with a heart-rate target or none uses a default IF by type: warm-up and cool-down 0.65,
  recovery 0.55, work 0.80, rest 0 (inference). The estimate is then marked `partial`.
- Time comes from C4's estimate per step; a lap step adds nothing and marks it partial.
- Not used by compliance or by any limit in this PR (open questions 17 and 21).

### 6.3 Fitness, fatigue and form for a user without Garmin

`src/lib/training-load.ts` (*new*) reads the completed sessions with `source` `app` or
`assistant` (not `auto`: an auto row has no numbers) in the window, computes each load (6.1),
sums per day and sport in the user's zone, and runs the existing pure `computePmc`. No table, no
job: a year of sessions is a few hundred rows. Strength counts in the total, as in the Garmin model
(O-2).

### 6.4 With Garmin: no double counting

- One reader, `getTrainingLoad(userId, days)` (*new*): when `garminAllowedFor` is true and the user
  has Garmin daily rows, it returns the Garmin series; otherwise the app series. It never adds them.
- The Garmin worker gets a new input: the app's endurance sessions (app and assistant). Each is
  paired one to one with a Garmin activity of the same sport on the same local date, closest
  duration first (the C5 pairing rule). A paired app session adds no load: Garmin measured it. An
  unpaired one adds its app load as a `logeverylift` entry. `DAILY_MODEL_VERSION` goes up by one so
  the series is rebuilt.
- So a trainer ride in the app with no watch counts once (app), a run recorded on the watch and
  confirmed in the app counts once (Garmin), and a run on the watch with player results counts once
  (Garmin; the step results stay for display).
- The strength path keeps its own match (`matchStrength`). Whether `assistant` strength sessions
  count is open question 15.
- Garmin activities keep their methods: no pace or CSS load for Garmin runs and swims in this PR
  (open question 14).

### 6.5 Where it shows

The week view's Load card (4.2) and the week totals; the session detail (session and planned
load with the method); MCP (section 7). The Garmin pages do not change, except that their series
now includes unpaired app endurance sessions.

### 6.6 Evidence

| Rule | Label | Source |
|---|---|---|
| TSS = hours x IF^2 x 100 | Coach convention | Research, "Race intensity sets the ceiling for training load" |
| The same formula with IF from pace (run) | Inference | Applies the research formula to speed; the research gives it for power only |
| Swim load with IF^3 from CSS | Inference | The Garmin design (2.2); not in the research |
| Session RPE x minutes as load | Inference | Research, "Plans become data" (strength as session RPE x minutes); the 0.22 scale is the Garmin design's |
| CTL 42 days, ATL 7 days, TSB = CTL - ATL | Coach convention | Research, "CTL ramp limits are conventions" |
| Ramp bands 5 and 8 a week | Coach convention | Same section |
| Planned load default IF per step type | Inference | This brief |
| Garmin load is never converted to TSS | Inference | Same section ("Converting Garmin load to TSS: do not") |

The research has no section on session RPE, run pace load or swim load. T1 says it changes by a
research pass, not by hand. BACKLOG entry: a research pass on these three models (open question
20).

## 7. MCP tools

Conventions from `ai-coach.md`: read tools are read-only; every write takes `reason`; values are
metric. All tools here register only with the endurance switch on (route, 1.4).

| Tool | Hint | What |
|---|---|---|
| `get_training_load` (*new*) | read | `days` (7-365, default 90): the source (`garmin` or `app`), per day load per sport, CTL, ATL and TSB per sport and in total, the 7-day ramp and its band, `calibrating`, the sessions with no load and why, the count per method, and the evidence labels of 6.6 |
| `get_step_results` (*new*) | read | By `plannedSessionId` or `workoutSessionId`: the steps with planned values (from the stored workout and anchors), the results, the per-step band and target hit, the session RPE and load with its method |
| `log_step_results` (*new*) | write | `plannedSessionId`, `steps` (5.1), optional `sessionRpe`, `distanceMeters`, `notes`, `reason`. Same path as the app (5.2), `source` `assistant`. Replaces earlier results of that session |
| `list_planned_sessions` (C2, C5) | read | Each entry adds `plannedLoad` (value, `partial`) and, when done, `load` (value, method) |
| `get_workout` (C4) | read | Adds `plannedLoad` |

The player has no tool: it is a device screen. Instructions and `docs/mcp/app-rules.md` gain: the
load methods and labels, "app load and Garmin load are never added; on a pair Garmin wins", that a
session with no RPE has no load, and that step results are logged data with no revisions.

## 8. Migration and rollback

One migration from `pnpm db:generate` (create, not rename), numbered after C4 and C5's, SQL and
`drizzle/meta/` in one commit. No `CREATE TYPE` (text enum).

- `CREATE TABLE workout_step_results` with the FKs of 5.1, a unique index on
  `workout_session_id`, a partial unique index on `(user_id, client_key) WHERE client_key IS NOT
  NULL`, and an index on `(user_id, planned_session_id)`.
- No other schema change. Load needs none (6.3). The Garmin series rebuilds itself on the version
  bump.

**Rollback.** Data lost: step results only. Logged sessions written by the player stay as normal
logged sessions.

1. Deploy the previous image. It ignores the table. The Garmin series rebuilds at the old version
   on the next worker run (the stored rows carry `modelVersion`).
2. Then, optionally:
   ```sql
   DROP TABLE workout_step_results;
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of this migration>';
   ```
3. A saved run in a browser's `guidedWorkout` key is ignored by the old image and cleared on the
   next sign-out.

## 9. Privacy steps (`privacy-compliance` skill)

1. **Inventory** (`docs/privacy/data-inventory.md`):
   - Training log row: add `workout_step_results` (per-step times, distances, measured values, RPE,
     notes; the workout and threshold values as run). Same purpose, basis and retention as
     `workout_sets`.
   - Browser line: add `guidedWorkout` (the running session's ids, timestamps and step statuses
     until it is saved; no names or notes), cleared on save, discard, sign-out and deletion.
   - Garmin row: the daily series now also holds the load of app endurance sessions that Garmin did
     not record. Load for users without Garmin is computed when shown and not stored.
2. **Recipients.** MCP row: training load and step results, read; step results written with read
   and change. Friends: add "step results and training load" to the "Never" list. The in-app AI
   (AI Setup, check-in) gets neither.
3. **Policy** (`src/app/privacy/page.tsx`): per-step results in the training log, the new browser
   key, and that assistants can read load and read and write step results. Bump `LEGAL_VERSION`.
   `CONSENT_VERSION` stays: no new kind of health data (sets already hold duration, distance, heart
   rate zone, RPE and notes).
4. **Export:** `workout_step_results` in `collectUserData` (`src/lib/account-data.ts`); the
   coverage test fails until then.
5. **Delete:** `user_id` and `workout_session_id` cascade.
6. **Friends:** no friend reader touches the table. A test asserts the friend session detail has no
   step results.
7. **Logs:** ids and tags only (`[player]`, `[step-results]`, `[load]`); never notes, values or
   workout names.
8. **Browser storage:** add `guidedWorkout` to `clearLocalUserData`.

## 10. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | Play steps: repeats expand with `#n` keys, send-off steps get the send-off as time, distance and lap steps have no time, the 400 limit | `src/__tests__/workout-player.test.ts` (*new*) |
| Unit | Events: start, pause and resume (remaining frozen, then continues), skip, lap, extend during the last 3 s, finish; `tick` closes several steps after a long gap with exact end times and stops at a lap step; active time leaves out pauses; restore from stored JSON, a corrupt or old version gives null, a changed `workoutHash` is detected | same |
| Unit | Step results schema: unknown key, a key not in the workout, ranges, size limits; per-step band and target hit | `src/__tests__/step-results.test.ts` (*new*) |
| Unit | Load: run pace (IF, the 400 m and 5 min floors, incline falls back, IF out of range falls back), swim CSS with and without step results, sRPE with the duration-weighted RPE, none, two-sport sessions; planned load with power, pace, CSS offset, HR default and partial | `src/__tests__/training-load.test.ts` (*new*) |
| Unit | App series: day sums in the user's zone, `computePmc` output, auto rows left out | same |
| Unit | `buildDailyMetrics` with app endurance sessions: paired one to one by sport, day and closest duration; a paired session adds nothing; an unpaired one adds a `logeverylift` entry; strength unchanged | `src/__tests__/garmin-analytics.test.ts` |
| Component | The player with fake timers and a mocked audio module: the countdown reaches 00:00 and then the next step shows; beeps at 3, 2, 1 and a cue at the change; pause freezes the digits; skip and +30 s; after `vi.setSystemTime` past two steps, a `visibilitychange` catches up and shows the toast; wake lock asked on start, asked again on visible, released on finish; no wake lock shows the hint; a reload restores the run | `src/__tests__/components/guided-player.test.tsx` (*new*) |
| Component | Results screen: filled from a run; Save calls the action through `callAction()`; a rejected save keeps the screen and the saved run and shows Retry | `src/__tests__/components/step-results.test.tsx` (*new*) |
| Component | Home with the switch off is unchanged; with it on, a workout session shows in the endurance card and not in `TodaySessionsList` | `src/__tests__/components/endurance-today.test.tsx` (*new*) |
| Integration | Save: writes one linked session through the shared module and one results row; a repeated `clientKey` writes nothing new; an existing linked session gets the results attached; another user's planned session is refused; switch off is refused; results that do not fit the workout are refused with paths | `src/__tests__/integration/step-results.test.ts` (*new*) |
| Integration | Load reader: a user without Garmin gets the app series; a Garmin user gets the Garmin series; never both | `src/__tests__/integration/training-load.test.ts` (*new*) |
| Integration | MCP: the three new tools, the added fields, read-only scope refuses `log_step_results`, switch off hides them, another user's ids refused | `src/__tests__/integration/mcp-endurance-app.test.ts` (*new*), `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Migration: table, FKs, unique indexes; export has the table, delete removes it, friend detail has no results | `src/__tests__/integration/migrations.test.ts`, `src/__tests__/integration/account-data.test.ts` |
| e2e | Endurance user with a bike workout today of three 5 s steps (C4's minimum): home shows it with targets in watts; Start guided; step 2 shows after the first change; Pause, Resume, Skip; the results screen; RPE 7; Save; `testDb()` has a linked session and one results row; the week view shows it done with a load | `e2e/guided-workout.spec.ts` (*new*) |
| e2e | A swim: pool view list mode shows the block and the target per 100 m; the send-off clock starts | same |
| e2e | The exercise timer, rest picker and journey specs pass unchanged | existing specs |

Audio and Wake Lock are stubbed in the e2e specs: Playwright's WebKit and Chromium do not give a
reliable audio or wake lock, and a real device check is in the smoke pass. Then `pnpm verify`,
`make e2e` and the 9-step smoke pass in `CLAUDE.md` (the home screen changes for endurance users),
plus a manual check on an iPhone home-screen app: cue with the ring switch on and off, wake lock,
lock and unlock mid-step.

## 11. Order of work

1. After C4 and C5 merge: rebase, check section 13, fix this brief.
2. Pure modules and their unit tests: `workout-player.ts`, `step-results.ts`, `training-load.ts`.
3. `buildDailyMetrics` input and the worker query; the version bump; tests.
4. Migration and schema; the save module and action; integration tests.
5. Load reader; MCP tools, instructions and `app-rules.md`.
6. Audio cues and wake lock modules; the player hook and screen; component tests.
7. Views: home card, week, session detail, pool, results.
8. Privacy steps, e2e specs, `pnpm verify`, `make e2e`, smoke pass, device check.

## 12. Defaults chosen

- The player is new code; the strength timers are not touched.
- Time from timestamps; a 250 ms tick; catch-up after the background.
- Cues: beeps at 3, 2, 1 s and at the change, plus a flash and a screen-reader line; no speech.
- Wake lock with a plain fallback line; no hidden video.
- Saved run in localStorage for 24 hours; results kept until the server confirms.
- One logged session per run through C5's module; results in their own table, one row per
  session.
- Session RPE asked, not required.
- Load: run pace, then sRPE; CSS, then sRPE; bike sRPE; strength as today; no RPE and no anchor
  gives no load.
- Load computed on read for users without Garmin; Garmin users keep the stored series.
- On a pair, Garmin wins.
- Compliance stays on duration, then distance.

## 13. What depends on C4 and C5's final code

Before any code, after they merge, check and fix this brief where the code differs:

1. The workout module's names and shapes: the schema check, resolver, estimate, summary, the
   step ids and their fill rule, the 400-step limit, and the 5 s minimum.
2. The `workout` column on planned sessions and how C5's home and calendar reads list sessions
   with a workout, so the endurance card (4.1) uses the same read and nothing shows twice.
3. `src/lib/logged-sessions.ts`: its signature, the system exercise per sport, and how it links
   the planned session, so 5.2 calls it as is.
4. The state function, the band function and the Garmin pairing, so the week view, the per-step
   band and 6.4 reuse them.
5. MCP `list_planned_sessions` and `get_workout` result shapes, for the added fields.
6. The migration number, so this one follows theirs.
7. Whether C5 adds the "Step editor" BACKLOG entry, which open question 2 keeps.

**Checked against PR #231 (2026-11-13).** What held and what changed:

1. Held. The schema check, resolver, estimate, summary and hard rule are as 1.6 says. Ids fill
   as `s1`, `s2`, ... and stay on edit; the limit is 400 expanded steps; a time step is at least
   5 s. The player's play-step keys and the results' keys come from one function, so they match.
2. Changed. C2's home read skips sessions with no program, so a workout session never reached
   `TodaySessionsList`; C5 shows past ones in "Did you do these?" and left a BACKLOG entry
   ("Today's card for workout sessions"). The endurance card reads today's sessions with a
   workout through C5's `sessionCompliance`. Nothing shows twice. The week strip stays as it is.
3. Held, with one addition. `writeLoggedSession` takes a session input with its sets; the
   built-in exercise per sport is C5's `sportExerciseId`. It gained an optional callback that
   runs in its transaction, so the results row is written with the session (5.2).
4. Held. The week view reads `sessionCompliance` for states and bands; the per-step band is
   `complianceBand`. C5's `pairGarmin` pairs planned sessions with activities; the load pairing
   pairs logged app sessions with activities, so it is its own pure function with the same rule.
5. Held. Both tools gained `plannedLoad`; `list_planned_sessions` gained `load` on done entries.
6. This migration is 0088.
7. Kept. The entry now names the follow-up PR C6b.

## 14. Risks

- **Critical flows.** The timers are not touched; their e2e specs must pass unchanged. The home
  screen changes only for endurance users; C2's lifter spec and the smoke pass guard the rest.
- **iOS behaviour.** Audio unlock, the silent switch and wake lock in a home-screen app differ by
  iOS version and cannot be tested in CI. Timing never depends on them, and the device check is a
  merge step.
- **Load for the owner.** Adding unpaired app sessions changes the owner's Garmin series. The
  pairing test covers the one-to-one rule; the change is visible on the Garmin load page.
- **A wrong pair** (two runs on one day): the closest duration picks; the worst case is one run's
  load counted from the other's numbers, never a double count.
- **Over-reading sRPE.** Session RPE on the app's 1-10 scale is rough. Every load shows its method,
  and the labels say Inference.

## 15. Plan corrections (in the build PR)

- C6 and D1 status `brief`, then `done` when merged.
- D1 in the plan needs C3 and C5. The run pace and CSS loads need C3's thresholds; the "done"
  sessions need C5. No change.
- The plan's C6 says "reuse the existing timer code with care". This brief reuses its pattern, not
  its code (3.1), so the critical flow does not change.
- BACKLOG: add "Offline cold start for the guided player", "Pace and CSS load for Garmin runs and
  swims", "Research pass on session RPE, run pace and swim load", "Garmin laps as step results",
  "Spoken cues in the player"; keep "Step editor for structured workouts" (C6b); note in "iOS
  backgrounding" that the player persists its run.

## 16. Files

New: `src/lib/utils/workout-player.ts`, `src/lib/utils/step-results.ts`,
`src/lib/utils/training-load.ts`, `src/lib/training-load.ts`, `src/lib/step-results.ts`,
`src/lib/audio-cues.ts`, `src/lib/wake-lock.ts`, `src/db/schema/step-results.ts`,
`src/lib/actions/step-results.ts`, `src/lib/mcp/tools/endurance-app.ts`,
`src/components/features/guided/` (hook, player screen, pool view, results), the endurance today
card, `src/app/week/page.tsx`, `src/app/planned/[id]/page.tsx` with `play`, `pool` and `results`,
each with its `loading.tsx`, the tests in section 10, the migration.

Changed: `src/lib/garmin/analytics/daily.ts`, `src/lib/garmin/metrics-job.ts`, `src/app/page.tsx`,
C5's planned-session MCP tools and `get_workout`, `src/app/api/[transport]/route.ts`,
`src/lib/mcp/instructions.ts`, `docs/mcp/app-rules.md`, `src/lib/account-data.ts`,
`src/lib/utils/local-data.ts`, `src/app/privacy/page.tsx`, `src/lib/constants/legal.ts`,
`docs/privacy/data-inventory.md`, `docs/data-model.md`, `BACKLOG.md`, the plan and this README.

## 17. Open questions, with recommendations

The owner is away; the hub decides. Each recommendation is the safe choice: lifters see no change,
the critical flows do not change, nothing changes a plan by itself, and no number is guessed
without saying so.

1. **Reuse the timer components, or build the player beside them?** Recommend: beside them. Reuse
   the pattern, `formatTime` and `haptics`; do not touch `WorkoutSetsList` or the workout context.
2. **Step editor in this PR?** C4's decision 2 hands it to C6. Recommend: a follow-up PR (C6b)
   after this one, as C2b did, so the player and load are reviewed alone. The assistant keeps
   creating workouts until then; the BACKLOG entry stays.
3. **Where do the views live?** Recommend: an extra card on home (switch on, sessions with a
   workout only), `/week`, `/planned/[id]` with `play`, `pool` and `results`.
4. **Which cue sound?** Recommend: Web Audio oscillator beeps, unlocked in the Start tap,
   `navigator.audioSession` set to `transient` where it exists, a Test sound button.
5. **Spoken cues?** Recommend: not in version 1 (BACKLOG).
6. **Wake lock fallback?** Recommend: a plain hint line; no hidden-video trick.
7. **Offline cold start?** Recommend: not in version 1; the page must be opened online; the run
   and the result work offline after that (BACKLOG).
8. **Where do step results live?** Recommend: their own table, one row per logged session, JSON
   checked by a Zod schema; `workout_sessions` gets no column.
9. **How does a run become a logged session?** Recommend: through C5's `logged-sessions` module,
   attached to an existing linked session when there is one; Garmin wins on load.
10. **Is session RPE required?** Recommend: asked first, not required; a session with no RPE and no
    pace anchor shows "no load" with a link to add it.
11. **Change the run logger's RPE 6-10?** Recommend: no, it is the set logging flow; BACKLOG note.
    Runs use pace load when the threshold is set.
12. **Load method order?** Recommend: run pace, then sRPE; CSS, then sRPE; bike sRPE; strength as
    today.
13. **One scale for sRPE?** Recommend: yes, the strength factor 0.22, so all sports add up.
14. **Pace and CSS load for Garmin runs and swims too?** Recommend: no in this PR, so the owner's
    Garmin loads do not change method; BACKLOG.
15. **Count assistant-logged sessions in load?** Recommend: yes for endurance in both paths; for
    Garmin strength, keep today's `app` filter in this PR and add a BACKLOG entry, so this PR
    changes no strength number.
16. **Pairing rule?** Recommend: one to one, same sport, same local date, closest duration; Garmin
    wins.
17. **Compliance by load?** Recommend: no; keep duration then distance (C5), show load beside it.
    Planned and done load often come from different methods.
18. **Player while a strength workout is open?** Recommend: allowed, separate sessions, with a note.
19. **Step results for sessions done without the player?** Recommend: yes, by hand from the session
    detail, filled as planned.
20. **Evidence for the three load models?** Recommend: ship with Inference labels and a BACKLOG
    entry for a research pass (T1).
21. **Planned load?** Recommend: yes, as an estimate for the week totals and detail; not used by
    compliance or limits until D2 decides.
22. **Missing data in load?** Recommend: no defaults for endurance; count and list the sessions
    with no load. Strength keeps its existing defaults.
23. **Who sees the load card and tools?** Recommend: the endurance switch only (D18), Garmin or not.

### Decisions

Decided by the hub on 2026-11-13, owner may change. The hub took every recommendation above.

1. The player is built beside the timers; `WorkoutSetsList` and the workout context are not touched.
2. The step editor ships in a follow-up PR (C6b); the BACKLOG entry stays.
3. Views: an extra home card for sessions with a workout, `/week`, and `/planned/[id]` with `play`, `pool` and `results`.
4. Cues are Web Audio oscillator beeps, unlocked in the Start tap, audio session `transient` where it exists, with a Test sound button.
5. No spoken cues in version 1.
6. Wake lock fallback is a plain hint line; no hidden-video trick.
7. No offline cold start in version 1; the run and its save work offline once the page is open.
8. Step results live in their own table, one row per logged session.
9. A run becomes a logged session through C5's module, attached to an existing linked session when there is one; Garmin wins on load.
10. Session RPE is asked first, not required; no RPE and no anchor gives "no load".
11. The run logger's RPE 6-10 does not change in this PR; BACKLOG note.
12. Load order: run pace, then sRPE; CSS, then sRPE; bike sRPE; strength as today.
13. One sRPE scale for all sports: the 0.22 strength factor.
14. No pace or CSS load for Garmin runs and swims in this PR; BACKLOG.
15. Assistant-logged sessions count for endurance load in both paths; the Garmin strength filter stays `app` only; BACKLOG.
16. Pairing: one to one, same sport, same local date, closest duration; Garmin wins.
17. Compliance stays on duration, then distance; load shows beside it.
18. The player may run while a strength workout is open, with a note.
19. Step results can be added by hand for sessions done without the player.
20. The three load models ship labelled Inference, with a BACKLOG entry for a research pass.
21. Planned load is an estimate for the week totals and detail only.
22. No defaults for missing endurance data; sessions with no load are counted and listed.
23. The load card and tools need the endurance switch.

## 18. Where the build differs from the brief

- **No hold on 00:00.** The exercise timer holds 00:00 for 600 ms before it completes a set. A
  guided step ends exactly on time instead: the next step shows at its start, with its cue, and
  the countdown beeps at 3, 2 and 1. A component test pins this ("the next step starts exactly
  on time"). 3.1 listed the hold as reused; it is not.
- **A changed workout is not resumed.** 3.8 offered "Finish with what was recorded" for a saved
  run of an older version of the workout. The ready screen says the run was not resumed instead,
  and starting replaces it. A run of another session saved on the phone is also named on the
  ready screen.
- **`clearLocalUserData` needed no change.** It already empties every localStorage key except
  the display settings, so `guidedWorkout` goes on sign-out. The inventory names the key.
- **Attaching results fills a missing RPE.** When the session is already logged, a session RPE
  from the results screen fills the sets that have none; it never overwrites a logged one.
- **The send-off clock is the player** on the same route (`/planned/[id]/play`), with the swim
  layout ("Rep 3 of 10", "to the next send-off").
- **Cardio with no discipline** (rowing, an elliptical) counts in the app series as sport
  `other`, with session RPE only. Strength in a mixed session gets the wall time minus the
  endurance time, at most 180 minutes.
- **The app series starts at the first logged session,** so fitness on the first shown day is
  right; the window only cuts what is returned.
- **Garmin's `LoadMethod`** gained `run_pace` and `swim_css`, for the app sessions the series now
  holds. Garmin activities keep their methods (decision 14).
- **The e2e spec uses Playwright's clock** to move time on (no sleeps), and runs the browser in
  a far time zone (UTC+14) with a console check for hydration errors.
- **Plan corrections:** C4 and C5 are `done` (PR #231) and C6 and D1 `done` with this PR, in
  `triathlon-coach-plan.md` and the README.

## 19. Review fixes (2026-11-13)

Two independent reviews of the build. Each code fix came with a test that failed first.

1. **A run warm-up inside a gym session counted twice** in the Garmin series: the strength path
   already counts such a session whole, matched or not. App endurance rows from sessions with
   strength sets are left out, so these days read as in model v2. Unit test "a strength session
   with a run warm-up gives the same series as v2" (`src/__tests__/garmin-analytics.test.ts`).
2. **Distance from a set with no time raised the pace.** Only sets with a time give distance.
   Integration test "2: distance from a set with no time does not raise the pace"
   (`src/__tests__/integration/endurance-app.test.ts`, as the rest unless named).
3. **Swim moving time was not capped.** It counts only when every swum step has a time, and never
   above the logged time. Unit test "swim: moving time is capped at the logged time"
   (`src/__tests__/training-load.test.ts`); integration test "3: swim moving time ...".
4. **A new user's ramp read 0.** It is null until a week after the first day with data. Test "4".
5. **A Garmin activity with no start time never paired.** It pairs by sport and day, after the
   timed ones. Unit test "pairs with a Garmin activity that has no start or end time".
6. **`log_step_results` dropped the distance on an attached session.** It goes on the first set
   when no set has one; never an overwrite. Test "6".
7. **`list_planned_sessions` computed load for lifters.** Only with the endurance switch. Test "7".
8. **A done session logged on another day had no load.** Load is read by the linked session ids.
   Test "8".
9. **A finished, unsaved run expired after 24 hours.** Only an unfinished run expires, in the
   player and in the home card's link. Unit test "never expires a finished, unsaved run"
   (`src/__tests__/workout-player.test.ts`); component test "hides an expired unfinished run, and
   keeps a finished one of any age" (`src/__tests__/components/endurance-today.test.tsx`).
10. **A new Start could replace a finished, unsaved run.** The ready screen names it, links to its
    results, and blocks Start until it is saved or discarded with "Discard it". The results form
    still fills from it after the workout was edited. Component tests "a finished, unsaved run of
    another session blocks Start ...", "... of this session's older workout routes to its results"
    (`src/__tests__/components/guided-player.test.tsx`) and "fills from a finished run of an older
    version of the workout" (`src/__tests__/components/step-results.test.tsx`). This replaces the
    first bullet of section 18 for finished runs.
11. **A second save overwrote the run's details.** The source, client key, times and pauses stay
    unless the save brings new ones. A new column, `wrote_session` (migration 0088 regenerated, not
    yet on `main`), marks a session the results path wrote: a later save may change its RPE and
    distance; a session someone else logged only gets missing values filled. The form shows the
    saved distance and sends no run details from a hand save. Tests "11: a second save keeps ..."
    and "shows the saved distance and sends no run details from a hand save".
12. **Wake lock handles leaked.** The old handle is released when a new one arrives; a handle that
    arrives after the run ended, or after the screen closed, is released at once; a reload during a
    run asks for it again. Component tests "releases the old wake lock on each resync ..." and "asks
    for the wake lock after a reload during a run".
13. **A double tap on Skip or Lap closed two steps.** Each tap names the step on screen; a tap for a
    step already closed does nothing. Component test "a double tap on Skip skips one step".
14. **Pause after a step ended played no cue,** and **the app showed the assistant's duplicate
    message.** Pause now runs the same catch-up as the clock, with its cue; the app shows "This
    session is already logged for that day." Component test "Pause after a step ended plays the
    change cue"; unit test `src/__tests__/step-results-messages.test.ts`.

Re-review (2026-11-13):

- **Discard took one tap** next to "Save its results". It now asks first ("Discard the run").
  Component test "a finished, unsaved run of another session blocks Start ..." (updated).
- **A run whose step ids all changed** saved nothing ("No time recorded") while the banner said
  only some steps were left out. The form now says that no step matches and offers "Save as one
  session" with the run's total active time (`durationSeconds` on the save, used only when the
  steps hold no time). Tests "says plainly when no step of the run matches ..."
  (`src/__tests__/components/step-results.test.tsx`) and "re-review 2: with no step time ...".
- **A value could not be cleared** on a session the results path wrote, and its time did not
  follow the steps. Null now clears RPE and distance there (left out keeps them, as MCP sends),
  and the set's time and the session's end follow the steps. A session someone else logged is
  never cleared. Tests "re-review 3: ..." (two).
- **Mixed sessions in the Garmin series:** BACKLOG "Per-sport split of mixed app sessions in the
  Garmin series", and the comment at the top of `src/lib/garmin/analytics/daily.ts`.
