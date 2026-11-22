# Strict session targets

Build brief, agreed with the owner on 2026-11-22. Pictures:
[`docs/design/strict-targets/plan.html`](../design/strict-targets/plan.html) (open it in a browser).
Build to the pictures.

## What

Each bike and run work step names the exact point to hit, for each place the session can be done
(inside and outside), using what can be measured there. The AI coach works out the athlete's numbers
from Garmin data and proposes them; the user accepts or declines in the app. The app shows every
target on the ride screen, the run screen and the step lists.

## Decisions (settled, do not re-ask)

1. **Targets by place.**

   | | Main target | Required with it | Shown, not a target |
   |---|---|---|---|
   | Bike inside | Power (W) | Heart rate, cadence (rpm) | Time |
   | Bike outside | Heart rate | Time or distance (the step's length) | Power when a meter is paired |
   | Run inside (treadmill) | Belt speed (km/h) | Heart rate, cadence (spm), incline | Time, distance |
   | Run outside | Heart rate | Time or distance (the step's length) | Planned pace, cadence |

   The app has no live GPS or sensor link during a session. "Shown" means the planned value, never
   a live reading.
2. **Required on work steps only**, for both places at once:
   - Bike work step: a power target, a heart rate target (`target` or `target2`), and `cadence`.
   - Run work step: `beltKmh`, a heart rate target (`target` or `target2`), and `cadence`.
   - Warm-up, cool-down, recovery and rest keep needing one target, as now.
   - Exempt: ramps, free steps, the steps of a test ride or run (FTP ramp and 20 min, run 30 min),
     outside work under 3 minutes (keeps an effort target), and the easy brick run.
3. **The rule is a new-write check, not part of `parseWorkout`.** `parseWorkout` also reads every
   stored program; old programs must keep loading, sharing, copying and taking small edits. The check
   runs where a step is written from new input: MCP `edit_program_exercise` (sets and tree input) and
   the app's `saveExerciseSteps` / step editor. The step editor shows what is missing before save.
4. **Run cadence is in steps per minute (spm)**, bike cadence in rpm. Fix the run messages that say
   "rpm" (`src/lib/utils/workout-steps.ts`).
5. **The coach proposes, the user accepts.** A proposal holds a threshold kind, a value, a one-line
   reason and the evidence (dates, activity ids, numbers). Accept writes it as a threshold with source
   `coach`; decline closes it. Nothing changes without the user's yes. `manage_thresholds` stays for a
   value the user states in the chat ("set my FTP to 190"); the coach instructions say to propose
   estimates instead.
6. **Two new threshold kinds:** typical bike cadence (rpm) and typical run cadence (spm). The coach
   sets each step's cadence range from them.
7. **Treadmill speeds** per zone come from the belt speeds the app logged and the heart rate on them,
   not from the watch's indoor speed. The coach writes them into steps as `beltKmh`.
8. Run cadence outside: shown on the second line when the step has it, not required.
9. Proposals show in Account › Thresholds, with a dot on the Account row while one is open. Not on
   the home screen.
10. "Sync from Garmin" keeps working as now (it writes Garmin values without asking when it is on).
11. Garmin data for the coach (admin and Premium only, as now): add average cadence to activities and
    laps (run cadence doubled: FIT stores it per foot), so the coach can estimate typical cadence.

## Work, in order (one PR each)

1. **Show all targets** (display only).
   - Ride screen (`src/lib/utils/ride-screen.ts`, `RideMode.tsx`): inside, big power and a second line
     with HR and cadence; outside, big heart rate (from `target2` HR, the outdoor HR target, or the
     zone), second line with the zone word and power-meter watts when present. No cadence outside.
   - Bike step list (`bikeStepRows` in `src/lib/utils/bike-ride-view.ts`): inside, detail shows zone,
     HR and cadence; outside, HR leads.
   - Run screen (`src/lib/utils/run-screen.ts`) and list (`runStepRows`, `treadmillText`,
     `runOutdoorText` in `src/lib/utils/run-view.ts`): treadmill big target is the belt in km/h, second
     line HR, cadence (spm) and incline; outside, heart rate leads for steps of 3 min or more, second
     line shows the planned pace and cadence when present.
   - Chart: `timeTicks` drops the last minute tick when its label would touch the end label
     ("120" and "135 min" read "1235 min"); the same in `src/lib/utils/ride-stream.ts` and
     `src/lib/utils/run-stream.ts`.
2. **Strict work steps.** The check from decisions 2 and 3, the spm wording, a heart rate field
   (`target2`) in the step editor for bike and run work steps, and `docs/mcp/workout-steps.md` plus the
   MCP instructions updated.
3. **Coach proposals.** Table, migration, actions, MCP tool to propose, Garmin cadence in the MCP reads,
   the Accept and Decline card, the dot on Account, the two new threshold kinds, source `coach`, and the
   privacy inventory and policy (use the `privacy-compliance` skill).
4. **The owner's programs.** A coach task over MCP after 1-3 are live: read the data, propose, and after
   the owner accepts, rewrite the bike and run work steps. Not code.

## Tests

- Unit: target text per place, the new-write check (each exemption), `timeTicks` at 135 min.
- Component: the step editor's HR field and its missing-target message; the proposal card.
- Integration: propose, accept (threshold row with source `coach`), decline, only own rows; MCP edit
  refused without the required targets; an old program without them still loads and copies.
- e2e: the ride and run pre-start lists show HR and cadence.
- Journey review at 390 and 320 px for the ride and run screens.

## Out of scope

Live sensors or GPS in the app, swim steps, a home screen card.
