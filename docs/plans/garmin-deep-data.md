# Garmin deep data: plan

> **Status:** phase 1 merged to `main` (PRs #208 and #215).
> **Written:** 2026-11-11, after probing all 26 Personal API endpoints with the owner's account.

Written to be picked up with no conversation history. Read section 0 first.

## 0. Start here

### Goal

Pull everything the Garmin Connect Personal API gives a user, keep it, and show it better than Garmin Connect does: intraday timelines, second-by-second activity data, our own training-load model, and insights that join Garmin data with the strength training logged in LogEveryLift. The owner is training for an Ironman and wants AI help tuning it, so the data must also be easy for an AI to read.

### What already exists (PR #208, branch `feat/garmin-metrics`)

- Settings → Connections → Garmin Connect: paste a Personal API key, stored encrypted (`src/lib/utils/crypto.ts`).
- `syncGarmin` (`src/lib/garmin/sync.ts`): HRV, sleep and daily summaries plus the activity list, saved as raw JSON in `garmin_days` and `garmin_activities`, one `garmin_sync_runs` row per sync.
- A Garmin tab inside Progress (`src/components/features/GarminMetricsTab.tsx`); phase 1 moved it to its own page, More → Garmin, as the Overview tab.
- Feature flag: `GARMIN_KEY_ENCRYPTION_KEY` set or not.

### Decisions (2026-11-11, from the owner)

- **G-1 Own page.** Garmin data moves out of Progress into its own page, More → Garmin (`/more/garmin`), with its own tabs, so it has room for rich views. Not a bottom-nav item (the owner, 2026-11-11).
- **G-2 GPS kept.** FIT streams keep latitude and longitude, for route maps. Revisit before any public launch. (The activity summary JSON keeps having GPS fields stripped; the stream is the one place it lives.)
- **G-3 History.** A new connection syncs 30 days at once, then imports older days in the background. Normal users stop at 90 days back. Admins import everything Garmin has.
- **G-4 Scope.** All 26 endpoints, including nutrition, menstrual cycle and body composition (empty answers store nothing).
- **G-5 Branch.** All phases stay on the local branch until the owner is happy. No merges.

## 1. The API, as measured

Host `https://personal.connectapi.garmin.com`, Bearer token from the key (24 h, no refresh). Paths from Garmin's Swagger page; limits from its descriptions.

| Kind | Path | Shape | Limit |
|---|---|---|---|
| range | `/hrv-service/hrv/daily/{from}/{to}` | `{hrvSummaries: []}`, **204 when empty** | |
| range | `/sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate` | `[]` | |
| range | `/usersummary-service/v2/dailysummaries?startDate&endDate` | `{data: []}` | 1 year |
| range | `/usersummary-service/stats/steps/daily/{start}/{end}` | `[]` | 28 days |
| range | `/usersummary-service/stats/stress/daily/{start}/{end}` | object | 28 days |
| range | `/usersummary-service/stats/hydration/daily/{start}/{end}` | `[]` | 31 days |
| range | `/weight-service/weight/range/{start}/{end}?includeAll=true` | `{dailyWeightSummaries}` | |
| range | `/weight-service/weight/all/{start}/{end}` | `[]` | |
| range | `/goal-service/goal/user/effective/weightgoal/{start}/{end}` | object | |
| range | `/wellnessactivity-service/activity/summary/range/{from}/{until}` | `[]` | |
| range | `/wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate` | `[]`, intraday values inside | |
| range | `/activitylist-service/activities/search/activities?start&limit&startDate&endDate` | `[]` | page of 100 |
| day | `/hrv-service/hrv/{date}` | `hrvReadings` every 5 min of sleep | |
| day | `/sleep-service/sleep/dailySleep?date` | sleep timeline | |
| day | `/wellness-service/wellness/dailyHeartRate?date` | HR every 2 min (720 points) | |
| day | `/wellness-service/wellness/daily/spo2acclimation/{date}` | SpO2 readings | |
| day | `/usersummary-service/usersummary/daily?calendarDate` | full daily summary | |
| day | `/fitnessage-service/fitnessage/v2/{date}` | fitness age and components | |
| day | `/nutrition-service/food/logs/{date}` | food log | |
| day | `/periodichealth-service/menstrualcycle/summary/{date}` | 204 when none | |
| day | `/periodichealth-service/menstrualcycle/dayview/{date}?todayDate` | | |
| activity | `/activity-service/activity/{id}` | detail (`summaryDTO`) | |
| activity | `/activity-service/activity/{id}/workouts` | planned workout steps | |
| activity | `/download-service/files/activity/{id}` | ZIP with the `.fit` file | |
| snapshot | `/userprofile-service/userprofile/settings` | profile | |
| snapshot | `/biometric-service/heartRateZones/v2` | zones per sport, LTHR, max HR | |

History seen for the owner: daily summaries back to at least 2024-11; none for 2022.

Measured detail (owner's account, 2026-11-04): heart rate has 720 points a day (every 2 min); overnight HRV has about 90 readings (every 5 min); SpO2 has 24 hourly averages; body battery has about 6 points a day; stress is daily durations per level only. The sleep endpoints have no stage timeline (no hypnogram), only stage totals, scores, SpO2 and respiration.

Not in the API: Garmin's training status, readiness, VO2 max, acute/chronic load, race predictions. We compute our own (phase 4).

### Size

Measured: about 40 KB of JSON per day of intraday data, and an activity ZIP of 25 KB (52 min strength) to a few hundred KB (long ride with GPS); parsed streams at 1 Hz are about 100 to 150 KB per hour. Estimate: about 75 MB per year for a heavy user with everything; about 20 MB for a 90-day user. Fine for the homelab Postgres.

## 2. Phases

Build in order, each a commit series on the branch.

### Phase 1: ingest everything, plus the new section shell and a data explorer

- **Storage.** `garmin_days.kind` grows to one kind per day or range endpoint (text column; the TypeScript enum changes, no SQL change). Snapshots (profile, HR zones) are stored as kinds keyed by fetch date, so changes over time are visible. `garmin_activities` gets `detail` and `workouts` JSON columns. New `garmin_activity_files` (the ZIP as `bytea`) and `garmin_activity_streams` (FIT parsed with `@garmin/fitsdk` into columnar arrays per field, plus laps, sets and the FIT session, with a parser version so a better parser can re-run).
- **Endpoint registry.** One table of endpoints in code: path builder, kind, how a response splits into per-day rows, max range, empty value. The sync and the backfill both walk this registry, so adding an endpoint is one entry.
- **Backfill.** `garmin_connections` gets a cursor (oldest date imported) and a done flag. A worker started in `src/instrumentation.ts` (same pattern as the gym import) wakes every minute, claims one connection with a lease column so two replicas never run the same user, imports a chunk of older days, and moves the cursor. Throttled to about two requests a second, backing off on 429. Limit by role (G-3).
- **Page shell.** `/more/garmin`, listed in More under Training after Progress, with tabs Overview and Data; later phases add Today, Activities, Sleep and Trends.
- **Data explorer** (Data tab): every stored kind per date, with the raw JSON, field counts, and sync history with backfill progress. This is what "expose all data" means on day one.
- **Tests:** registry splitting per endpoint (unit), backfill cursor, lease and limits (integration), FIT parsing on a synthetic file (unit).

### Phase 2: Today and Sleep views

Intraday timelines on one shared time axis: HR (every 2 min), body battery, SpO2 (hourly) and overnight HRV (every 5 min); the sleep window drawn over them with stage totals and scores (Garmin gives no stage timeline); day picker.

### Phase 3: Activity deep view

Stream charts (HR, power, pace, cadence, altitude), route map from GPS, time in zones from the stored HR zones, laps, aerobic decoupling and efficiency factor, swim/bike/run specifics. Strength activities joined with the LogEveryLift session from the same time.

### Phase 4: Training load model

Our own load per activity (TRIMP from HR streams; power-based where there is power), then fitness, fatigue and form (CTL/ATL/TSB) across all sports, including LogEveryLift strength sessions. Ramp-rate warnings.

### Phase 5: Insights and AI

Correlations (sleep and HRV against load and performance), weekly summaries, and the stored data exposed through the app's existing MCP server so an assistant can read it for Ironman planning.

## 3. Before any public launch

Everything in BACKLOG "Garmin: go live in prod", plus: GPS (G-2) needs its own policy text and probably an opt-in; the menstrual cycle and nutrition data are new health categories.
