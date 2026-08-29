# Cycle periodization

> **Status:** implemented
> **Last verified:** 2026-08-25 against `91c1646`
> **Source of truth:** `src/lib/utils/periodization.ts`, `src/lib/actions/training-cycles.ts` (`getActiveCycleForUser`, `getCyclePeriodization`, `getProgramPeriodization`, `computeCycleAdaptation`, `syncPeriodizedTargets`)
>
> Stale check: `git log 91c1646..HEAD -- src/lib/utils/periodization.ts src/lib/actions/training-cycles.ts`

Cycle periodization decides how hard *this week* should be, relative to the hardest week of the block, and then rewrites the plan to say so.

The one idea to hold: **a periodized set does not store its own target — it stores its peak, and the target is derived.** `peak_distance_meters` is the race-prep number the athlete is ramping toward; `distance_meters` is a **derived cache** that a weekly sync overwrites from `peak x curve(week)`. This is the mirror image of [smart incrementation](smart-incrementation.md), where a suggestion is never a write. Here the engine writes the plan, on its own, as a side effect of a page load.

Rule prefix: **`PZ`**.

## Vocabulary

- **Block** — one training cycle from `startDate` to `startDate + durationWeeks x 7`. Weeks are 1-indexed within it.
- **Peak anchor** — `program_sets.peak_distance_meters` / `peak_duration_seconds`. Non-null means "this set is periodized". Null means the set is ordinary and the sync never touches its volume.
- **Multiplier** — the fraction of peak prescribed for a week (0-1). **Effective multiplier** — the multiplier after the performance nudge is applied.
- **Curve** — the multiplier as a function of week, produced by `periodizedLoad`. Pure; no DB.
- **Sync** — `syncPeriodizedTargets`, the one function that writes derived targets back onto `program_sets`.
- **Nudge** — the no-wearable adaptation percent (90-105) from `computeAdaptationFactor`. It scales the curve; it never replaces it.
- **Session role** — `program_sets.session_role`, a structural tag marking sets whose *prescription*, not just volume, changes by phase. `"work"` is the only value anything writes or reads.

## Scope boundary

This spec covers **block-level volume periodization** — how a week's load is derived and written. It does not cover:

- **Per-set load progression** (increments, the consensus gate, the plan ratchet) — that is [smart-incrementation.md](smart-incrementation.md), rule prefix `SI`. The trap: **`DELOAD_FACTOR` is `0.75` here and `0.9` there**, and both modules use the word "deload" for different things. A `PZ` deload is a lighter *week* for a whole block; an `SI` deload is a backed-off *weight* for one exercise.
- **Scheduling** — which slot falls on which day, rotation walking, missed-workout detection and make-up. That lives in `src/lib/utils/cycle-position.ts` and is mapped in [../cycles-and-plans.md](../cycles-and-plans.md). It shares the word "cycle" and nothing else.
- **Plan generation** — how a triathlon blueprint picks its peak volumes (`src/lib/utils/triathlon-plan.ts`). This spec starts once the anchors exist.

## Inputs

On `training_cycles`: `durationWeeks`, `goal`, `athleteLevel`, `startDate`, `status`, `lastSyncedWeek`, `adaptationPct`, `adaptationNote`. On `program_sets`: `peakDistanceMeters`, `peakDurationSeconds`, `sessionRole`. Signals come from completed `workout_sessions` (`readiness`) and their `workout_sets` (`rpe`). Schema detail is in [../data-model.md](../data-model.md).

Three non-obvious ones:

- **`lastSyncedWeek IS NULL` means "never synced"**, and the sync fires on any inequality, not just an increase — so restarting a cycle (which resets `startDate` but not `lastSyncedWeek`) correctly re-syncs backwards to week 1.
- **`goal` and `athleteLevel` default to `"build"` / null on non-triathlon cycles.** Those cycles carry no peak anchors, so the curve is computed and then applies to nothing.
- **`rpe` on `workout_sets` is RIR-derived** (`rpe = 10 - rir`), which is why an "average RPE at or below 6" test in PZ-23 is really "averaging four or more reps in reserve".

## The block shape — PZ-1…6

`phaseLayout` splits the block; `periodizedLoad` then answers for one week. Evaluation order inside `periodizedLoad` is **maintain, then taper, then peak, then ramp** — the first match returns.

| Order | Branch | Condition |
|---|---|---|
| 1 | maintain | `goal === "maintain"` |
| 2 | taper | `w >= rampWeeks + peakWeeks + 1` |
| 3 | peak | `w >= rampWeeks + 1` |
| 4 | base / build ramp | otherwise |

