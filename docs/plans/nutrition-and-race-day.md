# Nutrition and race-day plan (packages E1, E2)

Brief for packages E1 and E2 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). Written
2026-11-13. Build to it with no conversation history. The open questions are settled: see
section 12.

Inputs: the plan (sections 1-6), the audit (`docs/triathlon-coach-audit.md`, sections 6 and 9,
decisions D1-D23, T1-T10), and the research
(`docs/research/endurance-training-reference.md`, "Fueling is trained like a fourth discipline",
the bike race target table, and the half-distance appendix). E3 (watch delivery) is parked
(D13): nothing here depends on a delivery route. Names marked *new* do not exist yet.

## Medical safety framing (applies to every section)

- Every hydration, sodium, caffeine and carbohydrate number the app shows carries its evidence
  label from the research and the line "A guide from published research, not medical advice.
  Test it in training." (`NUTRITION_DISCLAIMER` *new*). The app never shows such a number
  without its label.
- The app never prescribes beyond the research: no target above 90 g/h without a proved gut
  tolerance above 90, fluid never above the measured sweat rate, sodium inside the research
  band, caffeine at most 6 mg/kg. Inputs that would give more are clamped and the view says
  why.
- Fluid guidance always repeats "Never drink more than you sweat. Too much fluid, not too little
  sodium, causes hyponatremia." A body-mass gain in a sweat test shows a red-flag line.
- No daily food tracking (audit section 6: out of scope).

## 1. Findings in the code

- Fuel logs exist only for Garmin activities. `garminFuelLogs`
  (`src/db/schema/garmin.ts:218-230`) stores `carbs_g` and `fluid_ml` per
  `garmin_activity_id`, no sodium, no products, no GI score. Migration
  `drizzle/0075_calm_cable.sql`.
- The only writer was a Garmin Server Action in `src/lib/actions/garmin.ts` that checked only
  that the activity was the user's. E1 removed it; `saveFuelLogAction` in
  `src/lib/actions/nutrition.ts` replaces it. The card
  shows on the activity page for sessions of an hour or more (`FUEL_MIN_S`,
  `src/components/features/GarminActivityView.tsx:80`).
- Garmin data delete removes fuel logs (`src/lib/garmin/delete-data.ts:30`); export includes
  them (`src/lib/account-data.ts:135`).
- `sweatModel` (`src/lib/garmin/analytics/race.ts:94`) fits Garmin's sweat estimate against
  watch temperature after `FUEL_MIN_SESSIONS` sessions. It is an estimate, not a weighed test.
- `PACING` (`src/lib/garmin/analytics/race.ts:24-27`) sets half bike 75-82 % FTP and run
  85-90 % of critical speed. The research appendix says half IF 0.75-0.85 in general but
  0.70-0.75 for a first-timer, and gives no run-pace share. The run shares are not in the
  research (decision 3).
- Races live on `seasonRaces` (`src/db/schema/seasons.ts:51-70`) with `distance` from
  `TRI_DISTANCES` (full, half, olympic, sprint) and `priority` A/B/C.
- Thresholds live in `athleteThresholds` with kinds `THRESHOLD_KINDS`
  (`src/db/schema/athlete-profile.ts:27`): ftp, lthr_bike, lthr_run, run_threshold_pace,
  swim_css, max_hr.
- Consent rule: `CONSENT_VERSION` is raised only for a new kind of health data
  (`src/lib/constants/legal.ts:8-17`).

## 2. Rules (pure: `src/lib/utils/fueling.ts` *new*, `src/lib/utils/race-plan.ts` *new*)

Each rule cites the research section and keeps its label in code and in the UI.

### 2.1 Carbs per hour by session length (`carbTarget` *new*)

| Session | Target | Label |
|---|---|---|
| Under 90 min | Water only is fine; no target | Coach convention |
| 90 min to 2 h | Optional; practise if it is a key session | Coach convention |
| Over 2 h (long ride, long brick, long run over 90 min, race simulation) | Practise race fueling with race products | Coach convention |
| Untrained gut | Bike 60-80 g/h, run 50-70 g/h, 2:1 glucose:fructose | Consensus plus study; split is inference |
| Over about 2.5 h, gut proved at 90 g/h | Up to 90 g/h | Consensus |
| Above 90 g/h | Only when proved tolerance is above 90; about 1:0.8; no clear performance gain | Study plus inference |

