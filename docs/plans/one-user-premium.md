# One user type, Premium as an add-on

Status: plan, no build yet. This is the endurance rework that [bike sessions](bike-sessions.md)
section 11 waits for. The More hub ([more-endurance-hub.md](more-endurance-hub.md)) builds on it.

## 1. Goal

There is one kind of user. The endurance switch (`user.endurance_enabled`,
`src/lib/endurance.ts`) goes away, and every user gets every feature: lifting, structured swim,
bike and run sessions, the week view, the guided player, races, seasons, the athlete profile and
nutrition.

Garmin becomes the first part of **Premium**: an add-on on top of the normal user flows. Today
only the owner is Premium. The rule for every feature:

- **App first.** Every screen, flow and rule works from data the user enters or logs in the app.
- **Premium enriches.** With Premium (Garmin data today), a feature shows more or better data.
  It never unlocks a flow and never blocks one.
- **No Premium dead ends.** A user without Premium never sees "connect Garmin", "needs Garmin" or
  an upsell, because they cannot get it yet. Premium-only parts are simply not drawn.

The code already has this pattern in two places: the training load picks Garmin or app data
(`loadSource`, `src/lib/utils/training-load.ts:221`), and the long-run cap reads app runs and adds
Garmin runs (`limitContext`, `src/lib/training-limits.ts:289`).

## 2. Premium

1. **One check.** A new module, src/lib/premium.ts (*new*), holds two checks: is premium (by
   role) and premium for (by user id). For now Premium is the admin role, so only the owner has it. No column,
   no billing and no purchase screen: when Premium opens to other users, only these two functions
   change.
2. **Garmin reads it.** `garminAllowed` becomes the premium check plus the key check
   (`src/lib/garmin/access.ts:16`). The 20 files that call `garminAllowed` or `garminAllowedFor`
   keep their calls. New code that is Premium but not Garmin calls the premium check, never the role.
3. **Licence trap.** Garmin's Personal API is for one person's own data. Premium can open to other
   users only after the Garmin Connect Developer Program (`src/lib/garmin/access.ts`, BACKLOG.md).
   Until then, a Premium user other than the owner gets the Premium parts that are not Garmin.
4. **Name in the app.** The owner sees "Premium" on the account page. Nobody else sees the word.

## 3. Remove the switch

About 45 source files call `enduranceEnabledFor`, and more pass the result down as a prop.

1. **Visibility gates.** Delete each check. What a lifter then sees is decided by
   [simple-and-power-users.md](simple-and-power-users.md), in the same PR. The gated places: pages that redirect
   (`/week`, `/planned/[id]` and its `play`, `pool`, `results`, `/races/[id]/plan`,
   `/more/athlete`, `/more/workouts`, `/more/nutrition`), More rows, home widgets
   (`available: (a) => a.endurance`), cycle and season form fields, the exercise discipline field.
2. **Write gates.** Delete the "Endurance features are not on for this account" refusals in server
   actions, `src/lib/*` and MCP tools.
3. **MCP.** Register the workout library, endurance and nutrition tools for every user
   (`src/app/api/[transport]/route.ts:111`). The `intake_interview` prompt always runs the
   interview.
4. **Admin and settings.** Delete `setUserEndurance`, the admin toggle on `/more/admin/users`
   and the "Endurance features: on/off" line in Settings.
5. **Home audience.** Delete `endurance` from the widget audience. Keep `garmin` and `cycle`.
6. **Column.** Stop reading `endurance_enabled` in this change. Drop the column in the next
   release, so a rollback still has it (as `garmin_fuel_logs` was kept).
7. **Revisions.** The undo path that skips endurance object types when the switch is off
   (`src/lib/plan-revisions.ts:1907`, `src/lib/mcp/revisions.ts:224`) goes.

## 4. One behaviour where the code forks today

Today the switch also changes logic for the same data. One behaviour must win. Recommended: the
endurance behaviour, for every user.

