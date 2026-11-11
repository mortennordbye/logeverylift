# Garmin insights: analytics and visualisation design

> **Status:** phase A in progress on the local branch `feat/garmin-metrics`.
> **Written:** 2026-11-11, against the local branch `feat/garmin-metrics` (phase 1 of `docs/plans/garmin-deep-data.md` built).
> **Replaces:** phases 2 to 5 of `docs/plans/garmin-deep-data.md`. That plan stays the source for ingestion.

Written to be picked up with no conversation history. Read section 0 first. Names marked *new* do not exist yet. Everything else was opened and checked when this was written.

## 0. Start here

### Goal

Turn the stored Garmin data into a training tool for one athlete who trains for an Ironman and also lifts. The page must answer questions, not list numbers:

1. Can I train hard today, and why?
2. Is my fitness going up at a safe rate?
3. Am I recovering, and what hurts my recovery?
4. What did this session do, and was it good?
5. Am I getting faster or more durable?
6. Will I be ready and fresh on race day?

The first draft (`src/components/features/GarminMetricsTab.tsx`) shows four tiles and `div` bars. It repeats Garmin Connect with less detail. This plan replaces it.

### What we can beat Garmin Connect on

- **One model for all training.** Garmin does not know the strength sessions logged in LogEveryLift (sets, RIR, readiness, feeling). We do. Load, fatigue and readiness include them.
- **Open formulas.** Every score shows its inputs and its formula. Garmin shows a number and a phrase.
- **Linked views.** One crosshair across all charts of an activity, the map included. One time axis for the whole day.
- **Performance models Garmin hides or does not have.** Fitness, fatigue and form per sport, critical power and W', durability, decoupling trend, polarization index, sleep regularity.
- **The plan reacts.** Findings feed the periodized triathlon cycle the app already builds (`src/lib/utils/periodization.ts`).

### Facts measured on 2026-11-11 (shapes and counts only)

- When this was written the local database held about six weeks of days; the import was still going back (`garmin_connections.history_done` false). A recount later the same day: about 100 days, with outdoor rides and outdoor runs, 9 activities with GPS, and still **no swim**. Every model below must work with little history and say so ("calibrating").
- Swim items are designed from the FIT standard, not from a sample. Check them on the first real swim file.
- `hr_zones` holds two sports: `DEFAULT` and `CYCLING`, each with `zone1Floor` to `zone5Floor`, `maxHeartRateUsed`, `lactateThresholdHeartRateUsed`, `restingHeartRateUsed`.
- `heart_rate.heartRateValues` is a list of `[timestamp, heartrate]` pairs. `hrv_detail.hrvReadings` items have `hrvValue` and `readingTimeLocal`.
- `sleep` has `sleepStartTimestampLocal`, `sleepEndTimestampLocal`, stage seconds, `sleepScores` (`overall`, `totalDuration`, `stress`, `awakeCount`, `restlessness`, stage percentages), `sleepNeed` (`baseline`, `actual`, adjustments), `napTimeSeconds`, `avgSleepStress`, `averageRespirationValue`.
- FIT `timeInZone` messages carry `functionalThresholdPower`, `thresholdHeartRate`, `restingHeartRate`, `maxHeartRate` and the zone boundaries used on the watch for that activity. This gives thresholds per activity date, which the snapshot kinds cannot.
- The FIT parser (`src/lib/garmin/fit.ts`) keeps records, laps, sets, time in zone and the session. It drops `lengthMesgs` (pool lengths) and `eventMesgs` (timer stop and start). Swim metrics and correct pause handling need both. See section 6.3.
- `training_cycles` has `startDate` and `durationWeeks` but no race date (`src/db/schema/training-cycles.ts`).
- `BACKLOG.md` already has "Wearable-based autoregulation (Tier B) for triathlon plans". Phase F below closes it.

### Decisions made in this plan (change if the owner objects)