The ceiling shown is 90 g/h unless the athlete's proved tolerance (2.2) is higher.

### 2.2 Gut-training progress (`gutTraining` *new*)

- Proved tolerance = the highest carbs/h in a fuel log of a session of 90 min or more with a GI
  score under 4 (0 = no symptoms, 10 = worst). A log with no GI score does not count.
- Next step = proved + 10 g/h, every 1-2 weeks, 2-3 long sessions a week (Coach convention plus
  inference); never above 90 unless proved is already above 90. With no proved value the start
  is 60 g/h (bottom of the consensus band).
- Last fueled log had GI 4 or more: hold, or step back 10 g/h (Inference).
- Race target = 80 % of proved tolerance (Coach convention), rounded to 5 g, and never above
  the 2.1 ceiling.

### 2.3 Sweat-rate test (`sweatRate` *new*)

- Sweat rate (ml/h) = (pre g - post g + fluid ml - urine ml) / hours, with 1 kg = 1,000 ml
  (Inference from the consensus method). Nude weight, about 60 min at race effort, race-like
  heat; repeat in 2-3 temperatures.
- Body-mass change % = (post - pre) / pre x 100. A gain is a red flag for over-drinking (Study).
  1-3 % loss by the finish is normal (Consensus plus inference).
- Refused as a likely typo: duration under 30 or over 240 min, weights outside 30-250 kg, a
  weight change above 5 % of body mass, or a sweat rate under 0 or over 4,000 ml/h.

### 2.4 Fluid, sodium and caffeine (`fluidPlan`, `sodiumPlan`, `caffeinePlan` *new*)

- Fluid/h = 50-80 % of the measured sweat rate, rounded to 50 ml, never above the sweat rate
  (Consensus plus inference). With no test: 400-900 ml/h, labelled, and a prompt to do a test.
  The test nearest the race temperature is used when the plan has one; else the newest.
- Sodium: 300-600 mg/h default, or 500-1,000 mg per litre drunk (Consensus for the variation,
  inference for the doses). With a lab sweat sodium value (mg/L): sodium/h = fluid/h x
  concentration, clamped to 300-1,000 mg/h, with "more for salty sweaters in heat; ask a
  professional" when the clamp hits. The app never shows more than 1,000 mg/h.
- Caffeine (opt-in per race plan): about 3 mg/kg before the start or early bike, plus 1-3 mg/kg
  late, total 3-6 mg/kg (Consensus plus inference), from the latest body weight. No body
  weight: no caffeine numbers.

### 2.5 Pacing per leg (`legPacing` *new*)

- Bike: IF_target = sqrt(TSS_cap / (100 x bike hours)) (Coach convention; the rearrangement is
  inference). TSS_cap: full 250-300, half 170-180. Clamp: full 0.65-0.75 general, 0.65-0.70
  first-timer; half 0.75-0.85 general, 0.70-0.75 first-timer. "First-timer" = athlete profile
  `enduranceLevel` novice, or no level. Watts = IF x FTP. Bike hours come from the leg time
  (2.6); the plan iterates once (speed at the IF band is not known, so the user's bike time
  is the input). A guide, never a finish prediction.
- Run: the research gives no run-off-the-bike pace share. The plan shows an HR ceiling at
  85 % of run LTHR (the app's low-band top, under the research's VT1 estimate of about 89 %;
  Inference) and, when a run threshold pace exists,
  a guide pace band at 80-85 % (full) or 85-90 % (half) of threshold speed, labelled
  "Inference; not in the research reference". The same numbers the Garmin race page uses
  today, now in one shared rule (decision 3).
- Swim: no race swim pace rule in the research. CSS pace plus a user offset per 100 m
  (default +5 s/100 m, Inference).
- A missing threshold shows "Add your FTP / threshold pace / CSS" and no number.

### 2.6 Timeline and fuel schedule (`raceTimeline`, `fuelSchedule` *new*)