### PZ-1 — A block is peak-anchored, not target-anchored
An endurance set's stored `distanceMeters` / `durationSeconds` is a derived cache of `peak x multiplier`. The peak anchor is the prescription of record.

*Why:* a block's intent is "arrive at this volume on race week". Storing the weekly number as the source of truth would make the intent unrecoverable after the first ramp step, and would make changing block length impossible without re-entering every set.
*Covered by:* `triathlon-plan.test.ts` — "peak-anchors endurance sets and scales week 1 below peak for a build".

### PZ-2 — The block splits taper-first, then peak, then whatever is left ramps
Taper takes `ceil(totalWeeks x 0.1)` weeks, clamped to 1-3. Peak takes 2 weeks for blocks of 8 weeks or more, otherwise 1. The ramp gets the remainder, never fewer than 1 week.

*Why:* the taper and the peak are fixed-cost, physiologically-determined structures — they do not scale with block length past a point, and a 5-week taper is wasted fitness. The ramp is the elastic part, so it absorbs the remainder.
*Covered by:* `periodization.test.ts` — "caps taper at 3 weeks and uses 2 peak weeks for long blocks", "degrades gracefully for short blocks".

### PZ-3 — A `maintain` block is flat
When `goal` is `"maintain"`, every week returns phase `"maintain"`, multiplier `1`, and `isDeload: false`. No ramp, no taper, no recovery weeks.

*Why:* maintain means "hold current fitness with no race to peak for". A ramp toward a peak that never arrives would just be an unrequested volume increase.
*Covered by:* `periodization.test.ts` — "is flat 1.0 every week".

### PZ-4 — The ramp is linear from 0.6 to full volume
Ramp week 1 prescribes `RAMP_START` (0.6) of peak, the final ramp week prescribes 1.0, and the weeks between interpolate linearly. A one-week ramp goes straight to 1.0.

*Why:* 0.6 rather than the source brief's 0.5 is a deliberate safety trade — see PZ-13. The linear shape is chosen for predictability over physiological fidelity: the athlete can read next week off this week.
*Covered by:* `periodization.test.ts` — "starts in base at the ramp-start fraction".

### PZ-5 — Base is the first half of the ramp, build the second
A ramp week at or below `ceil(rampWeeks / 2)` is phase `"base"`; the rest are `"build"`. The split changes labels and phase-keyed prescriptions (PZ-16, PZ-18); it does not change the multiplier.

*Why:* the volume curve through base and build is one continuous ramp — the distinction is about the *character* of the quality work, not the amount of it. Keeping it out of the multiplier is what lets PZ-4 stay a single straight line.
*Covered by:* `none`.

### PZ-6 — Peak weeks are full volume, exactly
Every peak week returns multiplier `1` and `isDeload: false`.

*Why:* peak is the definition of 1.0 — the anchors mean nothing otherwise.
*Covered by:* `periodization.test.ts` — "hits full volume at peak".

## Recovery and taper — PZ-7…11

### PZ-7 — The taper decays from 0.6 to 0.35, landing on race week
The first taper week prescribes `TAPER_START` (0.6), the last prescribes `TAPER_END` (0.35), with linear interpolation between. A single-week taper prescribes 0.35.

*Why:* the last taper week is race week, so the block must end at the lowest volume, not merely a lower one. A one-week taper collapses to the endpoint rather than the start for the same reason.
*Covered by:* `periodization.test.ts` — "tapers down into race week", "still ramps and tapers".

### PZ-8 — A deload lands on every Nth ramp week, never on week 1 and never immediately before peak
A ramp week is a deload when `w % deloadEvery === 0` and `w` is not the final ramp week. Deloads exist only inside the ramp — peak and taper weeks are never flagged.

*Why:* week 1 is already the lightest week of the ramp, so recovering from it is meaningless. The last ramp week is the hand-off into peak; dropping volume there and then jumping to 1.0 would create exactly the spike PZ-13 exists to prevent.
*Covered by:* `periodization.test.ts` — "inserts recovery deload weeks that dip below their neighbours".

### PZ-9 — A deload is a 25% cut against that week's own ramp value
On a deload week the multiplier is the ramp value for that week multiplied by `DELOAD_FACTOR` (0.75) — not a fixed low number.

*Why:* a fixed deload volume would be a rest week early in a long ramp and a hard week late in it. Scaling against the week's own load keeps the *relative* recovery constant, which is what the athlete actually feels.
*Covered by:* `periodization.test.ts` — "inserts recovery deload weeks that dip below their neighbours".

