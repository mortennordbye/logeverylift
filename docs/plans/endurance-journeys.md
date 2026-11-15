# Endurance user journeys

Scope: bike (indoor trainer), run, swim, brick days, rest and recovery days, and the AI planning
loop over MCP. Strength stays as it is. Facts come from [`audit/endurance-journeys.md`](../../audit/endurance-journeys.md) (audit at `main`
feafb9f) and [`endurance-session-clarity.md`](endurance-session-clarity.md). Section numbers in brackets point to the audit.

Tags: EXISTS (works today), CHANGE (exists, must change), NEW (does not exist).

Assumptions: endurance switch on, Garmin access on, weekday cycle, the watch records every
session. The user is the admin, so the Garmin flag holds.

## 1. Principles

1. One session form for endurance: a structured workout (path B). Program sets (path A) stay
   for strength. Every endurance journey below uses path B.
2. One session page: `/planned/[id]` is the single place that answers "what do I do" before,
   and "what did I do" after. Every other screen links to it.
3. The watch records. The phone tells. The app never asks the user to type what the watch
   already has.
4. Every number is shown in the user's own units and in every form: 280 W, 93% FTP, Z4;
   128-141 bpm (Garmin Z2); 4:05 /km, 3:16 per 800 m.
5. HR zones come from the Garmin profile, so the app and the watch show the same zone.
6. The AI plans and adjusts. The app shows and checks. Every AI write passes the training
   limits and makes a revision the user can undo.

## 2. Shared screens

These screens serve all endurance journeys. The journeys in section 3 refer to them.

### 2.1 Home: Today card

One card lists every session of today: strength and endurance, in day order.