- Leg distances: full 3.8/180/42.2 km, half 1.9/90/21.1 km (`seasons.ts`). Olympic and sprint
  are refused for now (decision 6).
- Leg time: the user's override, else from the pacing guide (swim from CSS pace with the offset;
  run from the middle of the guide pace band), else a default speed (swim 2:10/100 m, bike
  28 km/h, run 6:30/km; Inference, shown as "assumed"). Transitions: user minutes, default
  T1 5 and T2 3 (half), T1 8 and T2 5 (full) (Inference).
- Timeline: start time (HH:MM), then swim, T1, bike, T2, run with clock times, as plain strings
  (no `Intl`, no `toLocale*`).
- Fuel schedule: every 15 or 20 min (user pick, default 20) on the bike and run, none in the
  swim. Each row: clock time, leg, grams (rate x interval), fluid ml, sodium mg. Bike rate =
  race target from 2.2 clamped to the bike band; run rate = 10 g/h lower, at least 50 (the run
  band is 50-70, Consensus plus study; the split is inference). Totals per leg and per hour.
- Race morning: 1-3 g/kg carbs 2-3 h before the start; the two days before: 8-12 g/kg/day, low
  fibre (Consensus), with grams from the latest body weight.

## 3. Data model (migration `drizzle/0089_nutrition_race_plans.sql`)

