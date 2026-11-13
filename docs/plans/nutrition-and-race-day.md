# Nutrition and race-day plan (packages E1, E2)

Brief for packages E1 and E2 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). Written
2026-11-13. Build to it with no conversation history. Settle the open questions in section 12
before code. Names marked *new* do not exist yet.

Inputs: the plan (sections 1-6), the audit (`docs/triathlon-coach-audit.md`, section 6 and 9,
decisions D1-D23, T1-T10), and the research
(`docs/research/endurance-training-reference.md`, "Fueling is trained like a fourth discipline",
the bike race target table, and the half-distance appendix). E3 (watch delivery) is parked
(D13): nothing here depends on a delivery route.

**Status of this brief.** Sections 1-8 and 12 are complete. Sections 9-11 are short and marked
where they need detail. TODO in next session: expand the view sketches (9), the full MCP tool
input shapes (8) and the test list per file (11).

## Medical safety framing (applies to every section)

- Every hydration, sodium, caffeine and carbohydrate number the app shows carries its evidence
  label from the research and the line "A guide from published research, not medical advice.
  Test it in training." The app never shows a number without its label.
- The app never prescribes beyond the research: no dose above the research ceilings (carbs
  above 90 g/h without a trained gut, fluid above the measured sweat rate, caffeine above
  6 mg/kg). Inputs that would give such a number are clamped and the view says why.
- Fluid guidance always repeats the research rule "never above sweat rate; volume, not sodium,
  prevents hyponatremia", and a body-mass gain after a session shows a red-flag line.
- No daily food tracking (audit section 6: out of scope).

## 1. Findings in the code

- Fuel logs exist only for Garmin activities. `garminFuelLogs`
  (`src/db/schema/garmin.ts:218-230`) stores `carbs_g` and `fluid_ml` per
  `garmin_activity_id`, no sodium, no products, no GI score. Migration
  `drizzle/0075_calm_cable.sql`.
- The only writer is `saveFuelLog` (`src/lib/actions/garmin.ts:400`), Garmin-gated. The card
  shows on the activity page for sessions of an hour or more (`FUEL_MIN_S`,
  `src/components/features/GarminActivityView.tsx:80`).
- Garmin data delete removes fuel logs (`src/lib/garmin/delete-data.ts:30`); export includes
  them (`src/lib/account-data.ts:135`).
- `sweatModel` (`src/lib/garmin/analytics/race.ts:94`) fits Garmin's sweat estimate against
  watch temperature after `FUEL_MIN_SESSIONS` sessions. It is an estimate, not a weighed test.
- `PACING` (`src/lib/garmin/analytics/race.ts:24-27`) sets half bike 75-82 % FTP and run
  85-90 % of critical speed. The research appendix says half IF 0.75-0.85 in general but
  0.70-0.75 for a first-timer, and gives no run-pace share. The run shares are not in the
  research. See question Q3.
- Races live on `seasonRaces` (`src/db/schema/seasons.ts:51-70`) with `distance` from
  `TRI_DISTANCES` (full, half, olympic, sprint) and `priority` A/B/C.
- Thresholds live in `athleteThresholds` with kinds `THRESHOLD_KINDS`
  (`src/db/schema/athlete-profile.ts:27`): ftp, lthr_bike, lthr_run, run_threshold_pace,
  swim_css, max_hr.
- Consent rule: `CONSENT_VERSION` is raised only for a new kind of health data
  (`src/lib/constants/legal.ts:8-17`).

## 2. Rules (pure, `src/lib/utils/fueling.ts` *new* and `src/lib/utils/race-plan.ts` *new*)

Each rule cites the research section and keeps its label in code and in the UI.

### 2.1 Carbs per hour by session length

| Session | Target | Label |
|---|---|---|
| Easy, under 90 min | Water only is fine; no target | Coach convention |
| Over 2 h, long brick, long run over 90 min, race simulation | Practise race fueling with race products | Coach convention |
| Untrained gut | Bike 60-80 g/h, run 50-70 g/h, 2:1 glucose:fructose | Consensus plus study; split is inference |
| Over about 2.5 h, gut trained to 90 g/h with no symptoms | Up to 90 g/h | Consensus |
| Above 90 g/h | Only after 6-10+ weeks without symptoms, about 1:0.8 mix; no clear performance gain | Study plus inference |

Between 90 min and 2 h the app shows "optional, practise if a key session". The default
ceiling the app shows is 90 g/h. It shows a number above 90 only when the athlete's proved
tolerance (2.2) is above 90.

### 2.2 Gut-training progress

- Tolerance = the highest carbs/h in a logged fueled session of 90 min or more with GI score
  under 4/10 (`proved_g_h`).
- Next step = `proved_g_h + 10`, every 1-2 weeks, 2-3 long sessions a week (Coach convention plus
  inference). GI score 4/10 or more: hold or step back 10 g/h (Inference).