| Item | Shows / does | Source | Tag |
|---|---|---|---|
| Session row | Sport mark, name, priority (Key), brick mark, duration and distance totals, hard part ("20 min at 280 W") | `sessionCompliance`, `estimateWorkout`, resolver | CHANGE: today the Today hero skips path B and reads "Rest Day" on a path B only day (2.12 #8) |
| Block chart | Small profile of the session, coloured by zone | workout steps | NEW |
| Three lines | Warm-up, main set, cool-down with targets | resolver, grouping | NEW |
| "Details" | Opens `/planned/[id]` | | EXISTS (row link) |
| "Start guided" (bike, run) | Opens `/planned/[id]/play` | | EXISTS |
| "Pool view" (swim) | Opens `/planned/[id]/pool` | | EXISTS |
| "Results" (done) | Opens `/planned/[id]` at the result part | | CHANGE: goes to the results form today |
| "This week" | Opens `/week` | | EXISTS |
| Strength row "Start" | Opens the strength logger | | EXISTS |

### 2.2 Session page `/planned/[id]`

Before the session (state planned):

| Item | Shows / does | Source | Tag |
|---|---|---|---|
| Kicker | Date, sport, priority, brick ("Leg 1 of 2, run follows") | session, `brickParentId` | CHANGE: no sport, no brick today (2.8) |
| Title | Workout name | `planned_sessions.workout` | EXISTS |
| Totals | Time, distance, hard time, planned load | `estimateWorkout`, `workoutPlannedLoad` | CHANGE: add hard time; run time "about" when a step has no pace |
| Profile chart | Steps as blocks; height = intensity; FTP or threshold line | workout, thresholds | NEW |
| Coach note | Session note and workout description | `planned_sessions.notes`, `workout.description` | CHANGE: not shown today (2.12 #14) |
| Step list | Grouped: Warm-up / Main set "5 x do both" / Cool-down. Each step: duration or distance, main target in all forms, secondary target (HR cap), cadence, gradient, step note | resolver | CHANGE: one flat row per round today, one target, no cadence or note |
| Zone table | Garmin HR zones of this sport in bpm, and power zones in W | `hr_zones` snapshot (brief 2.6), FTP | NEW |
| "Record on Garmin" box | Activity profile, Auto Pause off, Auto Lap off, press Lap N-1 times, do not pause in easy steps | built from the workout (brief 5.1) | NEW |
| Threshold warning | "Set FTP to see watts" with link | `missingAnchors` | EXISTS |
| "Start guided" / "Pool view" | Player or pool view | | EXISTS |
| "Move", "Skip" | Same actions as the cycle sheet, with the move suggestion | `updatePlannedSession` | NEW on this page (exist on the sheet) |
| Back | Back, fallback `/week` | | EXISTS |

After the session (state done, missed or unconfirmed):

| Item | Shows / does | Source | Tag |
|---|---|---|---|
| Band | On plan / Partly / Far off plan, with the ratio | `complianceBand` | EXISTS |
| Paired activity | "Recorded on Garmin: Indoor Cycling, 56:10, 31.4 km", link to the activity page | `pairGarmin` result | NEW: pairing is computed but shown nowhere (4.13 #1) |
| "Not this activity" | Opens a list of the day's activities of the sport (plus one day either side); pick one or "none" | op `pick`, new op `unpick` | NEW: MCP only today, no unpick exists (4.13 #2, #21) |
| Step results | Each step: planned against done (avg W or pace, avg and max HR, time in the Garmin zone, hit or miss) | laps or time cuts (brief 5.2) | NEW: no Garmin source today (4.4) |
| Match note | "Matched by laps (12 of 12)" or "Matched by time: laps did not fit" | step matcher | NEW |
| Effort | Watch RPE and feel, else one RPE tap 1-10 | `directWorkoutRpe` in the activity JSON | CHANGE: the watch RPE is read nowhere today (4.3) |
| Actual load | Load of the session | `getStepResults` | CHANGE: computed, reaches MCP only (4.4) |
| "Edit results" | The results form, for a correction | `/planned/[id]/results` | EXISTS |
| "Did you do it?" | Yes / Missed when no activity paired and the day is past | `SessionAnswers` | CHANGE: not on this page today |

### 2.3 Week `/week`

| Item | Shows / does | Tag |
|---|---|---|
| Entry | A "Week" view in the Plan tab | NEW: no menu entry today (2.12 #5) |
| Load card, sport totals | Fitness, fatigue, form; done against planned per sport | EXISTS |
| Day rows | Every session links to `/planned/[id]`; two-line summary; brick mark; band | CHANGE: program rows are a dead `div`, summary is one cut line, no brick mark (2.2) |
| Done marks | Same done state as `/week` on the home strip and the calendar (Garmin-done counts) | CHANGE: home strip and calendar miss Garmin-done days (2.12 #21) |

### 2.4 Cycle sheet and calendar

| Item | Tag |
|---|---|
| Path B row shows the workout name, two-line summary and a "Details" link to `/planned/[id]` | CHANGE: calendar reads "No program assigned"; no link (2.12 #2, #3) |
| "Start" for a path B session opens the player or pool view | CHANGE: start needs a program today |

### 2.5 Garmin activity page `/more/garmin/activity/[id]`

| Item | Tag |
|---|---|
| "Planned: 5 x 4 min at 280 W" with a link to the paired session and the band | NEW (4.10) |
| Laps table and charts | EXISTS |

### 2.6 History

| Item | Tag |
|---|---|
| A session done by a Garmin pair shows as a row ("Recorded on Garmin") with a link to the session page | CHANGE: absent today (4.13 #9) |

## 3. Journeys

### 3.1 Bike, indoor trainer

Example: "5 x 4 min at 280 W". FTP 300. Garmin cycling zones.

| Phase | What happens | Screens and buttons | Data | Tags |
|---|---|---|---|---|
| Plan | The AI writes the week (section 4). The session is a workout with steps, power targets in % FTP or W, an HR cap as secondary target, cadence, optional gradient. | none for the user. Review on `/week` or the session page | `manage_workout`, `set_workout`, `add`, `edit_cycle_slot workoutId` | EXISTS (tools); CHANGE (step model: secondary, one-sided range, gradient, brief 2.2) |
| Before | Morning: home shows the Today card. The user taps "Details". The session page shows chart, grouped steps, W and %FTP, HR cap in bpm from Garmin zones, cadence, the record box. | Today card (2.1), session page (2.2) | resolver, `hr_zones` snapshot, thresholds | CHANGE / NEW as in 2.1, 2.2 |
| Before, low readiness | HRV fatigued two days in a row: home shows "Make it easy". Tap rewrites today's session as an easy ride. | Low readiness notice | Garmin daily metrics | EXISTS. CHANGE: add "Keep the plan" to close the card (2.12 #35) |
| During | Watch: Indoor Bike, trainer paired, Auto Pause off, Auto Lap off. Press Lap at each step change, 11 times. Do not pause in easy steps. Phone (optional): "Start guided" as a big step clock on the bars: step, time left, 280 W, cadence 90-100, HR under 170, next step. | Guided player | workout steps | EXISTS (player). CHANGE: show secondary target, cadence and HR range in the player |
| After | The watch syncs. Within 30 min the app pairs the ride. The session page shows the band, the paired activity, step results from the 12 laps, the watch RPE and the load. Nothing to type. | Session page after (2.2) | `garmin_activities`, laps, streams | NEW: shown pairing, step results from laps, watch RPE |
| After, no lap presses | Laps do not fit. The app cuts by planned times and says so. | Session page | streams | NEW |
| After, wrong activity | Two rides on one day. "Not this activity" picks the right one. | Session page | op `pick`, `unpick` | NEW |
| Adapt | The AI reads step results in the weekly review: a missed target on reps 4-5 holds watts; all reps above target with HR under cap gives a small raise. FTP update proposal when Garmin trends show a new FTP. | none in the app; the AI reports in chat | `get_step_results`, `get_garmin_trends`, `manage_thresholds` | EXISTS (tools). CHANGE: step results must carry Garmin data to be useful |

### 3.2 Run

Example: "6 x 800 m at 4:05 /km". Threshold pace 4:10 /km. Garmin running zones.

| Phase | What happens | Screens and buttons | Data | Tags |
|---|---|---|---|---|
| Plan | The AI writes intervals with pace as the main target and an HR cap; easy runs with HR as the main target (open question 5). Distance steps carry a pace, so time is known. | review on `/week` | as bike | EXISTS / CHANGE as bike |
| Before | Session page: totals (10.3 km, about 52 min), chart, steps "800 m at 4:05 /km, 3:16 per rep", jog "90 s", HR in bpm from Garmin running zones, record box. | Today card, session page | resolver | CHANGE: single pace prints twice today ("4:05-4:05/km") |
| During | Watch: Run (or Treadmill), Auto Lap off, Auto Pause off. Press Lap at each step change, 13 times. Keep running in the jog. Phone: the player is optional. A distance step waits for "Lap" in the player. | Guided player | | EXISTS |
| After | Pairing and step results from laps: pace per rep, HR per rep, time in zone. | Session page after | laps (time, distance, HR) | NEW. Lap pace comes from lap time and distance |
| Adapt | The AI reads pace per rep and HR drift. The long-run cap guards long runs. | | `get_step_results`, `long_run_cap` | EXISTS / CHANGE as bike |

### 3.3 Swim, pool

| Phase | What happens | Screens and buttons | Data | Tags |
|---|---|---|---|---|
| Plan | The AI writes sets in whole pool lengths with CSS pace targets or send-offs. | | `manage_workout`, `swim_css` | EXISTS |
| Before | Session page: totals in metres, sets grouped, pace per 100 m, send-off, equipment, record box. | session page | resolver | CHANGE as 2.2 |
| During | Watch: Pool Swim, pool length set. Press Lap at the wall to rest, again to start the next set. Phone at the pool end: "Pool view", one block per tap. | Pool view | | EXISTS. CHANGE: last block gets "Done" that opens the session page (4.13 #14) |
| After | Pairing by sport and day. Step results from the watch intervals. | Session page after | laps | NEW |
| Adapt | The AI reads pace per set against CSS. | | `get_step_results` | CHANGE (Garmin source) |

### 3.4 Brick day

Example: 90 min ride, then a 20 min run off the bike.

| Phase | What happens | Screens and buttons | Data | Tags |
|---|---|---|---|---|
| Plan | Two path B sessions, the run linked to the ride with `brickParentId`. Never one program with two sports. | | `link_brick`, `brickWithNext` | EXISTS (path B). CHANGE: the generator still makes the one-program brick (1.9 #5) |
| Before | Today card: one brick group with both legs and a "Brick" mark. Session page of each leg shows "Leg 1 of 2" and a link to the other leg. The record box tells: stop the bike activity, start a Run at once; transition target under 2 min. | Today card, session page | `brickParentId` | NEW: no brick mark on home, week or session page (2.12 #16) |
| During | Two activities on the watch, so each leg pairs alone. | | | Open question 1 (multisport) |
| After | A band per leg and one brick line: "Ride on plan, run 4:20 /km off the bike". | Session page of the run leg | both pairs | NEW: no combined result (6.7) |
| Adapt | The AI reads the run pace off the bike against open runs. | | `get_step_results` both legs | EXISTS (tools) |

### 3.5 Rest day and recovery day

| Phase | What happens | Screens and buttons | Tags |
|---|---|---|---|
| Plan | Rest: a template slot with no session. Recovery: a short easy session with priority "optional". | `edit_cycle_slot`, `add` | EXISTS |
| Before | Home: "Rest day" with today's readiness (sleep, HRV, Body Battery against normal) and tomorrow's session preview with "Details". | Today card | CHANGE: today the card shows "Rest Day" and "Start a Workout" only |
| During | Nothing. | | |
| After | Nothing to log. An optional easy session counts like any session. | | EXISTS |
| Adapt | The AI reads the readiness series in the weekly review. | | NEW (series tool, section 4.3) |

### 3.6 Sick day and missed session

| Situation | What happens | Tags |
|---|---|---|
| Sick | "I'm sick" on home or the session page. Sessions inside read "Sick". The AI proposes the return plan after the period. | EXISTS (illness flow); NEW: entry on the session page |
| Missed, no activity | Past day: "Did you do it?" Yes / Missed on home and the session page. | EXISTS (home); CHANGE (session page) |
| Missed key session | "Move to Thursday" suggestion on home and the session page. | EXISTS (home); CHANGE (session page) |

## 4. AI planning over MCP

### 4.1 The loop

| When | Trigger | AI reads | AI writes (after the user agrees) |
|---|---|---|---|
| Block start | New phase or cycle | season, races, athlete profile, thresholds, Garmin trends (FTP, LTHR, critical speed), injuries, coach memory | the weekly template: slots with library workouts, priorities, brick links |
| Weekly review | The user asks, Sunday | last week: `list_planned_sessions` (bands, matchedBy), `get_step_results` per key session, `get_training_load` (ramp, form), readiness and sleep series, illness, coach memory decisions | next week's sessions: `set_workout` per session with exact targets, moves, skips, priorities; threshold updates; a decision entry in coach memory |
| Morning check | The user asks, or a readiness swap shows | `get_garmin_status` (readiness, HRV, sleep, Body Battery), today's session | `apply_readiness_swap` only after a yes |
| After a key session | The user asks | `get_step_results`, `get_garmin_activity` (laps) | nothing by default; a note in coach memory |

Guard rails: every write takes a reason and `expectedVersion`; the six training limits check
the write; an override needs a reason the user sees; every write is a revision the user can undo
in the app (5.2, 5.3). The weekly sync never touches workouts, so the weekly review is the only
volume change for path B sessions (1.9 #7).

### 4.2 Data the loop uses and how the AI gets it

| Data | Tool | Tag |
|---|---|---|
| Plan, bands, matched activity | `list_planned_sessions` | EXISTS |
| Step results with Garmin numbers | `get_step_results` | CHANGE: needs the Garmin source (2.2) |
| Load, ramp, form | `get_training_load` | EXISTS |
| Readiness today | `get_garmin_status` | EXISTS |
| Sleep, HRV, resting HR, Body Battery by day | none | NEW: a series tool (6.8 #8) |
| Garmin HR zone bounds per sport | none | NEW: add to `get_athlete_profile` (brief 2.6) |
| Lap pace and cadence | `get_garmin_activity` | CHANGE: laps have time, distance, HR, power only (6.8 #9) |
| FTP, LTHR, critical speed trends | `get_garmin_trends` | EXISTS |
| Watch RPE and feel | none | NEW: add to `get_garmin_activity` |
| Skip and miss reasons | `list_planned_sessions` | EXISTS (returned); the app sends no miss reason |
| Coach memory, profile, injuries, illness | existing tools | EXISTS |

### 4.3 Fixes in the MCP text

| Fix | Tag |
|---|---|
| `instructions.ts:46` and `docs/mcp/app-rules.md:276-279` say no guided player exists; it exists | CHANGE |
| `instructions.ts:45` says no code refuses another strength count; `strength_per_week` does | CHANGE |
| `log_fuel` asks for a session id that `recent_workouts` does not return | CHANGE: return the id |
| Weekly review steps: add step results, readiness series and threshold check | CHANGE |

## 5. Gaps and build order

The brief's phases stay. This list adds the journey gaps to them.

| Phase | Content | Journey gaps closed |
|---|---|---|
| 1 Display and navigation | Session page before part (2.2), Today card with path B and the "Rest Day" fix, Garmin HR zones, record box, links from cycle sheet, calendar and `/week`, Week in the Plan tab, player shows secondary target and cadence, MCP text fixes (4.3) | 2.1, 2.2 before, 2.3, 2.4, 3.x Before |
| 2 Step model | secondary target, one-sided range, gradient | 3.1 Plan, 3.2 Plan |
| 3 After | Shown pairing, pick and unpick in the app, step results from laps or time cuts, watch RPE, Garmin-done in history and done marks, "Did you do it?" and move on the session page, pool view "Done", Garmin activity links to the plan | 2.2 after, 2.5, 2.6, 3.x After |
| 4 AI data | Readiness series tool, zone bounds, lap pace and cadence, watch RPE over MCP, weekly review text | 4.2 |
| 5 Move the plan | The AI rewrites future endurance sessions as path B; bricks as two sessions | 3.4 Plan |
| 6 Optional | "Download .fit" (D13) | watch runs the steps |

## 6. Open questions for the user

1. Brick on the watch: two activities, or Garmin Multisport? Two activities pair with no new
   code. A Multisport activity needs a check of how the sync stores it.
2. Pairing takes any activity of the sport on the day, even 5 minutes (4.13 #3). Should a pair
   need a minimum, for example 50% of the planned time?
3. Week view: a segment inside the Plan tab, or its own tab?
4. Rest day card: is readiness plus tomorrow's preview enough?
5. Run intervals with pace as main target and HR cap; easy runs with HR as main target. Agree?
