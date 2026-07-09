# LogEveryLift — UI Test Checklist

Manual UI regression tests verified by clicking through the live app (Playwright MCP).
Run these after any significant change. Each test has an expected result — if it differs, file a bug.

Last full run: **2026-04-12** · App: `http://localhost:3000`

---

## How to use this document

Start the app with `./scripts/dev.sh`, then work through each section top to bottom.
Mark each item `[x]` as you verify it, or note the failure inline.

---

## 1. Home / Dashboard — `/`

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Load `http://localhost:3000` | "LogEveryLift" title, active program card (name, week X/Y, end date), weekly heatmap with checkmarks on completed days, workouts-per-week ring and count |
| 1.2 | Tap "THIS WEEK ›" link | Navigates to `/more/calendar` |
| 1.3 | Tap "Start a Workout →" button | Navigates to `/new-workout` |
| 1.4 | Tap Workout tab in nav (when no session active) | Navigates to the active program's workout page |
| 1.5 | Tap Cycles nav tab | Navigates to `/cycles` |
| 1.6 | Tap Programs nav tab | Navigates to `/programs` |
| 1.7 | Tap More nav tab | Navigates to `/more` |

---

## 2. New Workout Picker — `/new-workout`

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Load `/new-workout` | "New Workout" heading, list of all programs (one row each with chevron) |
| 2.2 | Tap any program row | Navigates to that program's workout session page `/programs/{id}/workout` |
| 2.3 | Tap "< Home" back link | Returns to home |

---

## 3. Workout Session — `/programs/{id}/workout`

| # | Action | Expected |
|---|--------|----------|
| 3.1 | Load workout page for an active program | "Workout" heading, program name, elapsed timer counting up (MM:SS format), list of exercises with set summaries |
| 3.2 | If this program has enough history | Insight banner visible above exercise chips (e.g. "You're progressing on X exercises — keep the momentum.") — only shown when `insight.type !== "on_track"` |
| 3.3 | Exercise progress chips (↑ / → / ⚠ / ↓) | Pills visible below the insight banner; one per exercise showing progression status |
| 3.4 | Tap exercise row | Navigates to that exercise's sets page |
| 3.5 | Tap "Edit" button | Exercise rows show drag handles + delete; "Edit" button changes to "Done" |
| 3.6 | In edit mode tap "Done" | Exits edit mode, drag handles disappear |
| 3.7 | Tap "+" (add exercise) button | Action sheet opens with "Add Exercise" option and "Cancel" |
| 3.8 | Tap "Add Exercise" in sheet | Navigates to `/programs/{id}/workout/add-exercise` |
| 3.9 | Tap "Cancel" in sheet | Sheet closes |
| 3.10 | Tap "Finished" | Confirmation sheet appears: "Finish workout?" with Cancel / Yes, finish |
| 3.11 | Tap "Cancel" in finish sheet | Sheet closes, still on workout page |
| 3.12 | Tap "Yes, finish" | Navigates to `/programs/{id}/workout/finish?start=…` |
| 3.13 | Last session note card (if prior session had notes or feeling) | Shows at top with date, duration, feeling badge, notes text, and × dismiss button |
| 3.14 | Tap × on last session note | Card disappears |
| 3.15 | First time loading the session (readiness = null) | Readiness check-in sheet appears (1–5 scale) |

---

## 4. Exercise Sets — `/programs/{id}/workout/exercises/{exerciseId}`

| # | Action | Expected |
|---|--------|----------|
| 4.1 | Load exercise sets page | Exercise name heading, summary pills (e.g. "↑ +2.5kg", "1RM ~98kg"), numbered set rows with weight × reps, "Last: Xkg (feeling, RPE Y)" info, REST dividers between sets |
| 4.2 | Set has enough confident hits to progress | Blue "↑ Xkg" pill visible on that set row |
| 4.3 | Tap "↑ Xkg" progression pill | Pill disappears; weight in set header updates to the suggested value |
| 4.4 | Tap the circle/play button to complete a set | Circle fills with checkmark (blue), rest timer starts counting down (e.g. REST 01:25), set row dims |
| 4.5 | Rest timer reaches 0 | Timer shows REST 00:00 (optionally sends browser notification if granted) |
| 4.6 | Set completion triggers a PR | 🏆 PR badge appears on the set row; PR celebration card appears briefly (~2.5s) then fades |
| 4.7 | Tap checkmark to uncomplete the set | Checkmark returns to empty circle, rest timer removed, 🏆 PR badge disappears |
| 4.8 | Tap a set that has preceding uncompleted sets (skip ahead) | All preceding uncompleted sets also get checkmarks (catch-up), rest timer only starts for the tapped set |
| 4.9 | Tap REST divider | Rest time editor sheet opens with quick-select buttons (30s, 1m, 1:30, 2m, 2:30, 3m, 4m, 5m) and fine-tune min/sec inputs |
| 4.10 | Select a different quick-select option | That option highlights, min/sec inputs update |
| 4.11 | Tap "Done" in rest editor | Sheet closes, REST label in list updates to new time |
| 4.12 | Tap "Edit" in header | Inline edit sheet opens for the exercise set (weight, reps, rest, RPE) |
| 4.13 | Tap "< Back" | Returns to workout session page |