- `fuel_products` *new*: id, user_id (cascade), name, carbs_g, sodium_mg, caffeine_mg,
  fluid_ml (a drink's volume), created_at, updated_at. Logged data, not revisioned; a hard
  delete is safe because a log keeps the product's numbers in its items.
- `fuel_logs` *new*: id, user_id (cascade), workout_session_id (cascade, nullable),
  garmin_activity_id (bigint, nullable), a check that exactly one is set, unique per user and
  link, duration_s (the session's moving time, stored at save so per-hour numbers stay stable),
  carbs_g, fluid_ml, sodium_mg, caffeine_mg, gi_score 0-10, items jsonb
  (`[{ productId, name, count, carbsG, sodiumMg, caffeineMg, fluidMl }]`), notes, created_at,
  updated_at. With items, the totals are their sum unless typed. Logged data: no revisions.
- `sweat_tests` *new*: id, user_id (cascade), tested_on, duration_s, pre_kg, post_kg, fluid_ml,
  urine_ml, temperature_c, sport, sweat_sodium_mg_l, notes, created_at. Logged data.
- `race_plans` *new*: id, user_id (cascade), season_race_id (cascade, unique), plan jsonb
  (`racePlanInput` *new* Zod schema: startTime, leg time overrides, T1, T2, swim offset, fuel
  interval, caffeine on/off, race temperature, notes), version, deleted_at, created_at,
  updated_at. Plan data: object type `race_plan` in the revision layer (T5), version check (T9).
- `garmin_fuel_logs` stays one release, unread and unwritten. The migration copies its rows into
  `fuel_logs` with duration from the activity summary.

Field owners: fuel logs, products and sweat tests: the user or the assistant (logged data,
last write wins). Race plan inputs: user or assistant through revisions. Computed targets are
never stored.

## 4. Race plan from the season's A race

- The race plan page opens from a triathlon race on the season (half or full). The season page
  shows "Race plan" on those race rows. The MCP read defaults to the next A race.
- Built on read from: the race, current thresholds, the athlete profile level, the latest body
  weight, the sweat tests, the fuel logs (gut tolerance) and the stored inputs. A retest updates
  the plan at once.
- A plan with no stored row reads as defaults; the first save creates the row.
- A race date change keeps the plan (keyed to the race id). A deleted race deletes the plan
  (cascade); its revisions stay until retention removes them.

## 5. Units (A2)

Storage metric. Display uses the user's units setting: km/mi and pace per km or mile; swim per
100 m or 100 yd. Fluid in ml, carbs in g, sodium in mg, weight in kg (lb is in BACKLOG).

## 6. Views (behind the endurance switch, D18; all work without Garmin)

- **Nutrition** (`/more/nutrition` *new*, a More entry after Workouts):
  1. Header line with `NUTRITION_DISCLAIMER`.
  2. Gut training: proved g/h (or "no fueled session with a GI score yet"), next step, race
     target, each with its label.
  3. Fluid and sodium: per hour from the newest sweat test, or the default band and "Do a sweat
     test".
  4. Log fuel: the completed sessions of the last 14 days with 60 min or more of endurance sets,
     each with its log or "Add". Tap opens the fuel form.
  5. Sweat tests: list and "Add test" form (pre, post, fluid, urine, minutes, temperature, sport,
     optional sodium mg/L) with the result and red flags.
  6. Products: list with add, edit, delete.
- **Fuel form** (bottom sheet, also on the Garmin activity page, replacing the old card's
  fields): products with +/- counts, or typed totals (carbs g, fluid ml, sodium mg, caffeine
  mg), GI score 0-10 as a row of buttons, notes. Saves with `callAction()`.
- **Race plan** (`/races/[id]/plan` *new*): race name and date, a timeline table, per-leg cards
  (swim pace, bike watts and IF, run HR ceiling and guide pace, each with its label), the fuel
  schedule table, race morning, the safety lines, and an Edit sheet for the inputs. Shows
  "Race plans cover half and full distance for now" for other distances.
- The Garmin race page keeps `sweatModel` as "Garmin estimate", reading carbs and fluid from
  `fuel_logs`.

## 7. Privacy

- GI scores and sweat tests are a new kind of health data. `CONSENT_VERSION` and
  `LEGAL_VERSION` rise (decision 2), the policy names them, the data inventory gets rows for the
  four tables.
- Every new table in `collectUserData`, cascade on user delete, never shown to friends.
- Garmin delete keeps deleting the Garmin-linked fuel logs (as today), and now also leaves the
  app-session logs alone.
- MCP: assistants read and write these; the consent page names nutrition and sweat tests.
- Logs carry ids and short tags only.

## 8. MCP tools (registered only with the endurance switch on)

All writes need `reason`. Logged data (fuel, tests, products) has no version; the race plan
needs `expectedVersion` once it exists.

- `get_nutrition` (read): `{ days?: 1-90 = 28 }`. Returns the rules with labels, the
  disclaimer, gut training, fluid and sodium, recent fuel logs, sweat tests and products.
- `log_fuel` (write): `{ workoutSessionId? | garminActivityId?, carbsG?, fluidMl?, sodiumMg?,
  caffeineMg?, giScore?: 0-10, items?: [{ productId, count }], notes?, clear?: boolean, reason }`.
  Exactly one link; `garminActivityId` only where Garmin is allowed.
- `manage_sweat_tests` (write): `{ operation: add | delete, id?, testedOn?, durationMinutes,
  preKg, postKg, fluidMl, urineMl?, temperatureC?, sport?, sweatSodiumMgL?, notes?, reason }`.
- `manage_fuel_products` (write): `{ operation: add | update | delete, id?, name?, carbsG?,
  sodiumMg?, caffeineMg?, fluidMl?, reason }`. At most 100 products.
- `get_race_plan` (read): `{ raceId? }` (default: next A race). Returns the inputs with their
  version, timeline, pacing, fuel schedule, race morning, labels and disclaimer.
- `update_race_plan` (write): `{ raceId, startTime?, swimMinutes?, bikeMinutes?, runMinutes?,
  t1Minutes?, t2Minutes?, swimOffsetSecondsPer100m?, fuelIntervalMinutes?: 15 | 20,
  caffeine?, raceTemperatureC?, notes?, reason, expectedVersion? }`. A null clears a field.
- Server instructions: the numbers are guides with labels; pass the not-medical-advice line on.

## 9. Migration and rollback

- `0089`: create the four tables, then
  `INSERT INTO fuel_logs (user_id, garmin_activity_id, duration_s, carbs_g, fluid_ml, ...)
  SELECT ... FROM garmin_fuel_logs LEFT JOIN garmin_activities ...` with
  `ON CONFLICT DO NOTHING`. `garmin_fuel_logs` stays.
- Rollback: deploy the previous image and run `DROP TABLE race_plans, sweat_tests, fuel_logs,
  fuel_products;` and remove the journal entry. Entries made after the deploy (new fuel logs,
  sweat tests, products, race plans and their `race_plan` revisions:
  `DELETE FROM plan_revisions WHERE object_type = 'race_plan'`) are lost. Garmin fuel logs
  made before the deploy are safe in the old table; Garmin logs written after the deploy are
  lost.
- Next release: drop `garmin_fuel_logs` (BACKLOG entry).

## 10. Lifter risk

None. New tables and pages behind the endurance switch. No critical flow changes. The consent
bump sends every user to the consent screen once.

## 11. Tests per layer

- Unit `src/__tests__/fueling.test.ts` *new*: carb bands at 89/90/120/121/150 min, gut-training
  tolerance (GI 3 counts, GI 4 does not, no GI does not, under 90 min does not), next step and
  hold, race target 80 % and ceiling, sweat rate maths, refusals, mass gain flag, fluid never
  above the sweat rate, sodium clamp, caffeine bounds.
- Unit `src/__tests__/race-plan.test.ts` *new*: IF formula and clamps (full, half,
  first-timer), missing thresholds, leg times, timeline clock strings across midnight, fuel
  schedule rows and totals, olympic refused.
- Integration `src/__tests__/integration/nutrition.test.ts` *new*: every Server Action and MCP
  tool, ownership (another user's session, activity, product, race), the endurance gate, the
  version conflict and the revision on `update_race_plan`, restore of a race plan, export and
  delete coverage, and the migration copy of Garmin fuel logs.
- Component `src/__tests__/components/fuel-form.test.tsx` *new*: product counts sum, GI buttons,
  a failed save keeps the input.
- e2e `e2e/nutrition-race-plan.spec.ts` *new*: log fuel for a session, then open a race plan,
  edit it, and check the stored rows with `testDb()`.

## 12. Decisions

Question 2 by the owner, 2026-11-13. The rest decided by the hub on 2026-11-13 from this brief's
recommendations; the owner may change them.

1. **Move `garmin_fuel_logs` into `fuel_logs`.** Copy the rows in the migration, keep the old
   table one release for rollback, then drop it.
2. **Raise `CONSENT_VERSION` for GI scores and sweat tests** (owner). A new kind of health data,
   per the rule in `src/lib/constants/legal.ts`.
3. **Run pacing.** HR ceiling plus a guide pace labelled Inference now; one shared rule for the
   race plan and the Garmin race page; the half bike band follows the research. A research pass
   on run-off-the-bike pacing goes to BACKLOG.
4. **Swim pace offset.** CSS + 5 s/100 m default, user-editable, labelled Inference.
5. **Transitions.** User-entered, with the Inference defaults in 2.6.
6. **Olympic and sprint plans.** Out of scope; a BACKLOG entry.
7. **Caffeine.** Off by default, opt-in per race plan.
8. **Sweat sodium concentration.** Optional lab value only, clamped as in 2.4.
9. **Above 90 g/h.** Shown only after a proved tolerance above 90, with the "no clear gain"
   line.

## 13. Where the build differs from the brief

- **HR ceiling 85 %, not 89 %, of LTHR.** The Garmin race page already used 85 % (the top of the
  app's low band), and one shared rule must give one number. 85 % is the safer of the two.
- **Full-distance general bike band 0.65-0.75,** not 0.60-0.75: the low end follows the
  first-timer advice (0.65), and nothing in the research supports riding a full below it on
  purpose. The top 0.75 is the TSS-cap formula at about 5.3 h.
- **The Garmin race page changed numbers** (decision 3): bike half 75-82 % became 75-85 % and
  full 68-75 % became 65-75 % of FTP (`PACING` in `src/lib/garmin/analytics/race.ts` now reads
  `BIKE_IF` and `RUN_SPEED_SHARE` from `src/lib/utils/race-plan.ts`).
- **The Garmin fuel card** uses the shared fuel form (sodium, caffeine, GI score, notes; no
  products, since products need the endurance switch). It still needs only the activity to be
  the user's, as before.
- **The run guide pace** shows only with a run threshold pace; the leg time then comes from the
  middle of the guide band. Without it the run leg uses the assumed 6:30/km.
- **Plan corrections:** `docs/plans/garmin-insights-design.md` names the old bands; a note there
  points to this brief. E1 and E2 are `done` in the plan and the README.