| Fork | Where | Merged behaviour | Effect on a lifter today |
|---|---|---|---|
| Auto-complete of sport sessions | `src/lib/planned-sessions.ts:546` | A swim, bike or run session goes to "Did you do it?" and never gets an auto row | Moot after section 11 item 2 of the bike plan: sport sessions become structured workouts, programs are strength only |
| `log_session` refuses an endurance program session | `src/lib/mcp/tools/sessions.ts:199` | Refuse for every user | Moot after the same conversion |
| Compliance with thresholds | `src/lib/session-compliance.ts:232` | Read thresholds for every user | Planned amounts get better when the user has thresholds; no change without them |
| Adaptation signals from dated sessions | `src/lib/periodization-sync.ts:127` | Dated-session adherence for weekday cycles with generated sessions | The weekly sync measures adherence from dated sessions instead of PZ-26. Visible change for lifters on weekday cycles |
| Training limits on assistant writes | `src/lib/training-limits.ts:290` | Run for every user | Only assistant writes are checked; a rule without data says "not checked" to the assistant |

## 5. Premium, feature by feature

| Feature | Every user (app data) | Premium adds (Garmin today) | Work |
|---|---|---|---|
| Session done | "Did you do it?" with time, distance, RPE; step results | Automatic match to a Garmin activity; pick an activity | None |
| Training load, fitness, fatigue, form | Loads from app sessions (pace, CSS, RPE) | Garmin series, with app sessions Garmin missed | None |
| Long-run cap | Runs logged in the app | Garmin runs added | None |
| Weekly load ramp | App load | Garmin load | None |
| Fuel log | On an app session | On a Garmin activity | None |
| Weekly adaptation | Adherence and RPE signals | Wearable nudge (HRV, sleep debt, ramp) | None |
| Thresholds | Manual entry with history | Garmin estimates as suggestions | None now. Later: suggest from a test workout's step results |
| Readiness swap, `hard_after_low_readiness` limit | Nothing | HRV and resting HR flag | Open decision 1 |
| Garmin section, readiness widget, Garmin MCP tools | Not shown | Full Garmin data | None, stays Premium |

Only readiness has no app-side source today. Everything else already has an app path.

## 6. What else this changes

- **More hub.** The rows on the hub lose their gates. The hub plan's decision 3 becomes
  "every row for every user".
- **Bike plan.** `feat/bike-sessions` rebases on this change. Section 11 item 1 ("same sessions
  and screens for every user") is done by this plan, except the AI setup part, which this plan
  replaces: no user type, so no gate on the AI setup either. The endurance interview runs for any
  user who wants an endurance plan.
- **Tests.** Every unit, integration and e2e test that sets `enduranceEnabled: true` or checks a
  hidden row for a lifter changes. `src/__tests__/integration/endurance-switch.test.ts` is
  replaced by a test that a new user reaches every endurance page.
- **Privacy.** No new data is collected. The data inventory (`docs/privacy/data-inventory.md`)
  still lists the endurance tables; their "who" changes from endurance users to all users. Check
  with the `privacy-compliance` skill.

## 7. Order

1. This plan: remove the switch, merge the forks (one PR).
2. Convert sport program sessions to structured workouts (bike plan section 11 item 2).
3. Rebase and finish `feat/bike-sessions`.
4. The More hub.
5. Readiness without Garmin, if open decision 1 says so.

## 8. Open decisions

1. **Readiness without Garmin.** Option A: a short daily check-in (sleep, soreness, energy) that
   feeds the readiness swap for every user, with Garmin HRV on top for Premium. Option B: keep
   readiness as a Premium extra. Recommended: B now, A as its own brief later.
2. **Endurance today widget.** Show it by default for every user, or only once the user has an
   endurance session planned. Recommended: available to all, default on, and it draws nothing on a
   day without an endurance session.
3. **Weekly sync for lifters.** Section 3 changes how adherence is measured for lifters on weekday
   cycles. Accept it, or keep PZ-26 for cycles with no endurance sessions. Recommended: accept,
   one method is simpler to reason about.