---

## 5. Finish Workout — `/programs/{id}/workout/finish`

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Navigate to finish page | "Workout Complete" heading, summary card (Date, Started, Duration), feeling picker (Tired / OK / Good / Awesome), optional Notes textarea, "Save Workout" and "Discard Workout" buttons |
| 5.2 | Duration is calculated correctly | Matches elapsed time from workout start to finishing (~1–3 min difference is acceptable) |
| 5.3 | "Good" feeling pre-selected | "Good" button highlighted in primary colour |
| 5.4 | Tap different feeling | That feeling highlights, others deselect |
| 5.5 | Tap "Save Workout" | Confirmation sheet: "Save this workout?" with Cancel / Yes, save |
| 5.6 | Tap "Cancel" in save sheet | Sheet closes |
| 5.7 | Tap "Yes, save" | Saves session + per-set overrides → redirects to home; active session cleared |
| 5.8 | Tap "Discard Workout" | Confirmation sheet: "Discard this workout?" with Cancel / Yes, discard |
| 5.9 | Tap "Yes, discard" | Deletes session record → redirects to home; active session cleared |

---

## 6. Programs — `/programs`

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Load `/programs` | "Programs" heading, list of all programs, import/export icons and Edit/+ buttons in header |
| 6.2 | Tap a program row | Navigates to `/programs/{id}` detail page |
| 6.3 | Program detail page | Program name, "LAST SESSION · date · Xm" badge if prior session exists, list of exercises with set summaries, Share and Edit buttons |
| 6.4 | Tap exercise row on program detail | Navigates to exercise edit page `/programs/{id}/exercises/{peId}` |
| 6.5 | Tap "+" in Programs list | Navigates to create program flow |
| 6.6 | Tap "Edit" in Programs list | Programs become reorderable / deletable |

---

## 7. Cycles — `/cycles`

| # | Action | Expected |
|---|--------|----------|
| 7.1 | Load `/cycles` | "Cycles" heading, ACTIVE section, each active cycle shows name, "Week X of Y", end date, progress bar, green dot |
| 7.2 | Tap a cycle card | Navigates to `/cycles/{id}` detail page |
| 7.3 | Cycle detail page | Cycle name, duration + frequency + Active badge, WEEKLY SCHEDULE with MON–SUN rows, "Restart cycle" and "Delete cycle" buttons |
| 7.4 | Tap "Edit" on cycle detail | Navigates to edit cycle page |
| 7.5 | Tap "+" in Cycles list header | Navigates to `/cycles/new` |

---

## 8. History — `/history`

| # | Action | Expected |
|---|--------|----------|
| 8.1 | Load `/history` | "History" heading, list of completed sessions sorted newest-first; each row: program name, date, duration (min 1 min), set/exercise/kg summary tags |
| 8.2 | Sessions with 0 sets | Show "0 sets · 0 exercises" — visible but correct (user started then discarded without logging) |
| 8.3 | Tap a session row | Navigates to `/history/{sessionId}` |
| 8.4 | Session detail — session with feeling + notes | Feeling badge (Tired/OK/Good/Awesome colour-coded) visible next to duration; notes text shown below summary row |
| 8.5 | Session detail — session without feeling/notes | No feeling badge, no notes section; just date, program name, duration, volume |
| 8.6 | Session detail — sets table | Exercise headings, set rows (Set 1, Set 2…), reps × weight, RPE value on right |
| 8.7 | Session detail — sub-60-second sessions | Duration shows "1 min" not "0 min" |
| 8.8 | Tap trash icon on session detail | Confirmation prompt or immediate delete, navigates back to history list |

