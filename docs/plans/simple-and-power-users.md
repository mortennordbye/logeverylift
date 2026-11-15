# One app for a lifter and a triathlete

Status: plan, no build yet. Follows [one user type, Garmin as an add-on](one-user-garmin-plus.md).
That plan gives every user every feature. This plan decides how much of it each user sees, so a
lifter does not get a cockpit and a triathlete does not get a toy.

## 1. The problem

Without the switch, every endurance control shows to every user. A lifter who only runs a
4-day split would see key session and brick toggles on each slot, race fields on a cycle, phase
types on a season, a discipline field on a custom exercise, a swim unit in Settings and four
endurance pages in More. None of it is wrong, but all of it is noise for that user.

A hybrid user (triathlon, or lifting plus running) needs the opposite: dense views, key sessions,
bricks, load, limits, race plans, without hunting for them.

## 2. Rules

No second switch. A "simple mode" or "advanced mode" toggle is the endurance switch again under a
new name. Instead, four rules decide what a screen draws:

1. **Data shows it.** A part draws when the user has the data it shows: compliance bands on a
   session that has a sport, the race countdown when a race exists, per-sport totals for sports
   with sessions this week, load when there is load. A lifter has no such data, so the part is not
   there. A triathlete has it, so it is.
2. **Context shows it.** An option draws only where it can apply: brick only between two
   swim, bike or run sessions, key session only on a swim, bike or run session, the triathlon plan
   only when the season has a triathlon race.
3. **Set values stay open.** Rare options sit under a collapsed "More options" row in their form
   or sheet. The row opens by itself when any option in it already has a value, so a power user
   never loses sight of what they set.
4. **One door per action.** Each action has one entry point that offers both worlds. "Add a
   session" offers a strength program or a swim, bike or run workout. A lifter sees one extra
   choice, not a new screen.

The Account goals (`users.goals`, `src/components/features/AccountClient.tsx:118`, which already
offers "endurance") only set defaults: the home layout and the order of choices in pickers. They
never hide a feature.

## 3. Screen by screen

| Screen | Endurance part | Rule | What a lifter sees | What a triathlete sees |
|---|---|---|---|---|
| Home | Endurance today | Data. Already draws nothing without a session (`src/components/features/home/widgets/endurance-today/View.tsx:18`) | Nothing | Today's sessions with steps |
| Home | Race countdown, training load | Data for the countdown. Defaults from goals: on for the endurance goal, off otherwise | Not in the default layout; can add | On by default |
| Home | Readiness swap, unconfirmed, missed key | Data | Nothing | Cards when they apply |
| Slot sheet | Key session, brick | Context: only on a swim, bike or run slot; brick only after another one (`src/components/features/CycleScheduleBuilder.tsx:521`) | Nothing on a strength slot | Both, on sport slots |
| Slot sheet | Complete automatically | More options | Collapsed | Collapsed, open when set |
| Cycle form | Race date and distance | More options; races live on seasons | Collapsed "Add a race" | Same, open when set |
| Season form | Races | Data and one door: an "Add a race" button, the list when races exist | One button | The race list |
| Season form | Phase types | More options | Collapsed | Open when set |
| Season form | Triathlon plan | Context: only with a triathlon race (`src/components/features/SeasonForm.tsx:362`) | Nothing | The option |
| Plan and calendar | Key marks, compliance bands, heavy-legs notes | Data | Nothing | All of them |
| Week view | Per-sport totals, load | Data | Strength sessions only | Every sport, load |
| Exercises | Discipline on a custom exercise | More options | Collapsed | Collapsed, open when set |
| Settings | Swim distance unit | Context: under Units, only after the user has a swim session or a swim threshold | Hidden | Shown |
| More | Endurance hub | One row ([more-endurance-hub.md](more-endurance-hub.md)) | One row | One row with four pages |
| AI setup | Endurance interview | Goal: the endurance goal leads to the interview | Lifting flow as today | Interview and triathlon plan |

## 4. How a lifter becomes hybrid

No setting to find. The user adds one run, from the "Add a session" door, the AI setup or the
assistant. From that moment rules 1 and 2 draw the run's parts: the session gets "Did you do it?"
and the guided player, the week view shows a run total, the slot sheet offers key session. When
they add a race, the countdown and race plan appear. Each step adds only what the new data needs.

## 5. Build

1. A small helper, `sportsInPlay(userId)` (*new*): the sports with a session, workout, threshold
   or race in the last 12 weeks or ahead. One read per page, cached per request like
   `enduranceEnabledFor` is now. Rules 1 and 2 read it where the page does not already have the
   data.
2. A `MoreOptions` component (*new*): a collapsed row that opens itself when `hasValue` is true.
   Used in the slot sheet, cycle form, season form and the exercise form.
3. Home defaults: `defaultLayout` reads the goals instead of the switch for `defaultVisible`
   (`src/lib/home/layout.ts:60`). `available` returns true for every widget except Garmin ones.
4. Each screen in section 3 changes in the same PR as the switch removal, so no release shows a
   lifter the full endurance UI.

## 6. Open decisions

1. **12-week window** for `sportsInPlay`. Shorter hides parts from a user back from a break;
   longer keeps them after a user stops. Recommended: 12 weeks ahead and behind.
2. **Goals as defaults.** Use Account goals for home defaults and picker order (recommended), or
   ignore goals and use data only.
3. **Same PR as the switch removal** (recommended), or the switch removal first behind a short
   test on the owner's account.