- Race target = 80 % of the highest proved tolerance (Coach convention), capped by 2.1.
- GI score: 0-10, entered after a fueled session. 0 = no symptoms.

### 2.3 Sweat-rate test

- Sweat rate (L/h) = (pre kg - post kg + fluid L - urine L) / hours (Inference from consensus
  method). Nude weight, about 60 min at race effort, race-like heat; repeat in 2-3 temperatures.
- Body-mass change % = (post - pre) / pre x 100. A gain is a red flag (Study). 1-3 % loss by the
  finish is normal (Consensus plus inference).
- Input checks: duration 30-240 min, weights 30-250 kg, change at most 5 % of body mass, else
  refuse the entry as a likely typo.

### 2.4 Fluid and sodium

- Fluid/h = 50-80 % of the measured sweat rate, shown as a range, never above the sweat rate;
  usually 400-900 ml/h (Consensus plus inference). With no test: show the 400-900 ml/h range
  and ask for a test.
- Sodium default about 300-600 mg/h, or 500-1,000 mg per litre drunk (Consensus for the
  variation, inference for the doses). An optional sweat sodium concentration (mg/L, from a lab
  test) scales the share: sodium/h = fluid/h x concentration, capped to the 300-1,000 mg/h band
  shown with a "more for salty sweaters in heat; ask a professional" line. The app never shows
  a higher number.
- Caffeine: about 3 mg/kg pre-start or early bike, 1-3 mg/kg late, 3-6 mg/kg total (Consensus
  plus inference). Shown only if the athlete turns it on in the race plan; uses latest body
  weight.

### 2.5 Pacing per leg (E2)

- Bike: IF_target = sqrt(TSS_cap / (100 x expected bike hours)), TSS_cap 250-300 full,
  about 170 (180 max) half (Coach convention; rearrangement is inference). Clamp: full
  first-timer 0.65-0.70, half 0.75-0.85 general and 0.70-0.75 first-timer. Watts = IF x FTP.
  Shown as a guide, never a finish prediction.
- Run: the research gives no run-off-the-bike pace share. The plan shows an HR ceiling (top of
  Friel run zone 2, 89 % LTHR run, Inference) and, as a guide, the athlete's own easy-to-steady
  pace from threshold pace labelled Inference. See Q3.
- Swim: the research gives no race swim pace rule. Show CSS pace plus a user-chosen offset per
  100 m (default +5 s/100 m, Inference). See Q4.
- Missing threshold: the leg shows "add your FTP / threshold pace / CSS" and no number.

### 2.6 Timeline and transitions

- Leg distances from `TRI_DISTANCES` (full 3.8/180/42.2 km, half 1.9/90/21.1 km). Olympic and
  sprint are out of scope for this package (plan: half and full first).
- Leg time = distance / planned speed; the athlete may override each leg time. T1 and T2 are
  user-entered minutes (default 5 and 3 for a half, 8 and 5 for a full, Inference; the research
  has no transition data).
- Timeline: start time, then each leg with clock times. Fuel schedule: per leg, every 15 or 20
  min (athlete pick), grams, fluid ml, sodium mg, product. Totals per leg and per hour.
- Race morning: 1-3 g/kg carbs 2-3 h before the start; two days before: 8-12 g/kg/day, low fibre
  (Consensus). Shown as text with weight-derived grams.

## 3. Data model (migration `drizzle/0089_*` *new*)

- `fuel_products` *new*: id, user_id, name, carbs_g, sodium_mg, caffeine_mg, fluid_ml (for
  drinks), glucose_fructose_ratio text nullable, deleted_at. Per user; no shared catalogue (no
  brand data to maintain).
- `fuel_logs` *new*: id, user_id, one of `workout_session_id`, `planned_session_id` or
  `garmin_activity_id` (check: exactly one), duration_s, carbs_g, fluid_ml, sodium_mg,
  caffeine_mg, gi_score 0-10 nullable, notes nullable, updated_at. Logged data, not plan data:
  no revisions.
- `fuel_log_items` *new*: fuel_log_id, product_id, count. Totals on `fuel_logs` are kept as the
  sum when items exist, so a log can also be totals only.
- `sweat_tests` *new*: id, user_id, tested_on, duration_s, pre_kg, post_kg, fluid_ml, urine_ml,
  temperature_c nullable, effort text, sport, sweat_sodium_mg_l nullable. Logged data.
- `race_plans` *new*: id, user_id, season_race_id (unique), version, start_time, leg overrides
  and transitions (jsonb checked by one Zod schema, `racePlanSchema` *new*), fuel interval,
  caffeine on/off, deleted_at. Plan data: revisioned (T5), version check (T9).
- `garmin_fuel_logs` moves into `fuel_logs` (Q1). The Garmin card then writes `fuel_logs`.