---

## 9. Metrics — `/more/metrics`

| # | Action | Expected |
|---|--------|----------|
| 9.1 | Load `/more/metrics` | Four stat tiles: Sessions, Week Streak, Avg. Session, Total Volume |
| 9.2 | Body Weight card | Shows latest logged weight + date; "+ Log" button visible |
| 9.3 | Tap "+ Log" | Weight entry input or sheet appears |
| 9.4 | Tap trash on a weight entry | Entry deleted |
| 9.5 | Volume · Last 8 Weeks chart | Bar chart visible with week labels and session-count numbers below each bar |
| 9.6 | Muscle Balance · Last 28 Days | Progress bars for each muscle group with set count |
| 9.7 | Session Mood · Last 28 Days | Bar/legend showing feeling distribution |

---

## 10. Calendar — `/more/calendar`

| # | Action | Expected |
|---|--------|----------|
| 10.1 | Load `/more/calendar` | "Calendar" heading, current month grid (Mon–Sun columns), today's date circled |
| 10.2 | Days with scheduled workout | Coloured cell with abbreviated program name (e.g. "Push", "Uppe") and cycle colour dot |
| 10.3 | Days with completed session | Brighter/filled cell indicating logged |
| 10.4 | Tap "‹" prev / "›" next arrows | Calendar navigates to previous/next month |
| 10.5 | Legend at bottom | Shows all active cycles with their colours, plus Scheduled / Completed indicators |

---

## 11. Account — `/more/account`

| # | Action | Expected |
|---|--------|----------|
| 11.1 | Load `/more/account` | PROFILE section (Name, Email, Role), BODY & GOALS section (Goal, Experience level, Gender, Year of birth, Height, Body weight), Save button, SECURITY section |
| 11.2 | Change a goal or experience level | Pill highlights |
| 11.3 | Tap "Save" | Profile saved; no error toast |
| 11.4 | Tap "Change Password" | Password change flow opens |

---

## 12. Settings — `/settings`

| # | Action | Expected |
|---|--------|----------|
| 12.1 | Load `/settings` (via More → Settings) | APPEARANCE (Dark Mode toggle, Scale 85–125%, Accent Color swatches), WORKOUT (Weekly Goal 1–7, Weight Increment, Rep Increment), NOTIFICATIONS (Rest timer alerts toggle) |
| 12.2 | Tap Dark Mode toggle | Theme switches between light and dark immediately |
| 12.3 | Tap a Scale option | UI scales immediately |
| 12.4 | Tap an Accent Color | Primary colour updates throughout app |
| 12.5 | Tap a Weekly Goal number | Highlights; home ring goal updates |
| 12.6 | Tap a Weight Increment | Highlights; used as default increment for new program exercises |
| 12.7 | Toggle Rest timer alerts | On = browser notification fires when rest timer ends; Off = silent |

---

## 13. AI Setup — `/more/ai-setup`

| # | Action | Expected |
|---|--------|----------|
| 13.1 | Load `/more/ai-setup` | Three steps: Copy Prompt, Open AI, Paste Response; "Copy Prompt" button, large textarea, "Import" button |
| 13.2 | Tap "Copy Prompt" | Prompt copied to clipboard (may show confirmation) |
| 13.3 | Paste a valid AI-generated JSON in textarea and tap "Import" | Programs/cycles created and user redirected |

---

## 14. Exercises Browser — `/exercises`

| # | Action | Expected |
|---|--------|----------|
| 14.1 | Load `/exercises` | "Exercises" heading, search box, category rows (All Exercises, Body Area, Muscles, Equipment, Timed, Function, My Exercises) |
| 14.2 | Tap "All Exercises" | Full exercise list with search |
| 14.3 | Type in search box | Results filter in real time |
| 14.4 | Tap "+" add button | Create custom exercise form |

---

## 15. More menu — `/more`

| # | Action | Expected |
|---|--------|----------|
| 15.1 | Load `/more` | All menu items present: AI Setup, Account, Calendar, Exercises, History, Metrics, Settings, Feedback, Admin Tools (admin only) |
| 15.2 | Tap each item | Routes correctly (see table below) |

| Label | Route |
|-------|-------|
| AI Setup | `/more/ai-setup` |
| Account | `/more/account` |
| Calendar | `/more/calendar` |
| Exercises | `/exercises` |
| History | `/history` |
| Metrics | `/more/metrics` |
| Settings | `/settings` |
| Feedback | `/more/feedback` |
| Admin Tools | `/more/admin` (admin only) |

