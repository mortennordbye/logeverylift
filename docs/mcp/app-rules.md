# LogEveryLift rules for assistants

Version: 2026-11-12

This document is served to connected AI assistants as an MCP resource
(`logeverylift://docs/app-rules`). It describes the app as it is today. It holds no personal
data. Keep it true to the code: `pnpm check:docs` checks its citations. When a package changes
what it describes, that package updates this file and the server instructions in
`src/lib/mcp/instructions.ts` in the same PR.

## The model

- **Program.** A named list of exercises. Each exercise slot holds planned sets in order:
  reps or a rep range, weight, rest, or for endurance work a duration, distance, incline and
  heart rate zone. Each slot also holds its progression settings.
- **Training cycle.** A template that runs programs for a number of weeks. The schedule is
  either by weekday (one slot per day, 1 = Monday to 7 = Sunday) or a rotation (slots in order,
  one per workout). A slot points at a program, or at nothing for a rest day. A slot marked
  `autoComplete` is a day the user tracks outside the app; it completes itself. A cycle is a
  draft, active or completed, and only one is active at a time.
- **Workout session.** One logged workout, with its sets: reps, weight, duration, distance,
  heart rate zone, effort (RIR or RPE), and how the user felt. Assistants can read sessions but
  cannot log or edit them.
- **Profile and body weight.** Name, gender, birth year, height, goals, experience level, and a
  weight history.
- **Settings.** The user's time zone and display units (`get_profile`, `update_profile`), and
  whether the endurance add-on is on (`enduranceEnabled`). The add-on gates the triathlon plan
  and the race on a cycle in the app. Only an admin can turn it on; no tool can set it
  (`src/lib/endurance.ts`).

## Who owns which field

Three writers can change a planned set. A write by an assistant to a field another writer owns
lasts only until that writer runs again.

| Field | Owner | What an assistant's edit does |
|---|---|---|
| Target reps and weight on strength sets | The progression engine, after each logged session (`src/lib/utils/progression.ts`) | A one-off. The engine moves it again after the next session. To change the trend, change the slot's progression settings. |
| Distance and duration on sets with a peak anchor | The weekly sync of the active cycle, scaled from the peak by the week's phase (`src/lib/periodization-sync.ts:230-231`) | A set replace stores the new value as the new peak, so the edit changes the peak, not only this week. |
| Heart rate zone and rest on `work` sets | The weekly sync, by phase (`src/lib/periodization-sync.ts:233-236`) | Overwritten at the next weekly sync. |
| The cycle's volume factor (`adaptationPct`) | The weekly sync, from adherence, readiness and effort | No tool writes it. |
| Everything else in programs and cycles | The user and the assistant | Stays until changed again. |

## Limits of the app today

- **No undo.** Every write applies at once and is final. There is no revision history yet.
  Before a large change, read the current state so you can tell the user exactly what changed.
- **No training limits in code.** Nothing checks a ramp, a long-run cap or hard days per week.
  Use the endurance training reference (`logeverylift://docs/endurance-training-reference`)
  and say which rule and evidence label a change rests on.
- **One workout slot per day** in a weekday cycle.
- **No seasons or races above cycles.** A cycle can hold a race date and distance.
- **Time:** "today", the cycle week, the weekly sync and the date a workout is logged on follow
  the user's time zone (`timeZone` in `get_profile`; `src/lib/periodization-sync.ts:49`). With
  no zone set, they follow the server's clock and the phone's day.
- **Units:** every value a tool takes or returns is metric (kg, metres, seconds). The user's
  `distanceUnit` (km or mi) and `swimUnit` (m or yd) only change what the app shows; weights
  are always kg.
- **No session notes over MCP yet.** Tools leave free-text notes out.

## Access

A connection is either read only or read and change. The user picks it when they connect.
Under read only, write tools are listed but refuse with a message. The user can disconnect an
assistant at any time in More → Connected assistants; the next request then fails.