Field owners: fuel logs and sweat tests, the user or the assistant (logged data); race plan
inputs, user or assistant through revisions; computed targets are never stored.

## 4. Race plan from the season's A race

- The race plan view opens from a race on the season. Default target: the season's A race; a
  B race may also get a plan.
- Built on read from: the race (distance, date), current thresholds, latest body weight, the
  latest sweat test, proved gut tolerance, and the stored overrides. Nothing derived is stored,
  so a retest updates the plan at once.
- A race date change keeps the plan (it is keyed to the race id).

## 5. Units (A2)

Storage metric. Display uses the user's units setting: km/mi, pace per km or mile, swim per
100 m or 100 yd. Fluid in ml, carbs in g, sodium in mg, weight in kg (lb is in BACKLOG).

## 6. Views (behind the endurance switch, D18; work without Garmin)

- Fuel card on a logged endurance session (in-app) and on a Garmin activity: products or totals,
  GI score. Only for sessions of 60 min or more.
- Nutrition page under More (*new*): gut-training ladder (proved, next step, race target), sweat
  tests list and entry, products.
- Race plan page from the season race: timeline, per-leg pacing, fuel schedule, race morning.
- The Garmin race page keeps `sweatModel` as a "Garmin estimate" next to measured tests.

## 7. Privacy

- Fuel logs with GI scores, sweat tests (body weight, sweat loss) are health data. GI symptoms
  are a new kind of health data (audit section 9 names "GI"). Recommendation: add to
  `docs/privacy/data-inventory.md` and the policy, raise `LEGAL_VERSION` and `CONSENT_VERSION`
  per the rule in `src/lib/constants/legal.ts`. Safe choice: ask again rather than assume.
- Every new table in `collectUserData`, cascade on user delete, never shown to friends.
- Fuel logs no longer delete with Garmin data once moved (only Garmin-linked rows do).
- MCP: assistants read and write these; the consent text lists nutrition and sweat tests.
- Run the `privacy-compliance` skill in the build PR.

## 8. MCP tools

- `log_fuel` *new* (write, logged data, reason optional), `list_fuel_logs` *new* (read).
- `log_sweat_test` *new*, `list_sweat_tests` *new*.
- `manage_fuel_products` *new*.
- `get_nutrition_targets` *new* (read: rules of section 2 with labels and the safety line).
- `get_race_plan` *new* (read, computed), `update_race_plan` *new* (write with `reason` and
  `expectedVersion`, revisioned).
- Server instructions: race plan and fuel numbers are guides with labels; the assistant must
  pass the "not medical advice" line on.
- TODO in next session: full input shapes.

## 9. Migration and rollback

- One migration: create the five tables, copy `garmin_fuel_logs` rows into `fuel_logs`, keep
  `garmin_fuel_logs` for one release (read-only), drop it in a later PR.
- Rollback: drop the new tables. Data entered after the deploy (new logs, tests, plans) is lost;
  Garmin fuel logs are safe because the old table stays one release.

## 10. Lifter risk

None. New tables and pages behind the endurance switch. No critical flow changes.

## 11. Tests per layer

- Unit: every rule in section 2 (boundaries 90 min, 2 h, 2.5 h; GI 4/10; sweat-rate maths,
  input refusal, mass gain red flag; fluid never above sweat rate; sodium cap; IF formula and
  clamps; timeline sums).
- Integration: actions and MCP tools, ownership, version conflict on `update_race_plan`,
  revision on write, migration copy of Garmin fuel logs, export and delete coverage.
- Component: fuel card input and race plan render with missing thresholds.
- TODO in next session: file list.

## 12. Open questions (recommended safe answers)

1. **Move `garmin_fuel_logs` into `fuel_logs`?** Recommend yes, copy rows, keep the old table one
   release for rollback.
2. **Raise `CONSENT_VERSION` for GI scores and sweat tests?** Recommend yes (new kind of health
   data per the rule in `src/lib/constants/legal.ts`).
3. **Run pacing:** the research has no run-off-the-bike share; the Garmin `PACING` run shares are
   uncited. Recommend: HR ceiling plus pace labelled Inference now, add a research pass, and
   move the half bike band to the research numbers in one shared rule used by both pages.
4. **Swim pace offset:** recommend CSS + 5 s/100 m default, user-editable, labelled Inference.
5. **Transition defaults:** recommend user-entered with the Inference defaults in 2.6.
6. **Olympic and sprint plans:** recommend out of scope (BACKLOG entry).
7. **Caffeine in the plan:** recommend off by default, opt-in per plan.
8. **Sweat sodium concentration:** recommend optional, lab value only, capped band as in 2.4.
9. **Above 90 g/h:** recommend shown only after proved tolerance above 90 and with the "no clear
   gain" line.