### PZ-10 — Novices recover every third ramp week, everyone else every fourth
`deloadCadenceForLevel` returns 3 for `"novice"` and 4 for `"intermediate"`, `"advanced"`, and null.

*Why:* a less-trained athlete accumulates fatigue faster than they clear it. Null falls to the 4-week default because a null level means "not a triathlon cycle" — there is nothing to be cautious on behalf of.
*Covered by:* `periodization.test.ts` — "recovers novices every 3rd week and others every 4th", "shifts where deload weeks land in the ramp".

### PZ-11 — A multiplier is clamped to [0.3, 1] and rounded to two decimals
No week ever prescribes above peak or below `MIN_MULTIPLIER` (0.3).

*Why:* the ceiling is what makes "peak" mean something. The floor is defensive only — the lowest value any current input can produce is 0.35 (taper end) or 0.45 (a deload on the first ramp week), so **`MIN_MULTIPLIER` is unreachable today**. It is kept as a guard against a future tunable change, not as live behaviour. Rounding to two decimals keeps the displayed percent and the stored target derivable from the same number.
*Covered by:* `periodization.test.ts` — "never exceeds peak and never collapses to zero".

## Bounds and the safety guardrail — PZ-12…13

### PZ-12 — Out-of-range weeks saturate rather than error
`totalWeeks` is floored at 1, and the requested week is floored and clamped into `[1, totalWeeks]`. Week 0 returns week 1; week 99 of a 12-week block returns week 12.

*Why:* the curve is called from render paths that must not throw. A saturating answer is always safe to display; an exception on a stale week number would blank the home screen.
*Covered by:* `periodization.test.ts` — "clamps out-of-range weeks".

### PZ-13 — No generated curve may spike uncoupled ACWR past 1.30
`uncoupledAcwr` divides each week's load by the mean of the up-to-three *preceding* weeks, excluding the current week from the denominator, and returns 1 for week 1. Every supported combination of block length and deload cadence must stay under 1.30, including the rebound week coming out of a deload.

*Why:* this is the constraint that set `RAMP_START` (PZ-4). At a 0.5 start the steepest supported block rebounds to ~1.37 out of a deload — above the injury-risk ceiling — so the floor was raised to 0.6 until the worst case fell to ~1.28. The conventional coupled formula is deliberately not used: including the current week in its own denominator damps exactly the spikes this is meant to catch.
*Covered by:* `periodization.test.ts` — "returns 1 for the first week and excludes the current week from the denominator", "keeps every generated build curve under the 1.30 ceiling, including out of deloads".

## Turning a multiplier into a target — PZ-14…15

### PZ-14 — A scaled distance rounds to a clean 100 m step, minimum 100 m
`scaledDistance(peak, multiplier)` rounds to the nearest 100 m and never returns less than 100 m.

*Why:* prescriptions are read, not computed against — "3,700 m" is a usable instruction and "3,684 m" is noise. The generator anchors its peaks on 100 m steps too, so a `maintain` week (multiplier 1.0) lands exactly back on the anchor rather than drifting.
*Covered by:* `none` directly; exercised via `triathlon-plan.test.ts` — "maintain anchors week 1 at the peak (flat)".

### PZ-15 — A scaled duration rounds to a clean 30 s step, minimum 30 s
`scaledDuration(peak, multiplier)` is the time-mode analogue of PZ-14.

*Why:* same reason at time-mode granularity. 30 s is the smallest step that still reads as a deliberate prescription.
*Covered by:* `periodization.test.ts` — "scales a peak duration by the multiplier, rounded to 30 s", "rounds to the nearest 30 s step", "never goes below 30 s".

## Phase prescriptions — PZ-16…17 (PZ-18, PZ-19 retired)

Volume is not the only thing that moves across a block. Two recipes change *what* a session asks for, keyed on phase.

### PZ-16 — The quality session's hard reps change zone and recovery by phase
`intervalPhaseRecipe` prescribes Z3/60 s in base, Z4/120 s in build, Z5/180 s in peak, Z4/150 s in taper, and Z4/120 s for maintain.

*Why:* running one intensity for a whole block wastes the block. Aerobic-tempo work in base builds the platform, threshold work in build raises it, VO₂ work in peak sharpens it, and the taper keeps the intensity but shortens the exposure. Maintain mirrors build because a flat block has no phase to progress through and threshold is the best single-intensity compromise.
*Covered by:* `periodization.test.ts` — "ramps the work-rep zone aerobic → threshold → VO₂ across the block".