---

## Known Issues / Watch List

| Severity | Description | Status |
|----------|-------------|--------|
| UX | Workout timer persists from old sessions if localStorage is not cleared. A session started 11+ hours ago shows a 686-minute timer. No automatic expiry mechanism exists. | **Fixed** — sessions older than 8 hours are discarded on load (both context and WorkoutSessionClient) |
| UX | Empty sessions (0 sets logged) appear in History with misleading "0 sets · 0 exercises" tags. | **Fixed** — 0-set sessions now show *"No sets tracked"* in muted italic |
| Low | PR celebration overlay has `pointer-events-none`, so the user can interact with the set list while the animation plays. | Open |

---

## Security Fixes (2026-04-12)

| Function | File | Gap | Fix |
|----------|------|-----|-----|
| `addExerciseToProgram` | `actions/programs.ts` | No auth — any user could add exercises to any program | Added `requireSession()` + program ownership check |
| `removeExerciseFromProgram` | `actions/programs.ts` | No auth — any user could delete exercises from any program | Added `requireSession()` + program ownership check |
| `reorderProgramExercises` | `actions/programs.ts` | No auth | Added `requireSession()` + program ownership check |
| `addProgramSet` | `actions/programs.ts` | No auth | Added `requireSession()` + ownership via programExercise→program join |
| `updateProgramSet` | `actions/programs.ts` | No auth — any user could edit any program set | Added `requireSession()` + ownership via set→exercise→program join |
| `deleteProgramSet` | `actions/programs.ts` | No auth | Added `requireSession()` + program ownership check |
| `reorderProgramSets` | `actions/programs.ts` | No auth | Added `requireSession()` + ownership via programExercise→program join |
| `updateProgramExerciseIncrement` | `actions/programs.ts` | No auth | Added `requireSession()` + ownership via programExercise→program join |
| `updateProgramExerciseIncrementReps` | `actions/programs.ts` | No auth | Added `requireSession()` + ownership via programExercise→program join |
| `updateProgramExerciseProgressionMode` | `actions/programs.ts` | No auth | Added `requireSession()` + ownership via programExercise→program join |
| `upsertCycleSlot` | `actions/training-cycles.ts` | No auth — any user could add/edit slots on any cycle | Added `requireSession()` + cycle ownership check |
| `removeCycleSlot` | `actions/training-cycles.ts` | No auth | Added `requireSession()` + cycle ownership check |
| `reorderCycleSlots` | `actions/training-cycles.ts` | No auth | Added `requireSession()` + cycle ownership check |
| `logWorkoutSet` | `actions/workout-sets.ts` | Had auth but no session ownership check — user could log sets into another user's session | Added session ownership verification |

---

## Fixes Confirmed in This Run (2026-04-12)

| Bug | Fix | Verified |
|-----|-----|---------|
| Session detail showed no feeling badge (used `detail.notes` to look up colour key instead of `detail.feeling`) | Fixed to use `detail.feeling` for badge | ✅ April 11 Cardio Session shows "OK" badge |
| Session detail showed no notes text | Added `{detail.notes && <p>…</p>}` block | ✅ "Felt week" note visible |
| Session detail showed "0 min" for sub-60s sessions | Added `Math.max(1, …)` to duration calc | ✅ Short sessions show "1 min" |
| Workout insight banner never rendered (only exercise chips shown) | Added banner block for `insight.type !== "on_track"` | ✅ "You're progressing on 10 exercises" visible |
| Readiness gate only suppressed weight progressions, not reps/time | Expanded gate to cover `progressed-reps` and `progressed-time` | ✅ Unit tested |
| Time-mode suggestion pill was a no-op (durationSeconds never forwarded) | Extended callback signature + wired through `setOverride` | ✅ Code path verified |
| PR badge lingered after set was uncompleted | Added `setPrSetIds` clear in uncomplete branch of `toggleSet` | ✅ Badge clears on uncomplete |
| `setSessionReadiness` had no auth check | Added `requireSession()` + ownership verification | ✅ Matches pattern of other session actions |
| `getActiveSession` dead code with caller-supplied userId (no auth) | Removed | ✅ No callers existed |
| Notification icon path 404 (`/icon-192.png`) | Fixed to `/icon-192x192.png` | ✅ Correct file exists |