- **I-1 Best tool per job (owner, 2026-11-11: no visualisation limits).** `uplot` for dense streams with linked crosshairs, `echarts` for all other charts, `maplibre-gl` for coloured routes. Each loads on demand. See section 6.1.
- **I-2 Precompute.** Derived metrics live in two new tables, filled by the existing worker. Pages read them. See section 6.2.
- **I-3 Units.** One load unit for everything, on the TSS scale: 100 = one hour at threshold.
- **I-4 Rules first, AI second.** Findings come from rules with fixed thresholds. A model may only rephrase and rank them. The main AI path is the existing MCP server, which costs nothing.
- **I-6 Owner answers (2026-11-11).** O-1: add a race date and distance to the cycle. O-2: strength counts in both fatigue and fitness, with its own line. O-3: wearable signals only suggest plan changes. O-11: `echarts` for the non-stream charts. O-5 taken at its recommended default for phase A (our own bands in the models, Garmin's five zones on per-activity bars); the owner may change it.
- **I-5 Server render.** New tabs are Server Components that read precomputed rows. Only the charts are Client Components. The current draft loads in `useEffect`; that pattern goes away.

## 1. Information architecture

Route: `/more/garmin`, tab in the URL (`?tab=`), as today in `src/app/more/garmin/page.tsx`. Six tabs do not fit a segmented control at 390 px, so the control in `src/components/features/GarminClient.tsx` becomes a scroll row of pills (44 px high, `:active` feedback, selected pill scrolled into view).

| Tab | Question | Content |
|---|---|---|
| **Today** | Can I train hard today? | Readiness score with contributors, insight feed, 24 h timeline, overnight HRV, today's planned session with advice, day picker |
| **Load** | Is fitness rising safely? Will I be fresh on race day? | Fitness, fatigue and form chart, weekly load by sport, ramp rate and ACWR, zone distribution, race card with taper projection |
| **Sleep** | Am I recovering? | Sleep timing chart, debt, regularity, HRV and resting HR baselines, what moves my HRV |
| **Activities** | What did I do? | Calendar heatmap, filter by sport, list with a sparkline and load per row. A row opens the deep view |
| **Trends** | Am I getting faster? | Power and pace duration curves, threshold estimates over time, efficiency and decoupling trend, durability, running dynamics, swim, correlations |
| **Data** | What is stored? | The existing explorer (`src/components/features/GarminDataExplorer.tsx`), unchanged |

Extra routes (*new*):

- `/more/garmin/activity/[id]`: the activity deep view. Its own page so the back gesture works and it can be linked from History.
- `/more/garmin/day/[date]`: the Today layout for a past date. The Today tab is this page for the current date.

The Overview tab is removed. Today replaces it.

Rules for every screen:

- The top of each tab is one sentence that answers the tab's question, written by the rules in section 4. Charts come after it as evidence.
- A metric that lacks history shows "Calibrating: 12 of 28 days" with a thin progress bar. It never shows a wrong number.
- Every score has an info button that opens a bottom sheet (`src/components/ui/BottomSheet.tsx`) with the formula, the inputs and their values.

## 2. Derived metrics and models

All of these are pure functions in `src/lib/garmin/analytics/` (*new* folder), one file per model, each with unit tests. Inputs are plain arrays, never database rows.

### 2.1 Thresholds per date (the base for everything)

Most models need max HR, resting HR, LTHR, FTP and threshold pace **as they were on the date of the activity**.

- **Source order for HR thresholds:** the activity's FIT `timeInZone` message (`thresholdHeartRate`, `maxHeartRate`, `restingHeartRate`), then the nearest `hr_zones` snapshot for the sport (`CYCLING`, else `DEFAULT`), then our own estimates (2.8).
- **Resting HR for the day:** `heart_rate.restingHeartRate`, else `daily.heartRate.restingValue`.
- **FTP:** our estimate (2.8), else FIT `functionalThresholdPower`.
- **Edge case:** max HR seen in a stream above the stored max for 30 s or more raises our max HR from that date. A single spike does not (optical sensors spike).

### 2.2 Load per session

One number per session, in load points (I-3). The method is stored with the number and shown in the UI.

| Case | Formula | Inputs |
|---|---|---|
| Ride with power | `load = seconds x NP x IF / (FTP x 3600) x 100`, `IF = NP / FTP`. NP = fourth root of the mean of (30 s rolling mean power) to the fourth power | stream `power`, `t`; FTP from 2.1 |
| Outdoor run | `load = hours x IF^2 x 100`, `IF = grade adjusted speed / threshold speed` | stream `speed`, `altitude`; fallback `avgGradeAdjustedSpeed` |
| Swim | `load = hours x IF^3 x 100`, `IF = swim speed / critical swim speed`. Rest at the wall excluded | lengths (after parser v2), else `distance` and `movingDuration` |
| Anything with HR and none of the above (treadmill, bouldering, ride with no power) | Banister TRIMP scaled to threshold: `TRIMP = sum(minutes x HRr x 0.64 x e^(1.92 x HRr))`, `HRr = (HR - rest) / (max - rest)`. `load = TRIMP / TRIMP of one hour at LTHR x 100`. Use the female constants (0.86, 1.67) when the profile says so | stream `hr`; fallback `hrTimeInZone_1` to `hrTimeInZone_5` with zone midpoints |
| Strength | Session RPE: `load = minutes x sRPE x 0.22`. sRPE = mean RPE of working sets (from RIR, `rpe = 10 - rir`), else from `feeling`, else 6. The 0.22 maps one hour at RPE 7.5 to 100 | LogEveryLift `workout_sessions` and `workout_sets`; duration from the matched Garmin activity when there is one |

Edge cases:

- **Treadmill pace is not trusted.** Treadmill runs always use the HR method.
- **Matching strength.** A Garmin `strength_training` activity and a LogEveryLift session are the same session when their time ranges overlap by half or more of the shorter one. Compare in UTC (`startTimeGMT`). One load entry, not two.
- **No stream yet** (file still to fetch): use Garmin's `trainingStressScore` if present, else the zone fallback. Mark it "estimated". Recompute when the file arrives.
- **Pauses.** Use timer time, not elapsed time. Needs `eventMesgs` (6.3). Until then, drop samples where speed and power are both zero for more than 10 s.
- **Missing thresholds.** No load. Show the session with "needs threshold". Never guess a threshold without saying so.

Why better: Garmin's `activityTrainingLoad` is an EPOC number on its own scale that cannot be added to strength work and cannot be checked. Ours is one scale, per sport, with the method shown.

### 2.3 Fitness, fatigue and form

Daily load per sport (swim, bike, run, strength, other) and total. Days with no session count as zero.

- `CTL(t) = CTL(t-1) + (load(t) - CTL(t-1)) / 42` (fitness)
- `ATL(t) = ATL(t-1) + (load(t) - ATL(t-1)) / 7` (fatigue)
- `TSB(t) = CTL(t-1) - ATL(t-1)` (form, for the morning of day t)

Computed per sport and for the total. Strength counts in total fatigue and total fitness, and has its own line. Open decision O-2 covers whether strength should count toward total fitness.

Edge cases:

- **Cold start.** Seed CTL and ATL with the mean daily load of the first 28 days. Mark the first 42 days "calibrating" and draw them at lower opacity.
- **Gaps in the import.** A day inside the imported range with no activity is a rest day. A day outside it is unknown and ends the series.
- **Late history.** When older history arrives, the whole series is recomputed (cheap, see 6.2).

Extra numbers from the same series:

- **Ramp rate** = `CTL(t) - CTL(t-7)`. Up to 5 a week is normal, 5 to 8 is fast, above 8 is a warning.
- **ACWR** = the existing `uncoupledAcwr` in `src/lib/utils/periodization.ts`, fed weekly loads. One definition in the whole app. Above 1.3 is a warning, the same ceiling that file already tests.
- **Monotony** = mean daily load of 7 days / standard deviation. Above 2.0 with a high week means "every day is the same medium day".

Why better: Garmin's API does not expose acute or chronic load at all, and its app shows one combined number. We show it per sport, with strength, and project it forward (2.14).

### 2.4 HRV-guided training

Input: `hrv.lastNightAvg` per night. Work on the natural log, `ln(ms)`.

- **7-day mean** of ln HRV (needs 4 of 7 nights).
- **Baseline band** = 60-day mean plus and minus 0.75 standard deviations (needs 30 nights). While calibrating, use Garmin's `baseline.balancedLow` and `balancedUpper`.
- **CV7** = standard deviation / mean of the last 7 nights, in percent, on raw ms.

States, from the 7-day mean and CV7:

| 7-day mean | CV7 | State | Advice |
|---|---|---|---|
| In band | Normal | Balanced | Train as planned |
| Above band | Any | High | Fine, unless resting HR is also low and load is high (watch for too much) |
| Below band | Rising | Strained | Easy day |
| Below band | Low | Fatigued and stuck | Rest, check sleep and load |
| In band | Rising for 3+ days | Unsettled | Keep intensity short |

**Overnight curve** from `hrv_detail.hrvReadings`: mean of the first half of the night against the second half. A rise through the night means recovery went well. A flat low curve points at a late hard session, a late meal or alcohol. Garmin shows only the mean.

### 2.5 Resting and sleeping heart rate

- **Resting HR trend:** 7-day mean against a 60-day baseline. Plus 5 bpm or plus 2 standard deviations is a flag.
- **Sleeping HR low point** (ours): lowest 30-minute rolling mean of `heartRateValues` inside the sleep window.
- **Time of the low point** as a fraction of the night. A low point in the last third means the body was still working for most of the night.

Edge cases: nights with fewer than 3 hours of HR samples in the window are skipped. A nap is not a night.

### 2.6 Readiness score

One score from 0 to 100 for the morning. Built from contributors, each scored 0 to 100 against the athlete's own baseline, never a population norm.

| Contributor | Weight | Input | Score |
|---|---|---|---|
| HRV | 30 | 7-day ln mean against the band, last night against the 7-day mean | 50 at band centre, 100 at plus 1.5 SD, 0 at minus 1.5 SD |
| Resting HR | 15 | Today against the 60-day baseline | Inverse of the above |
| Sleep last night | 15 | Duration / need (`sleepNeed.actual`, else `baseline`, else 8 h) | 100 at 100 % or more, 0 at 50 % |
| Sleep debt | 10 | 2.11 | 100 at zero debt, 0 at 8 h |
| Form | 20 | Total TSB, and yesterday's load against ATL | 100 at TSB of plus 10 or more, 50 at minus 10, 0 at minus 35 |
| How I feel | 10 | LogEveryLift `readiness` (1 to 5) of the last 2 days, if logged | Linear |

- A missing contributor is left out and the other weights are scaled up. The card says "4 of 6 signals".
- **Caps:** HRV "Fatigued and stuck" plus a resting HR flag caps the score at 45. Fewer than 3 signals shows no score.
- **Bands:** 75 or more "Go hard", 50 to 74 "Train as planned", 30 to 49 "Keep it easy", below 30 "Rest".

Why better: Garmin's readiness is not in the API, cannot be explained, and ignores gym sessions. Ours shows each contributor as a bar, so a low score names its cause.

### 2.7 Decoupling, efficiency and durability

- **Efficiency factor (EF):** ride `NP / mean HR`. Run `grade adjusted speed in m/min / mean HR`.
- **Decoupling:** split the steady part into two halves. `(EF first half - EF second half) / EF first half x 100`. Under 5 % means the aerobic base holds for that duration.
- **Valid only when:** 60 min or more (ride) or 45 min or more (run); first 10 min dropped; ride variability index (`NP / mean power`) under 1.10; no long pauses. Interval sessions get "not a steady session" instead of a number.
- **Confound shown, not hidden:** mean stream `temperature` is listed next to the number. Heat raises decoupling.
- **Durability:** best 20-minute power after 1500 kJ of work in the same ride (cumulative from stream `power`), divided by the best fresh 20-minute power of the last 90 days. The same for 5 minutes. Needs long rides; shows "no ride long enough yet" otherwise. This is the single most useful Ironman number, and Garmin Connect does not have it.

### 2.8 Duration curves and threshold estimates

- **Power curve:** best mean power for about 40 log-spaced durations from 1 s to the ride length, from the stream (prefix sums, one pass per duration). Fallback for activities with no file: `maxAvgPower_1` to `maxAvgPower_7200`.
- **Pace curve:** best time for 400 m, 1 km, 1 mile, 5 km, 10 km, half and full marathon from stream `distance` (two pointers). Fallback: `fastestSplit_1000`, `fastestSplit_1609`, `fastestSplit_5000`. Treadmill runs are left out.
- **Windows:** last 42 days, last 90 days, last 365 days, all time. Each best keeps its activity id and date.
- **Estimated FTP:** `0.95 x best 20-minute power` of the last 90 days. If older than 90 days, show it grey with "stale: test again".
- **Critical power and W':** fit `work = CP x t + W'` by least squares on the bests at 3, 5, 12 and 20 minutes of the last 90 days. Show CP, W' and R squared. Under 3 fresh points, or R squared under 0.95, shows "not enough hard efforts" and no number.
- **Critical speed (run):** the same fit on distance against time for bests between 3 and 20 minutes. Threshold pace is about critical speed.
- **LTHR estimate:** mean HR of the last 20 minutes of the best 30-minute effort of the last 90 days, per sport. Shown next to Garmin's `lactateThresholdHeartRateUsed`; a gap over 4 bpm raises an insight.
- **Critical swim speed:** `(400 - 200) / (T400 - T200)` from best efforts found in the lengths. Manual entry as fallback (open decision O-6).

Why better: Garmin shows a power curve but not what follows from it. We show thresholds over time, how sure we are, and when they are stale.

### 2.9 Zone distribution

Three bands from the HR stream and LTHR of the date: **low** under 85 % of LTHR, **mid** 85 to 100 %, **high** above LTHR. Fallback with no stream: `hrTimeInZone_1` and `_2` are low, `_3` and `_4` mid, `_5` high. Power bands for rides, as a second view, from FTP (under 76 %, 76 to 100 %, above).

- **Polarization index** = `log10(low / mid x high x 100)` with the three as fractions. Above 2.0 is polarized. If high is zero the index is not defined and the label is "no high intensity". If mid is zero, use 0.01.
- **Label per week and per 4 weeks:** polarized, pyramidal (low > mid > high), threshold (mid largest), or mixed.
- **Target for Ironman build:** pyramidal with 75 to 85 % low. The view marks the target and the gap.

### 2.10 Sport-specific metrics

**Swim** (after parser v2, unverified until the first swim file): pace per 100 m per length and per set, SWOLF (seconds plus strokes per length), stroke rate, distance per stroke, rest at the wall per interval, pace fade across a main set.

**Run:** cadence, ground contact time, vertical ratio and step length from streams `cadence`, `groundContactTime`, `verticalOscillation`, `stepLength`. Two things Garmin does not do:

- **Compare at the same pace.** Dynamics change with speed, so a trend of raw means only shows that runs got faster or slower. Bin samples by speed (0.25 m/s bins) and trend each bin.
- **Form fade inside a run:** last quarter against first quarter at matching speed. Rising contact time with falling cadence is fatigue.

**Bike:** cadence histogram, variability index, time above FTP, `powerTimeInZone_1` to `_7`, W' balance through the ride (Skiba integral model, from CP and W' in 2.8) for interval sessions.

**Strength:** the matched LogEveryLift session is the truth for sets and loads. Garmin adds HR per set and rest length (FIT `sets`: `duration`, `setType`, `startTime`). View: HR trace with set blocks under it, and mean HR recovery in the rest periods.

### 2.11 Sleep debt and regularity

- **Sleep debt:** for the last 14 nights, `need - actual` (need as in 2.6; naps from `napTimeSeconds` count at half value). Each older night weighs less (`0.85^days ago`). A surplus night repays at most 1 h. Clamp at zero.
- **Regularity index (0 to 100):** build a minute-by-minute asleep or awake series for 14 days from the sleep windows. The index is the share of minutes whose state matches the state 24 h later, scaled so that chance is 0. This is the Sleep Regularity Index, on windows only (the API has no stage timeline, so short wake periods are not seen; say so in the info sheet).
- **Timing spread:** standard deviation of sleep onset and of wake time, in minutes, with clock times handled on a circle.
- **Weekday against weekend midsleep** (social jetlag), in minutes.

Why better: Garmin scores each night on its own. Regularity and debt are the two sleep numbers with the best evidence for performance, and neither is in Garmin Connect.

### 2.12 Correlations

A fixed list of pairs, chosen now, so the page does not go hunting for chance hits:

1. Sleep duration last night against today's EF (steady sessions only)
2. Sleep score against today's EF
3. HRV last night against the 7-day mean, against today's EF
4. Yesterday's total load against HRV tonight
5. Yesterday's high-band minutes against HRV tonight
6. Strength load yesterday against next-day run EF
7. Last session end time (hours before sleep) against HRV tonight
8. Sleep debt against decoupling
9. Sleep regularity (14 days) against the 7-day HRV mean
10. Daily steps outside training against HRV tonight

Method: Spearman rank correlation. Shown only with 20 pairs or more and an absolute value of 0.3 or more. Each one is also stated as a split ("after 7.5 h or more, EF is 4 % higher; 31 sessions") because a split is easier to act on. Wording always says "goes with", never "causes".

### 2.13 Race readiness and taper

Needs a race date (open decision O-1). Until then the race day is the last day of the active cycle (`startDate` plus `durationWeeks`).

- **Projection:** run the 2.3 model forward to race day. Future load per week = this week's load per sport, scaled by the ratio of future to current `periodizedLoad` multipliers. Show projected fitness, fatigue and form with a band (plus and minus 15 % load).
- **Target on race morning:** form of plus 10 to plus 25, with fitness down no more than 10 % from its peak. Outside that, say what to change ("taper starts one week early: fitness drops 14 %").
- **Checklist, each row with its evidence and a link to the activity:**
  - Longest ride in the last 8 weeks: 4.5 h or more
  - Longest run: 2.5 h or more
  - Longest continuous swim: 3.0 km or more
  - Decoupling under 5 % on a ride of 3 h or more
  - Durability (2.7) of 0.90 or more
  - A ride-then-run session in the last 4 weeks (run starts within 15 min of a ride ending)
  - Ramp rate never above 8 in the last 6 weeks
- **Pacing guide:** bike at 68 to 75 % of estimated FTP with a ceiling at the top of the low HR band; lower end when durability is under 0.90. Stated as a guide, not a prediction. No finish-time prediction (it needs drag and course data we do not have).

### 2.14 Feedback into the periodized plan

Three links, in order of risk:

1. **Compliance (read only).** Match Garmin activities to planned endurance sets of the active cycle by date and discipline. Show planned against done distance per week per sport, and actual HR band against `targetHeartRateZone`. Feeds the Load tab.
2. **Advice on today's session (read only).** Readiness band plus the plan's phase gives a line on the Today tab and on the workout header: "Planned: threshold intervals. Readiness 41: swap for the easy ride from Thursday."
3. **Adaptation.** `computeAdaptationFactor` takes adherence, readiness and RPE today. Add an optional wearable signal object (*new*): HRV state, resting HR flag, sleep debt, total form, ramp rate, ACWR. New rules, checked before the existing ones:
   - HRV "Fatigued and stuck" or (HRV "Strained" and a resting HR flag): 88 %, "Eased: HRV has been under your normal range for a week."
   - ACWR above 1.3 or ramp rate above 8: 92 %, "Eased: load rose too fast."
   - Sleep debt above 6 h: 95 %.
   - The boost to 105 % also needs HRV "Balanced" or "High" when wearable data exists.
   - The band stays 88 to 105. With no wearable data the function behaves exactly as today (existing tests must pass unchanged).

   Whether this applies itself or only suggests is open decision O-3. Recommended: suggest first, shown on the cycle page with an "Apply" button, for four weeks. Then decide.

## 3. Visualisations

### 3.1 Shared rules

- One y axis per chart. Two measures with different units get two charts stacked on a shared x axis.
- These rules hold for every engine in 6.1 (`uplot`, `echarts`, plain SVG, the map).
- Lines 1.5 px. Bars with 2 px gaps. No gradients except one soft area fill under a single line.
- **Crosshair on every chart:** press and drag. A vertical rule follows the finger, a readout row above the chart shows the values (not a floating box, which the finger hides). Haptic tick on entry (`src/lib/utils/haptics.ts`). Vertical scroll still works: the chart takes the gesture only after 150 ms of press or a horizontal move.
- Legend for two or more series, placed above the chart, tappable to hide a series.
- **Colour is never alone.** Sports have a colour and a letter mark (S, B, R, G). Zones have a colour and a position. States have a colour, an icon and a word.
- Fixed colour roles, defined once as CSS variables next to the existing `--chart-1` to `--chart-5` in `src/app/globals.css`: swim, bike, run, strength; low, mid, high band; good, caution, bad. Check each against the dark background for 3:1 contrast and with a colour-blind simulator before use.
- Baseline bands are drawn as a grey band behind the line. A value is judged by where it sits in its band.
- Every chart has a text summary in `aria-label` and a "show as table" option in its info sheet.
- Reference: load the `dataviz` skill before writing the first chart component.

### 3.2 Today

| View | Form | Encoding and interaction | Why it beats Garmin |
|---|---|---|---|
| **Readiness** | Big number with a word, then six horizontal bars from a centre line | Bar length = points above or below neutral for each contributor. Tap a bar for its inputs | Garmin shows a dial. This shows the cause |
| **Insight feed** | 1 to 3 cards | Severity icon, one sentence, one number, a link to the chart that proves it | Garmin's phrases have no evidence link |
| **24 h timeline** | One chart, noon to noon, so the night sits in the middle | HR line (2 min points). Sleep window as a shaded block. Activities as coloured blocks on a lane under the axis with the sport mark. Resting HR as a dotted line. SpO2 hourly as a second small chart on the same x axis. Crosshair reads all | Garmin splits this over five screens |
| **Overnight HRV** | Dot and line chart inside the sleep window | 5 min readings, the baseline band behind, the night mean as a line, first-half and second-half means marked | Garmin shows a mean and a tiny chart with no band |
| **7-day strip** | 7 small columns | Readiness as a dot on a 0 to 100 scale, load as a bar under it. Two tiny charts, shared x | Shows whether today is a blip or a trend |

Body battery intraday is not charted: about 6 points a day, mostly null. Charged and drained totals appear as two numbers under the timeline. Stress has daily durations only: one stacked bar (rest, low, medium, high) per day in the Sleep tab.

### 3.3 Load

| View | Form | Encoding and interaction |
|---|---|---|
| **Fitness, fatigue, form** | Two stacked charts, shared x | Top: fitness (thick line) and fatigue (thin line), same unit so one axis is right. Bottom: form as bars from zero, on banded background (fresh, neutral, productive, overreaching). Daily load as faint ticks at the bottom of the top chart. Race day as a vertical marker. The future is dashed with an uncertainty band. Chips: Total, Swim, Bike, Run, Strength. Range: 6 w, 3 m, 1 y, all. Pinch is not used; range chips are easier on a phone |
| **Weekly load** | Stacked bars by sport, 12 weeks | Planned load of the cycle as a step line over it. Deload weeks marked. ACWR as a small dot row under the bars with the 1.3 line |
| **Zone distribution** | One 100 % stacked bar per week | Low, mid, high. The target band drawn as brackets. Polarization label under each bar |
| **Ramp rate** | Single number with a small line | Bands at 5 and 8 |
| **Race card** | Countdown, projected form on race morning, the checklist | Each checklist row: met or not, the value, the best activity |

Garmin Connect has no fitness and form chart with strength in it, no plan overlay, and no projection.

### 3.4 Sleep

| View | Form | Encoding |
|---|---|---|
| **Sleep timing** | Floating bars, 28 nights, y = clock time (18:00 to 12:00) | Bar from onset to wake. Stage totals are not drawn inside it (no timeline exists, and faking one misleads). Median onset and wake as lines. Regularity index as the headline number |
| **Duration against need** | Bars with a need marker per night | Bar = slept. Tick = need. Debt as a running line on a second chart below |
| **Stages** | 100 % stacked bars per night | Deep, light, REM, awake as shares. Honest about being totals |
| **HRV baseline** | Line with band, 90 days | Nightly dots (faint), 7-day mean (line), band (grey), state changes marked. CV7 as a second chart under it |
| **Resting HR** | Same form | Sleeping low point as a second series, with legend |
| **What moves my HRV** | Ranked horizontal bars | The correlations of 2.12 that pass the bar, each tappable to its scatter plot |

### 3.5 Activities

- **Calendar heatmap:** 7 rows (Monday first), one column per week, scroll back through all history. Cell shade = load of the day (5 steps). A small coloured corner shows the main sport. Tap a cell for the day's sessions. Garmin's calendar shows icons, not load.
- **List:** each row has sport mark, name, duration, distance, load, and a 60 px HR sparkline from the stored preview (6.2). Filter chips by sport. Planned sessions of the cycle that have no activity show as hollow rows.

### 3.6 Activity deep view

Top to bottom:

1. **Header:** sport, date, duration, distance, load with its method, and one verdict line from the rules ("Steady aerobic ride. Decoupling 3.1 %: base is holding at 2 h.").
2. **Route map** (only with GPS): MapLibre with the dark tiles already used in `src/components/features/GymMapClient.tsx`, loaded with a dynamic import as that file does. The line is coloured by a chosen stream: HR band, pace or power band, altitude. A dot on the route follows the crosshair of the charts below, and dragging on the route moves the crosshair.
3. **Stream charts, stacked, one linked crosshair:** HR (zone bands as the background), power or pace, cadence, altitude (area). Each chart has its own y axis and unit. Toggle x axis between time and distance. Lap borders as thin vertical lines. A 30 s smoothing toggle for power. The readout row shows all streams at the crosshair. Drag two fingers to select a range: the readout then shows means for the range (the feature coaches use most, and Garmin's app lacks).
4. **Laps table:** time, distance, mean HR, mean power or pace, with a small bar per row. Tap a lap to select its range in the charts.
5. **Zones:** horizontal bars for the 5 HR zones and the 7 power zones, and the three-band split with the label.
6. **Decoupling:** first half against second half as two bars of EF, with the validity note from 2.7.
7. **Best efforts in this session:** the session's power or pace curve as a line over the 90-day curve as a band. New bests are marked.
8. **Sport block:** run dynamics by speed bin; swim lengths as a bar per length (pace, coloured by stroke, rests as gaps); strength sets joined with the LogEveryLift session, with a link to it.

### 3.7 Trends

| View | Form | Encoding |
|---|---|---|
| **Power curve** | Line, x = duration on a log scale | Last 42 days (line), last 365 days (line, dashed), all time (band top). The CP model as a thin curve. Crosshair shows watts, W/kg (from stored weight) and the date of each best |
| **Pace curve** | Same form, x = distance on a log scale | y inverted so faster is up |
| **Thresholds over time** | Step lines | Estimated FTP, CP, critical speed, LTHR. One chart per unit. Stale spans greyed |
| **Efficiency trend** | Scatter with a 28-day median line | One dot per steady session, per sport. Dot size = duration. Only valid sessions (2.7) |
| **Decoupling against duration** | Scatter | x = session length, y = decoupling, the 5 % line. Shows how long the base holds. This answers "can I hold it for 5 hours" |
| **Durability** | Paired dots per long ride | Fresh against fatigued 20-minute power |
| **Run dynamics** | Small multiples by speed bin | Cadence and contact time over months |
| **Correlations** | Scatter per pair | The split statement on top, Spearman value and count under it |

## 4. Insights layer

### 4.1 Rules

A pure function (*new*, `src/lib/garmin/analytics/insights.ts`): `(daily metrics of 90 days, recent activity metrics, plan state) -> Insight[]`. An insight has an id, a severity (`info`, `good`, `caution`, `warning`), a sentence, the numbers used, and a link target.

Starting rule set:

| Id | Fires when | Sentence pattern |
|---|---|---|
| `hrv_low_week` | HRV state "Strained" or "Fatigued and stuck" | "HRV has been under your normal range for N days. Keep today easy." |
| `rhr_up` | Resting HR flag for 2 days | "Resting HR is N bpm over your 60-day normal for the second day." |
| `ramp_fast` | Ramp rate above 8 | "Fitness rose N points this week. Over 8 raises injury risk. Hold volume next week." |
| `acwr_high` | ACWR above 1.3 | "This week's load is N x your last three weeks." |
| `monotony` | Monotony above 2.0 and week load above the 4-week mean | "Every day this week was a similar medium day. Make easy days easier." |
| `too_much_mid` | Mid band above 30 % for 2 weeks in base or build | "N % of your time was between easy and threshold. Target is under 20 %." |
| `sleep_debt` | Debt above 5 h | "You are N h short on sleep over two weeks." |
| `sleep_irregular` | Regularity under 70, or onset spread above 60 min | "Your bedtime moved by N min night to night." |
| `late_session_hrv` | Correlation 7 passes and today's session ended under 3 h before the usual bedtime | "Sessions that end late go with lower HRV for you (N nights)." |
| `decoupling_good` | Under 5 % on a ride longer than any earlier valid one | "Longest ride yet with steady HR against power: N h at N %." |
| `decoupling_poor` | Above 8 % on a valid session | "HR drifted N % in the second half. Check fuel, heat (N C) or pace." |
| `new_best` | A best in the 90-day curve | "Best 20 min power in 90 days: N W." |
| `ftp_stale` | No effort near the curve in 90 days | "No hard 20 min effort since DATE. The FTP estimate may be off." |
| `lthr_gap` | Our LTHR differs from the watch by more than 4 bpm | "Your zones on the watch use LTHR N. Recent efforts point at N." |
| `strength_before_key` | Heavy leg session under 24 h before a planned quality run or ride | "Heavy legs yesterday. Expect lower power today." |
| `form_race` | Projected race-day form outside plus 10 to plus 25 | "On the current plan you reach race day at form N." |
| `long_gap` | Checklist row not met with under 8 weeks to go | "No ride over 4.5 h in the last 8 weeks." |
| `fresh` | Readiness 75 or more and form above 5 on a planned quality day | "Good day for the hard session." |

Rules for the rules:

- Thresholds are named constants at the top of the file with a comment giving the source.
- Each rule has a minimum data need. Not enough data means the rule stays silent.
- At most three insights on Today, ranked by severity then recency. The rest sit under "More".
- An insight that fired on each of the last 7 days is collapsed to one line.
- No dismiss state in the first version (no table for it).

**Wording style:** second person, present tense, one fact and one action, numbers with units, no exclamation marks, no praise words. Health framing stays on training ("keep today easy"), never medical ("you may be ill").

### 4.2 AI layer

Two paths. Build the first; the second is optional.

**Path 1: MCP tools (recommended, no model cost).** The app already serves an MCP endpoint (`src/app/api/[transport]/route.ts`, tools in `src/lib/mcp/tools/`). Add read-only tools (*new*, `src/lib/mcp/tools/garmin.ts`):

| Tool | Returns |
|---|---|
| `garmin_fitness_summary` | Today's readiness with contributors, fitness, fatigue and form per sport, thresholds, the current insights |
| `garmin_daily_metrics` | The daily metric rows for a date range (max 180 days per call) |
| `garmin_activities` | Activity metric rows for a range, filter by sport |
| `garmin_activity` | One activity: metrics, laps, downsampled streams. **No latitude or longitude** |
| `garmin_race_readiness` | The projection and the checklist |

The user connects their own assistant and decides what it reads. The model there is as strong as the user's own subscription, which fits the owner's rule that the app does not pay for tokens (`docs/ai-setup-plan.md`, decision D-4). `userId` comes from the token, never a parameter, as in the existing tools.

**Path 2: in-app weekly summary (optional).**

- **What is sent:** the insight list, weekly totals per sport, fitness, fatigue and form, zone shares, sleep means, plan phase and week. Derived numbers only. No raw streams, no GPS, no clock times, no name, no email, no birth year (age band as in D-5), no body weight.
- **What comes back:** a summary of 120 words or fewer and up to three suggestions, as JSON checked with Zod.
- **Guard:** every number in the answer must also be in the input. Otherwise the answer is dropped and the rule-based text is shown. The model ranks and phrases; it does not compute.
- **Model tier:** the smallest tier is enough because the facts are already computed. Use the existing call path and the free-model guard in the repo's AI code. Sending health-derived numbers to a free model provider is the real question; see open decision O-4.
- **Opt-in:** the existing `aiConsentAt` gate, with the consent text extended to name Garmin-derived metrics. This is a new category sent to a new purpose, so run the `privacy-compliance` skill first (data inventory row, policy text, consent version).
- **Cache:** one row per user and ISO week, keyed by a hash of the input and the model. Made at most once a day. Not shared between users (it holds health data, unlike `ai_plan_cache`).
- **Limit:** the existing daily usage limit applies.

## 5. Privacy

Run the `privacy-compliance` skill before each phase that adds a table or a recipient. Known points:

- The two new tables hold derived health data. Add them to `docs/privacy/data-inventory.md`, to the account export, and to "Disconnect and delete Garmin data". Both cascade on user delete.
- The activity preview holds a simplified GPS route. It is covered by decision G-2 of the ingestion plan and by its "before any public launch" list.
- MCP tools expose health data to a client the user connected. The OAuth consent page (`src/app/oauth/consent/page.tsx`) must name it. Check whether the existing scope text covers health data or needs a new scope.
- LogEveryLift `readiness` and `feeling` enter the readiness score. No new sharing: friends never see Garmin pages.
- Logs: ids and short tags only, as the repo rule says. No metric values in `console.error`.

## 6. Technical approach

### 6.1 Chart and map tooling: the best tool per job

The owner's direction (2026-11-11): no visualisation limits, libraries are welcome. So each job gets the tool that is best at it. Three engines, all loaded on demand, none in the initial bundle. The data-viz rules of 3.1 apply whatever draws the chart.

Sizes below are rough and from memory. Measure each with the bundle analyser in phase A and write the real numbers here.

| Job | Pick (exact npm package) | Rough gzipped size |
|---|---|---|
| Dense time series with linked crosshair: activity streams, 24 h HR, overnight HRV | `uplot` | about 20 KB |
| All other charts: fitness and form, weekly bars, calendar heatmap, duration curves, scatter, sleep timing, zone bars | `echarts` (imported from `echarts/core`, only the parts used) | about 150 to 180 KB tree-shaken (about 330 KB if imported whole) |
| Route map coloured by HR, pace or power | `maplibre-gl` (already installed), no extra package | 0 added |
| Tiny marks in lists and tiles: 40-point sparklines, readiness contributor bars | Plain SVG in React, no library | 0 |

#### `uplot` for dense streams

- **Why it wins:** it is the fastest time-series engine for the browser. It draws tens of thousands of points on canvas and keeps the cursor at 60 fps. Cursor sync across charts is built in (`uPlot.sync`), which is exactly the linked crosshair of the deep view. Each stream gets its own `uplot` instance with its own single y axis, stacked on a shared x axis. It also means the deep view can show more points than SVG could (6.4).
- **Dark theme:** it has no theme system. All colours are options. Read the CSS variables with `getComputedStyle` when the chart is made, and make it again when the theme changes.
- **Touch on iOS Safari:** its built-in cursor follows the mouse, and touch support is thin. Write one small plugin (*new*) that maps `touchstart` and `touchmove` to `setCursor`, and a second for two-finger range select. Set `touch-action: pan-y` on the chart so the page still scrolls. It handles the device pixel ratio itself.
- **Access:** canvas has no text. Give each chart an `aria-label` summary and the "show as table" sheet.
- **React:** no wrapper package. One hook (*new*, about 40 lines) that creates the instance in an effect, updates data with `setData`, and destroys it on unmount.
- **Rejected for this job:**
  - `echarts` can do it with LTTB sampling, but five stacked streams of thousands of points cost more memory and the cursor is slower on a phone.
  - `dygraphs`: older, larger, weaker touch.
  - `lightweight-charts`: made for finance candles; its time axis assumes market data.
  - Hand-made SVG: fine to about 800 points, which forces heavy downsampling.

#### `echarts` for everything else

- **Why it wins:** it has every form this plan needs ready to use: calendar heatmap, log axes, scatter with size, stacked and floating bars, bands (`markArea`), reference lines (`markLine`), dashed projections, and several grids in one instance with a linked axis pointer. That last one gives stacked charts with one y axis each and one shared crosshair, which is the rule in 3.1. The `custom` series type draws anything else (sleep timing bars, paired durability dots). Nothing here is blocked by the library.
- **Bundle:** import from `echarts/core` and register only what is used: line, bar, scatter, heatmap and custom series; grid, calendar, tooltip, axis pointer, legend, mark line, mark area, visual map and aria components; the canvas renderer. Never `import * as echarts from "echarts"`.
- **Dark theme:** register one theme (*new*) built from the app's CSS variables, with transparent background. Rebuild it when the theme changes.
- **Touch on iOS Safari:** touch is built in. The tooltip and axis pointer follow a finger. Use the axis pointer with the readout row above the chart (3.1), not the floating tooltip box. Do not enable inside zoom by default: it captures vertical scroll. Range chips change the range.
- **Colour not the only channel:** the `aria` component writes a text description, and its decal option adds patterns to series. Use both.
- **iOS canvas memory:** Safari limits total canvas memory. Dispose each instance on unmount, render only the charts of the open tab, and use one instance with several grids instead of several instances where charts are stacked.
- **React:** no wrapper package (`echarts-for-react` is thin and lags behind). One hook (*new*): init in an effect, `setOption`, a `ResizeObserver`, `dispose`.
- **Rejected for this job:**
  - `@visx/*` with `d3-scale` and `d3-shape`: full control, React and SVG, about 40 to 60 KB for the parts used. The best choice if every chart were bespoke. It loses because every interaction (crosshair, legend toggle, touch, heatmap layout) must be written by hand, and that is most of the work in this plan. Keep it as the fallback for any chart where ECharts' look cannot be made right.
  - `@observablehq/plot`: fast to write and good defaults, about 70 to 90 KB with its D3 parts. Interaction is thin and it is not made for app UI.
  - `recharts`: about 100 KB, slow with many points, weak touch, no heatmap.
  - `chart.js`: smaller than ECharts, but no calendar heatmap, no multi-grid linked pointer, and bands need plugins.
  - `plotly.js`: over 1 MB.

#### `maplibre-gl` for coloured routes

- **Why it is enough:** a line layer can be coloured along its length without any other package. Two ways, both built in:
  - Smooth colour: a GeoJSON source with `lineMetrics: true` and a `line-gradient` paint expression over `line-progress`. Build the gradient stops from the stream (HR, pace, power or altitude) at the route's kept points.
  - Hard zone colours: one short line feature per segment with a `band` property, and a data-driven `line-color`. Use this for HR and power bands, because zones are steps, not a blend.
- **Crosshair link:** a circle layer with one point, moved with `setData` as the crosshair moves. Dragging on the map finds the nearest route point and sets the crosshair.
- **Also built in, for later:** 3D terrain, and a heatmap layer for "everywhere I have trained".
- **Loading:** dynamic import, as `src/components/features/GymMapClient.tsx` already does. Only on an activity with GPS, after first paint.
- **Touch and dark theme:** already proven in the app with the dark OpenFreeMap tiles.
- **Rejected:** `deck.gl` (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/mapbox`), about 200 KB or more. Its path layer colours per segment and its trips layer animates a route. It wins only for animated replays or very large point sets. Add it later if an animated race replay is wanted; nothing in this plan needs it. `leaflet` has no vector styling of this kind. `mapbox-gl` needs a paid token.

#### Keeping it out of the initial bundle

- One Client Component per engine (*new*): `src/components/charts/StreamChart.tsx` (`uplot`), `src/components/charts/EChart.tsx` (`echarts`), `src/components/charts/RouteMap.tsx` (`maplibre-gl`). Each is loaded with `next/dynamic` and `ssr: false`, and each imports its library inside.
- Tabs load what they use: Today loads `uplot`; Load, Sleep and Trends load `echarts`; Activities loads `echarts` for the heatmap; the deep view loads `uplot`, then `echarts` and the map when they scroll into view.
- Each chart has a skeleton of the same height, so nothing jumps when the library arrives.
- The service worker (`src/app/sw.ts`) caches the chunks after first use, so the cost is paid once.
- Check after phase A: the home page and the workout screen bundles must not grow.

#### Shared code (all pure, unit tested)

- `src/lib/garmin/charts/` (*new*): one function per chart that turns metric rows into an ECharts option or a `uplot` data and options pair. Components only mount them. This is where the data-viz rules are enforced and tested (one y axis per grid, legend present for two or more series, colour roles from tokens).
- One small crosshair store per page (*new*) links `uplot` charts, the ECharts panels and the map dot.

### 6.2 Where computation happens

**Precompute per activity and per day, in the worker. Compute insights on read.**

Two new tables (one migration, `pnpm db:generate`, committed as CLAUDE.md requires):

`garmin_activity_metrics` (*new*)

| Column | Notes |
|---|---|
| `user_id`, `garmin_activity_id` | Unique together. Cascade on user delete |
| `model_version` | Integer. A bump recomputes |
| `sport` | swim, bike, run, strength, other |
| `day` | Local calendar date |
| `load`, `load_method` | 2.2 |
| `metrics` jsonb | NP, IF, EF, decoupling and its validity, three-band seconds, thresholds used, best efforts (duration or distance, value), run dynamics by bin, matched LogEveryLift session id |
| `preview` jsonb | Downsampled streams and simplified route (6.4), laps |
| `computed_at` | |

`garmin_daily_metrics` (*new*)

| Column | Notes |
|---|---|
| `user_id`, `day` | Unique together |
| `model_version` | |
| `metrics` jsonb | Load per sport, fitness, fatigue and form per sport and total, ramp, HRV ln, 7-day mean, band, CV7, state, resting HR and baseline, sleeping low point, sleep seconds, need, debt, regularity, readiness with contributors |
| `computed_at` | |

One jsonb column per table, typed by a Zod schema in code. A new metric is then a code change, not a migration. Two years is about 730 small rows; reading them all for a chart is one indexed query.

**Worker steps** added to `runGarminWorkerTick` in `src/lib/garmin/worker.ts`, after the existing three:

4. Compute activity metrics for up to N activities that have streams and no row at the current `model_version`. This is the costly step (a stream has thousands of points), so it is bounded per tick.
5. If anything changed since the last daily run (new day rows, new activity metrics, a LogEveryLift session completed later than the stored time), recompute the **whole** daily series for the user. It reads small precomputed rows and takes milliseconds, so there is no partial-update logic to get wrong.

Two columns on `garmin_connections` (*new*): `metrics_computed_at`, `metrics_version`.

The worker reads LogEveryLift sessions; it does not hook into finishing a workout. That keeps this work out of the critical flow.

**On read:** pages select rows from the two tables. Insights, the race projection and correlations are computed from those rows in the request (pure, fast). Threshold estimates over time are derived from the best efforts stored per activity.

**Model version rule:** any change to a formula bumps `model_version` and the worker refills the tables. The info sheets show the version.

### 6.3 FIT parser v2

Bump `FIT_PARSER_VERSION` in `src/lib/garmin/fit.ts` and keep two more message types: `lengthMesgs` (pool lengths: time, strokes, stroke type) and `eventMesgs` (timer stop and start). The stored ZIPs make a re-parse possible without calling Garmin. Needs two new jsonb columns on `garmin_activity_streams` (in the same migration). Verify the field names on the first real swim file before building the swim views.

### 6.4 Downsampling and payloads

- **Stream preview for the deep view:** at most 3000 points per stream. `uplot` draws that with ease, so the limit is the payload, not the chart. A session under 50 minutes at 1 Hz is sent whole. Longer ones are reduced by largest-triangle-three-buckets on HR so peaks survive, with the same indexes used for all streams so they stay aligned. Power also keeps a per-bucket max. Arrays are sent as columns with one decimal at most.
- **Route:** Douglas-Peucker to at most 500 points, with the stream index of each kept point so the map dot can follow the crosshair.
- **List sparkline:** 40 points of HR.
- **Day timeline:** HR at 2 min is already about 720 points; sent as is, as two typed arrays.
- **Zoom:** not in the first version. If needed later, an action returns a full-resolution window.

### 6.5 Performance budget

| Item | Budget |
|---|---|
| Today tab, server data | 40 KB gzipped |
| Activity deep view data | 120 KB gzipped |
| Load tab with 2 years | 50 KB gzipped |
| Chart JS in the initial bundle of any page | 0. `uplot`, `echarts` and `maplibre-gl` are separate chunks (6.1) |
| First chart visible after tab open, warm cache | Under 300 ms |
| MapLibre | Loaded only on an activity with GPS, after first paint |
| Crosshair | 55 fps or more on the owner's phone, five stacked streams |
| Activity metrics, one 2 h ride | Under 150 ms in the worker |
| Daily series, 2 years | Under 50 ms |

Each tab has a `loading.tsx` skeleton (the route already has one).

### 6.6 Server code

- Reads for Server Components live in `src/lib/garmin/queries.ts` (*new*), each taking a `userId` already resolved by `requireSession()` in the page, as `src/lib/periodization-sync.ts` does. The same functions serve the MCP tools.
- Mutations stay Server Actions on the canonical template. This plan adds few: refresh, set race date, apply a suggested adaptation.
- Every query filters by `userId`. An integration test reads another user's activity id and expects nothing.

### 6.7 Testing

- **Unit, one file per model** in `src/__tests__/`, on synthetic input with a known answer:
  - Constant load of 100 a day converges to fitness 100 and form 0.
  - NP of constant power equals that power; of an on-off pattern it is above the mean.
  - Two equal halves give 0 % decoupling; a 10 % HR rise at fixed power gives about 9 %.
  - Bests generated from an exact CP model return that CP and W'.
  - Identical sleep windows give regularity 100; random ones give about 0.
  - Readiness with a missing contributor rescales weights; with two signals it returns none.
  - Each insight rule: fires at the threshold, silent under it, silent with too little data.
  - `computeAdaptationFactor` with no wearable signals returns exactly what it does today.
- **Unit:** the chart builders in `src/lib/garmin/charts/`: one y axis per grid, a legend when there are two or more series, colours from the role tokens, gaps kept as gaps. Downsampling keeps the maximum and the alignment.
- **Integration** (`pnpm test:int`): the worker fills both tables from seeded rows; a version bump refills; ownership; a matched strength session counts once.
- **Component** (jsdom): canvas does not render in jsdom, so test the crosshair store and the readout row: setting the crosshair updates the readout text of every linked chart. The engines are mocked.
- **e2e for interaction:** on WebKit and Chromium, a touch drag on a stream chart changes the readout, and the page still scrolls with a vertical swipe that starts on a chart.
- **Fixtures:** synthetic only. Never commit the owner's real files or values. The existing synthetic FIT test in `src/__tests__/garmin-ingest.test.ts` is the pattern.
- **e2e:** one spec that seeds metric rows through `testDb()` and checks each tab renders with no page exception. Not a critical flow, so no smoke pass is required, except phase F, which changes the weekly sync.
- `pnpm verify` before each phase is reported done.

## 7. Phases

Each phase is shippable alone, on the local branch (decision G-5 of the ingestion plan).

### Phase A: engine and chart tooling

- Migration: the two tables, the two connection columns, the two stream columns.
- FIT parser v2 and the re-parse.
- Models 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.11. Worker steps 4 and 5.
- Add `uplot` and `echarts`. The three chart components of 6.1, the theme, the touch plugins, the crosshair store, and the colour roles. Measure the chunks and write the sizes into 6.1.
- Proof on screen: the Load tab with the fitness, fatigue and form chart and weekly load bars.
- Tests as listed. Privacy skill for the new tables.

### Phase B: Today and Sleep

- Readiness (2.6), the first ten insight rules, the 24 h timeline, overnight HRV, the 7-day strip.
- Sleep tab: timing, need and debt, stages, HRV and resting HR baselines.
- Day route. Overview tab and `GarminMetricsTab` removed (ask first if any part should stay, per the owner's rule on removing features).

### Phase C: Activities and the deep view

- Calendar heatmap and list.
- Deep view: linked stream charts, range select, laps, zones, decoupling (2.7), map coloured by stream, strength join.
- Link from a History session to its Garmin activity.

### Phase D: Trends

- Curves, CP and W', thresholds over time (2.8), efficiency and decoupling trends, durability, run dynamics by speed bin (2.10), correlations (2.12).
- Swim views once a real swim file is in.

### Phase E: Race

- Race date, projection, checklist, pacing guide (2.13). Race card on Load, countdown on Today.

### Phase F: Plan feedback

- Compliance, advice on today's session, wearable signals in `computeAdaptationFactor` (2.14), suggest-first.
- This touches the weekly sync: integration tests, `make e2e`, and the smoke pass.
- Delete the BACKLOG entry "Wearable-based autoregulation (Tier B) for triathlon plans" when done.

### Phase G: AI

- MCP tools (path 1). Privacy skill for the consent text.
- In-app weekly summary (path 2) only if the owner says yes to O-4.

Order rationale: A gives the numbers and the tools every later phase uses. B is what the owner opens each morning. C is the largest visual gain over Garmin. D needs more history, which the import will have brought in by then. E and F need D's thresholds. G reads everything.

## 8. Open decisions for the owner

Settled 2026-11-11 (see I-6): O-1, O-2, O-3, O-11, and O-5 by default. Still open: O-4, O-6, O-7, O-8, O-9, O-10. Each is settled before the phase that needs it.

- **O-1 Race date.** Add a race date and distance (Ironman or 70.3) to the cycle, or keep deriving race day from the end of the cycle? Recommended: add both to `training_cycles`.
- **O-2 Strength in fitness.** Should strength load count toward total fitness (CTL), or only toward fatigue? Recommended: both, with the Strength chip to see it apart. The 0.22 scale factor should be tuned after four weeks of data.
- **O-3 Auto-adapt.** May wearable signals change the weekly plan on their own, or only suggest? Recommended: suggest for four weeks, then decide.
- **O-4 In-app AI.** Build the in-app summary at all? It means sending health-derived numbers to a model provider. Free models may keep prompts. Options: MCP only (recommended), a paid model with a no-retention setting, or free models with the consent text saying so.
- **O-5 Zones.** Use Garmin's stored zones for display, or our own bands from estimated LTHR and FTP? Recommended: ours for the models, Garmin's five zones for the per-activity bars, with the gap raised as an insight.
- **O-6 Manual thresholds.** Allow manual entry of FTP, threshold pace and swim CSS, which overrides the estimates? Recommended: yes, small form in the Trends tab, because early on there is too little history.
- **O-11 Chart engines.** `echarts` is picked over `@visx/*` for the non-stream charts because it gives the most forms and interaction for the least code. The cost is about 150 KB or more in an on-demand chunk and a less hand-made look. Say so if a fully bespoke look matters more; then visx with D3 is the pick and phases A to D take longer.
- **O-7 Tabs.** Six pills in a scroll row, or fewer tabs with longer pages? Recommended: six.
- **O-8 Overview removal.** Remove the current Overview tab once Today ships, or keep it during the transition?
- **O-9 Other users.** Normal users have 90 days of history. Fitness needs 42 days and baselines 60, so it works, but curves are thin. Is the insights layer for the owner only (admin) until a public launch decision, or for every connected user?
- **O-10 Menstrual cycle and food data.** Stored but not used in any model here. Use cycle phase as a readiness and HRV context later, or leave out?