### PZ-17 — Harder reps get longer recovery
Rest between work reps never decreases as the prescribed zone rises.

*Why:* the point of a hard rep is that it is hard. Cutting recovery as intensity rises converts an interval session into a tempo session at the exact phase where the distinction matters most.
*Covered by:* `periodization.test.ts` — "gives harder reps more recovery".

### PZ-18, PZ-19 — retired
These two rules described strength phase re-prescription. The mechanism was deleted rather than implemented; the reasoning is kept in [Strength periodization: considered, not implemented](#strength-periodization-considered-not-implemented). The numbers are retired rather than reused, so every other `PZ` reference keeps its meaning.

## Performance adaptation — PZ-20…25

`computeAdaptationFactor` is the no-wearable nudge: a small correction applied on top of the curve when recent behaviour says the athlete is ahead of or behind the plan. The first matching branch wins.

| Order | Condition | Percent |
|---|---|---|
| 1 | `adherence < 0.6` | 90 |
| 2 | `avgReadiness <= 2` (and not null) | 92 |
| 3 | `adherence >= 0.9`, readiness null or `>= 4`, RPE null or `<= 6` | 105 |
| 4 | otherwise | 100 |

### PZ-20 — The nudge scales the curve, it never replaces it
The percent multiplies the week's multiplier. Phase, deload flag, and taper shape are untouched.

*Why:* the curve encodes the block's structure and the ACWR guarantee of PZ-13. A signal-driven override could invalidate that guarantee silently; a tight band on top of it cannot.
*Covered by:* `periodization.test.ts` — "never moves beyond a tight ±band".

### PZ-21 — Missing more than 40% of last week's sessions eases the next week by 10%
*Why:* volume that was prescribed but not performed is not fitness. Ramping on top of a missed week compounds the gap into a spike — the athlete returns to a harder week than the one they could not complete.
*Covered by:* `periodization.test.ts` — "eases when behind on the plan".

### PZ-22 — Sustained low readiness eases the next week by 8%
Mean pre-workout readiness at or below 2 (of 5) triggers the ease, but only when readiness was actually rated.

*Why:* readiness is the only recovery signal available without a wearable. It is checked *after* adherence because a missed week is harder evidence than a self-report, and the two usually travel together.
*Covered by:* `periodization.test.ts` — "eases when readiness is low".

### PZ-23 — A complete, fresh, comfortable week earns 5% more
All three must hold: adherence at or above 0.9, readiness either unrated or at least 4, and RPE either unlogged or at most 6.

*Why:* the boost is the only branch that adds load outside the curve, so it demands agreement from every signal present. Unrated signals are permitted rather than required — an athlete who never touches the readiness picker should still be able to earn the nudge on adherence and effort alone.
*Covered by:* `periodization.test.ts` — "boosts on a strong, consistent, comfortable week".

### PZ-24 — No signal means no change
The neutral result is 100 with an empty note. A null readiness or RPE never satisfies an ease branch.

*Why:* the nudge must be safe to run on a user who logs nothing but sets. Treating absent data as bad data would ease every block belonging to someone who ignores the readiness prompt.
*Covered by:* `periodization.test.ts` — "stays neutral when there's no clear signal".

### PZ-25 — The nudge is skipped entirely before there is history
`computeCycleAdaptation` returns neutral without querying when the current week is 1, or when the cycle has no programs.

*Why:* on week 1 the seven-day lookback covers time before the block existed, so adherence would compute as 0 and every new cycle would open eased by 10% — punishing the athlete for not having started yet.
*Covered by:* `none`.

### PZ-26 — Adherence is completed sessions over scheduled slots, capped at 1
The denominator is the count of cycle slots carrying a program (rest slots excluded, repeated programs counted once per slot). The numerator is distinct completed sessions in the last seven days against those programs.

*Why:* counting slots rather than distinct programs is what makes a twice-a-week program count as two scheduled sessions. The cap keeps a double-logged day from manufacturing a boost.
*Covered by:* `none`.

## The weekly sync — PZ-27…35

`syncPeriodizedTargets` is where the curve becomes data.

### PZ-27 — The sync is the only writer of derived periodized targets
No other action writes `distanceMeters` or `durationSeconds` from a peak anchor.

*Why:* one writer is what makes the derivation auditable. Two writers with different rounding would make `distance_meters` disagree with `peak x curve` and there would be no way to tell which was right.
*Covered by:* `none`.

### PZ-28 — The sync runs at most once per cycle-week, triggered by `getActiveCycleForUser`
It fires when `lastSyncedWeek !== currentWeek` and stamps `lastSyncedWeek` at the end. The inequality is deliberate: a restarted cycle whose week number moves *backwards* re-syncs.

*Why:* the sync rewrites every periodized row in the cycle, so it must not run per request. `lastSyncedWeek` is the idempotency key, and it lives on the cycle rather than in a cache because the write it guards is persistent.
*Covered by:* `none`.

### PZ-29 — The sync is lazy: it happens on the first visit of a new week, not at the week boundary
Nothing runs on a schedule. Until the athlete opens a page that calls `getActiveCycleForUser` (`/`, `/new-workout`, or the workout page's insight query), the plan still shows the previous week's targets.

*Why:* the app has no scheduler, and adding one for a write that only matters when someone is looking would be a large amount of infrastructure for no user-visible gain. The consequence is accepted: the plan is correct from the moment it is read, not from midnight.
*Covered by:* `none`.

### PZ-30 — The sync selects sets by anchor
A row is rewritten only when it has a distance anchor or a duration anchor. Everything else in the cycle is left alone, `sessionRole` included: the role decides *what* is rewritten on a selected row (PZ-32), never *whether* the row is selected.

*Why:* the anchors are what identify a periodized set. Interval work reps carry an anchor anyway, so selecting on the role as well only ever admitted rows the strength branch wanted — and that branch is gone. Plyometric, core and strength accessories carry no anchor, so they stay constant across the block.
*Covered by:* `none`.

### PZ-31 — Both anchors scale independently when both are present
A distance anchor sets `distanceMeters`; a duration anchor sets `durationSeconds`. Neither clears the other.

*Why:* a set switched between distance and time mode carries exactly one anchor (PZ-37), so both being present means both were meant.
*Covered by:* `none`.

### PZ-32 — A `"work"` set takes its zone and rest from the interval recipe
*Why:* this is how PZ-16 reaches the athlete. The target zone and inter-rep rest are the prescription; rewriting them is what makes the quality session actually change character across the block.
*Covered by:* `none`.

### PZ-33 — retired
This rule was the delivery path for PZ-18 and is retired with it. `sessionRole = "strength"` never had a producer and the sync branch that read it has been deleted; see [Strength periodization: considered, not implemented](#strength-periodization-considered-not-implemented).

### PZ-34 — The stamp is written even when nothing else was
`lastSyncedWeek`, `adaptationPct`, and `adaptationNote` are updated unconditionally at the end of the sync, including for a cycle with no programs and no matching sets.

*Why:* without the stamp a non-periodized cycle would re-run the (empty) sync and the adaptation query on every single home-page render. The stamp is the marker that the week has been considered, not that rows were changed.
*Covered by:* `none`.

### PZ-35 — Writes are scoped through the cycle, not by a `userId` filter
The rows updated are reached by id from a query joined through `programExercises.programId in (the active cycle's slot programs)`, and that cycle was fetched under `eq(trainingCycles.userId, userId)`.

*Why:* worth stating because it looks like a violation of the repo's "filter by `userId`" rule ([../../CLAUDE.md](../../CLAUDE.md)) and is not. The ownership check happens once, at the cycle. A future reader should not "fix" this by adding a `userId` column filter to `program_sets` — there isn't one.
*Covered by:* `none`.

## Manual edits against the curve — PZ-36…37

### PZ-36 — The curve owns a periodized set's weekly target
An athlete who edits `distanceMeters` on an anchored set changes this week's number only. The next sync overwrites it from the anchor.

*Why:* the anchor is the prescription of record (PZ-1); a typed-in number for one week is not a change of intent about the block. See the Divergences table — whether this should be silent is unresolved.
*Covered by:* `none`.

### PZ-37 — Switching a periodized set between distance and time moves the anchor
When an anchored set's mode is switched, the entered value becomes the new anchor and the old anchor is cleared, so the set stays periodized in its new mode. An unanchored set gains no anchor from a mode switch.

*Why:* without this a set switched to time mode would keep a distance anchor the sync could no longer apply, silently dropping out of the block. Not anchoring ordinary sets keeps the periodized/not distinction an explicit property of the plan rather than something a mode toggle can create by accident.
*Covered by:* `none`.

## Reporting — PZ-38…43

### PZ-38 — A cycle with no distance anchor reports no periodization
`getCyclePeriodization` returns null when the cycle has no slots with programs, or when no set in those programs has a `peakDistanceMeters`. Callers render nothing rather than an empty summary.

*Why:* most cycles are ordinary weekly schedules with no block structure at all, and a "Week 3 of 12 · 80% of peak" header on one would be meaningless. See the Divergences table for the duration-anchored case this gate misses.
*Covered by:* `none`.

### PZ-39 — The reported week depends on cycle status
An active cycle's week is derived from `startDate` and clamped to the block length. A completed cycle reports its final week. Anything else (a draft) reports week 1.

*Why:* a draft has no start date, so week 1 is the only honest answer — and it doubles as a preview of what the block will open with. A completed cycle reports its last week rather than a week past the end so the detail page reads as a finished block rather than an overrun one.
*Covered by:* `none`.

### PZ-40 — The reported multiplier is the effective one
The percent shown is `curve x adaptationPct`, not the raw curve value.

*Why:* the displayed number has to match what is actually prescribed in the plan, or the athlete finds a set that disagrees with the header. The nudge is part of the prescription, so it is part of the number.
*Covered by:* `none`.

### PZ-41 — A program reports periodization only through an active cycle
`getProgramPeriodization` resolves the program to a slot in an *active* cycle owned by the session user, then defers to PZ-38. A program in a draft or completed cycle, or in none, reports null.

*Why:* the in-workout header describes the block being trained right now. A program that also appears in an old cycle would otherwise show a stale phase mid-workout.
*Covered by:* `none`.

### PZ-42 — The summary answers the most immediate question first
Headline is always phase, deload marker, and week position. The note follows a fixed precedence: maintain, then weeks-until-peak, then weeks-until-taper, then tapering, then at-peak. Week units singularize at 1.

*Why:* the athlete's question changes as the block progresses — early it is "how long until this gets serious", at peak it is "how long until it eases". A single fixed sentence would answer neither well. The phrasing is shared by the cycle detail page and the in-workout header so the two never disagree.
*Covered by:* `periodization.test.ts` — "describes a ramping build week with weeks-until-peak and percent", "flags deload weeks in the headline", "singularizes the week unit when peak is one week away", "announces taper countdown once at peak", "describes the taper phase", "holds steady for maintain goal".

### PZ-43 — An adaptation note is appended to the summary, never substituted for it
When the last sync recorded a nudge, its human reason is appended to the note. A neutral nudge stores null and appends nothing.

*Why:* the nudge explains a discrepancy the athlete would otherwise have to guess at — why this week reads 85% when the curve says 80%. It is an addendum because the block's own state is still the headline.
*Covered by:* `periodization.test.ts` — "appends the no-wearable adaptation note when present".

## Cycle end — PZ-44

### PZ-44 — A cycle past its end date auto-completes on the next read
`getActiveCycleForUser` marks the cycle completed and returns null, without a `revalidatePath` — it runs during Server Component render, where revalidation is not allowed, and the caller already sees the post-update result.

*Why:* the app has no scheduler (PZ-29), so "the block is over" has to be discovered on read like everything else. Returning null in the same call keeps the home screen from rendering one last frame of a finished cycle.
*Covered by:* `none`.

## Strength periodization: considered, not implemented

Retired rules PZ-18, PZ-19 and PZ-33 described a strength block whose reps and rest moved by phase, delivered by a *strengthPhaseRecipe* helper in `periodization.ts` and a `sessionRole = "strength"` branch in `syncPeriodizedTargets`. Both were deleted, along with the tag, on 2026-08-29. Nothing ever wrote the tag, so the branch never ran; and rep targets now belong to the progression engine outright, which cannot share the column with a second writer (`docs/progression-revamp-plan.md`, decision `D-6`).

The research behind the design is worth more than the code was, so it is recorded here rather than lost with the function.

**The prescription it would have written**, per phase, for a triathlete's main barbell lifts:

| Phase | Reps | Rest | Intent |
|---|---|---|---|
| base | 12 | 90 s | Anatomical adaptation |
| build | 5 | 180 s | Max strength |
| peak | 4 | 180 s | Strength-power |
| taper | 3 | 180 s | Sharpen — hold intensity, cut volume |
| maintain | 6 | 150 s | Maintenance |

**Why that shape.** Endurance athletes gain running and cycling economy from heavy, low-rep max-strength work rather than from strength-endurance circuits (Rønnestad & Mujika 2014, *Optimizing strength training for running and cycling endurance performance*; Beattie et al. 2017, *The effect of strength training on performance indicators in distance runners*). Arriving at heavy triples cold injures people, so the block opens with an anatomical-adaptation base at moderate load and higher reps, and reps fall as rest lengthens. The taper cuts volume (3 reps) while holding intensity (180 s rest), which preserves the neuromuscular adaptation without adding fatigue. Load stays athlete-entered throughout: the rep target *is* the intensity prescription, which self-calibrates without the app needing a 1RM.

**Why it is not implemented.** The triathlon generator makes the opposite choice deliberately, and its reasoning supersedes the above for this app's use: strength runs flat, in fixed rep ranges with an RIR cap, with no phase re-prescription and no top-set pyramiding, *to spare the CNS so the endurance quality sessions are not compromised* (`src/lib/utils/triathlon-plan.ts`). Three hard endurance sessions and three strength sessions in one week is already the constraint; adding a heavy-triples phase on top of it spends recovery the swim, bike and run need. The economy stimulus is taken at a fixed rep target instead.

Reviving this means resolving the `target_reps` ownership question first, not just restoring the function.

## Divergences (intent vs code)

Verified against `periodization.ts`, `training-cycles.ts`, `page.tsx` and `SetEditView.tsx` at `91c1646` on 2026-08-25. D1 and D2 were confirmed by executing the week arithmetic under three timezones.

| # | Rule | Intended | Actual | Status |
|---|---|---|---|---|
| D1 | PZ-39 | The reported week of an active cycle is between 1 and the block length | `startDate` is a `date` column read as a `YYYY-MM-DD` string, so `new Date(startDate)` is **UTC midnight** while `today` is **local midnight**. In any timezone ahead of UTC the difference is negative on the block's own start date: `currentWeek` computes as **0** and every later week boundary lands a day late. `getActiveCycleForUser` does not clamp (`training-cycles.ts:168`), so `/` renders "Week 0/24" and its progress bar computes to −4.2% (`page.tsx:105` clamps only the upper bound); `/new-workout` shows the same 0. `getCyclePeriodization` *does* clamp (`:411`) and `CyclesListClient` measures from the current instant rather than local midnight, so both say "Week 1" on that day — three screens, two answers | open |
| D2 | PZ-2, PZ-39 | The last day of a block is the last day inside it | Same root cause at the other end. Auto-completion fires only on `today > endDate` (`:157`), and `endDate` derives from the same UTC-parsed start. Under `TZ=UTC` a 24-week block admits a 169th day on which `currentWeek` is **25**, unclamped — `/` renders "Week 25/24" and the sync stamps `lastSyncedWeek = 25`. Timezones behind UTC complete a day earlier and never show it | open |
| D3 | PZ-33 | Main strength lifts periodize their reps and rest by phase | **Closed 2026-08-29** by deleting the mechanism rather than building a producer for it. The *strengthPhaseRecipe* helper, the `sessionRole = "strength"` branch in `syncPeriodizedTargets` and both stale docblocks are gone; rules PZ-18, PZ-19 and PZ-33 are retired and the reasoning is preserved above. Strength is flat for the whole block, which is what the generator already built and its tests already asserted | closed |
| D4 | PZ-29, PZ-40 | What a page shows for a week matches what the plan holds for that week | On the first visit of a new cycle-week the workout page's `Promise.all` (`programs/[id]/workout/page.tsx:28`) starts `getProgramWithExercises` — reading `program_sets` — concurrently with `getWorkoutInsight`, whose nested `getActiveCycleForUser` performs the sync. The render shows last week's targets under this week's header. `/cycles/[id]` never triggers a sync at all, so it can report a new week's phase against the previous week's `adaptationPct`. Both self-correct on the next load | open |
| D5 | PZ-38 | A periodized cycle reports its periodization | The gate queries `peakDistanceMeters` only (`training-cycles.ts:398`), while the sync selects on either anchor (`:576-577`). A cycle whose sets have all been switched to time mode (PZ-37) keeps being synced from its duration anchors but reports null, so the cycle page and the in-workout header silently lose their summary | open |
| D6 | PZ-28 | Changing the block's shape re-derives its targets | `updateTrainingCycle` can change `durationWeeks` — which changes `phaseLayout`, and therefore every week's multiplier and phase — without clearing `lastSyncedWeek` (`:689-693`). The old week's targets stand until the next week boundary | open |
| D7 | PZ-2 | Every block length the generator can produce can be edited | `createTrainingCycleSchema` and `updateTrainingCycleSchema` accept only 4, 6, 8, 10, 12, 16 weeks, but the generator's `ALLOWED_WEEKS` (`triathlon-plan.ts:100`) also permits 24, 36 and 52. A 24-week block can be generated and then never have its duration edited — the action returns "Invalid input" | open |
| D8 | PZ-36 | Undecided | Editing an anchored set's distance *in distance mode* writes the value but leaves the anchor (`SetEditView.tsx:250-253`), so the next sync reverts it silently — while a **mode switch** on the same set does re-anchor (`:256`). Whether a direct edit should re-anchor, warn, or revert silently has never been decided | open — intent needed |

Seven remain open and are tracked in `BACKLOG.md` under **Cycle periodization (spec divergences)**, one entry per row except D1–D2, which share a root cause and a fix. D3 is closed. D8 needs an intent decision before any code change — the spec cannot state a rule for it until then.

Already tracked in `BACKLOG.md` rather than repeated here: the absence of objective recovery signals feeding PZ-20…24 (§ New features — "Wearable-based autoregulation (Tier B) for triathlon plans").

## Coverage

| Rule | Covered by |
|---|---|
| PZ-1 | `triathlon-plan.test.ts` — "peak-anchors endurance sets and scales week 1 below peak for a build" |
| PZ-2 | `periodization.test.ts` — "caps taper at 3 weeks and uses 2 peak weeks for long blocks", "degrades gracefully for short blocks" |
| PZ-3 | `periodization.test.ts` — "is flat 1.0 every week" |
| PZ-4 | `periodization.test.ts` — "starts in base at the ramp-start fraction" |
| PZ-5 | none |
| PZ-6 | `periodization.test.ts` — "hits full volume at peak" |
| PZ-7 | `periodization.test.ts` — "tapers down into race week", "still ramps and tapers" |
| PZ-8 | `periodization.test.ts` — "inserts recovery deload weeks that dip below their neighbours" |
| PZ-9 | `periodization.test.ts` — "inserts recovery deload weeks that dip below their neighbours" |
| PZ-10 | `periodization.test.ts` — "recovers novices every 3rd week and others every 4th", "shifts where deload weeks land in the ramp" |
| PZ-11 | `periodization.test.ts` — "never exceeds peak and never collapses to zero" |
| PZ-12 | `periodization.test.ts` — "clamps out-of-range weeks" |
| PZ-13 | `periodization.test.ts` — "returns 1 for the first week and excludes the current week from the denominator", "keeps every generated build curve under the 1.30 ceiling, including out of deloads" |
| PZ-14 | none (indirect: `triathlon-plan.test.ts` — "maintain anchors week 1 at the peak (flat)") |
| PZ-15 | `periodization.test.ts` — "scales a peak duration by the multiplier, rounded to 30 s", "rounds to the nearest 30 s step", "never goes below 30 s" |
| PZ-16 | `periodization.test.ts` — "ramps the work-rep zone aerobic → threshold → VO₂ across the block" |
| PZ-17 | `periodization.test.ts` — "gives harder reps more recovery" |
| PZ-18 | retired |
| PZ-19 | retired |
| PZ-20 | `periodization.test.ts` — "never moves beyond a tight ±band" |
| PZ-21 | `periodization.test.ts` — "eases when behind on the plan" |
| PZ-22 | `periodization.test.ts` — "eases when readiness is low" |
| PZ-23 | `periodization.test.ts` — "boosts on a strong, consistent, comfortable week" |
| PZ-24 | `periodization.test.ts` — "stays neutral when there's no clear signal" |
| PZ-25 | none |
| PZ-26 | none |
| PZ-27 | none |
| PZ-28 | none |
| PZ-29 | none |
| PZ-30 | none |
| PZ-31 | none |
| PZ-32 | none |
| PZ-33 | retired |
| PZ-34 | none |
| PZ-35 | none |
| PZ-36 | none |
| PZ-37 | none |
| PZ-38 | none |
| PZ-39 | none |
| PZ-40 | none |
| PZ-41 | none |
| PZ-42 | `periodization.test.ts` — "describes a ramping build week with weeks-until-peak and percent", "flags deload weeks in the headline", "singularizes the week unit when peak is one week away", "announces taper countdown once at peak", "describes the taper phase", "holds steady for maintain goal" |
| PZ-43 | `periodization.test.ts` — "appends the no-wearable adaptation note when present" |
| PZ-44 | none |

The pure curve (PZ-1…24, PZ-42, PZ-43) is well covered. **Everything the sync and the reporting actions do — PZ-25…41 and PZ-44, the entire write path — has no test at all.** Four of the seven divergences above live in that untested region, which is not a coincidence.
