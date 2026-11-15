# One More item for the endurance pages

Status: plan, no build yet. Builds on [one user type, Garmin as an add-on](one-user-garmin-plus.md):
that plan removes the endurance switch, so every row on the hub shows for every user. The gates
below describe the code before that plan.

## 1. Goal

The More list has four rows that the endurance work added: Thresholds, Athlete profile, Workouts
and Nutrition. After this change, the More list has one row, **Endurance**, that opens a hub page.
The hub lists the four pages. Every page keeps its URL and its content.

## 2. Today

| Row in More | URL | Who sees the row | Added in |
|---|---|---|---|
| Thresholds | `/more/thresholds` | every user | #226 (C3) |
| Athlete profile | `/more/athlete` | endurance switch on | #226 (C3) |
| Workouts | `/more/workouts` | endurance switch on | #231 (C4, C5) |
| Nutrition | `/more/nutrition` | endurance switch on | #234 (E1, E2) |

- `MoreClient` holds Thresholds in the Training group and inserts the three gated rows after it
  (`src/components/features/MoreClient.tsx:136`, `:144`, `:152`, `:248`). The page passes the
  switch as `showAthlete` (`src/app/more/page.tsx:18`).
- Each page has `BackLink` with the fallback `/more` (`src/app/more/thresholds/page.tsx:14`,
  `src/app/more/athlete/page.tsx:34`, `src/app/more/workouts/page.tsx:21`,
  `src/app/more/nutrition/page.tsx:30`).
- Other places link to the pages directly, by URL: the assistant changes feed
  (`src/components/features/AssistantChangesClient.tsx:25`), the planned session page, the athlete
  profile, the interview and the season form. Server actions revalidate the four URLs.

## 3. Decisions in this plan

1. **The URLs do not change.** A new hub page at `/more/endurance` links to the four existing
   URLs. Nested URLs (`/more/endurance/thresholds`) would touch every link, every
   `revalidatePath`, the back-nav label map and the e2e tests, for no user-visible gain.
2. **The hub row shows for every user.** Thresholds is open to every user today, so a hub that
   only endurance users see would hide Thresholds from lifters.
3. **Each row on the hub keeps its own gate until the switch goes.** After
   [one-user-garmin-plus.md](one-user-garmin-plus.md), every row shows for every user. The hub reads `enduranceEnabledFor` and shows
   Athlete profile, Workouts and Nutrition only when it is on, as `MoreClient` does now. When the
   rework removes a gate, only the hub's row condition changes. The hub works before and after the
   rework.
4. **Coach memory stays where it is.** It sits beside Connected assistants and the assistants page
   links to it (`src/components/features/AssistantsClient.tsx:82`). It belongs to the AI
   features, not to endurance. See open decision 2.

## 4. Build

1. **Hub page.** New `src/app/more/endurance/page.tsx` and `loading.tsx`. Same layout as the
   Thresholds page: `BackLink` with fallback `/more`, a title, then rows in the More row style
   (icon, label, description, chevron). Rows, in this order:
   - Thresholds: "FTP, threshold heart rate and paces, with history"
   - Athlete profile (switch on): "Availability, injuries, strength goal and the interview"
   - Workouts (switch on): "Your swim, bike and run workouts"
   - Nutrition (switch on): "Fuel logs, gut training, sweat tests, race plans"

   Move the row markup out of `MoreClient` into a small shared `MoreRow` component, so the hub and
   More draw rows the same way. The two callers justify the extraction.
2. **More list.** In `MoreClient`, replace the Thresholds row with an Endurance row
   (`/more/endurance`, description "Thresholds, workouts, nutrition and athlete profile"). Delete
   `athleteItem`, `workoutsItem`, `nutritionItem` and the `showAthlete` insert. Delete the
   `showAthlete` prop and the `enduranceEnabledFor` call in `src/app/more/page.tsx`.
3. **Back.** Change the `BackLink` fallback on the four pages to
   `{ href: "/more/endurance", label: "Endurance" }`. Add `["/more/endurance", "Endurance"]` to
   the label map in `src/lib/utils/back-nav.ts`.
4. **Revalidation.** No change. The hub shows no data, only links.

## 5. Tests

- `src/__tests__/back-nav.test.ts`: add the hub label.
- `e2e/thresholds.spec.ts:26` and `e2e/athlete-interview.spec.ts:30`: go through More >
  Endurance before they click Thresholds or Athlete profile. The lifter test checks that the hub
  shows Thresholds and not Athlete profile.
- New e2e case: an endurance user sees all four rows on the hub; Back from Workouts returns to the
  hub, and Back from the hub returns to More.
- Run `pnpm verify` and `make e2e`. No critical flow changes.

## 6. What on the hub needs Garmin, and what is not endurance-only

No page on the hub needs Garmin. Garmin adds two extras, both admin-only by `garminAllowed`:
threshold suggestions (`src/lib/athlete-profile.ts:220`) and a fuel log linked to a Garmin activity
(`src/lib/nutrition.ts:100`). Without Garmin, each page works from what the user enters.

| Part | Page | Who it is for | Notes |
|---|---|---|---|
| Thresholds (FTP, LTHR, run pace, CSS, max HR) | Thresholds | every user (open today) | Max HR and LTHR are useful to any user who trains with HR. |
| Injuries and limits | Athlete profile | every user | Only the assistant reads them today. A lifter's sore shoulder matters as much as a runner's knee. The AI setup could read them too. |
| Sick periods | Athlete profile | every user | Compliance and the home return card read them (`src/lib/illness.ts`). A lifter misses sessions when sick too, but the lifter side (a missed session, a pause in the cycle) needs new logic. |
| Availability | Athlete profile | every user | Only the assistant reads it. AI setup asks days per week and session minutes again (`src/components/features/AiSetupClient.tsx`). One stored answer could feed both. |
| Strength goal | Athlete profile | endurance users | Feeds the `strength_per_week` limit. Lifters already set goals in their profile. |
| Experience (`endurance_level`) | Athlete profile | endurance users | Feeds the triathlon generator. Part of the AI setup. |
| Intake interview | Athlete profile | endurance users | Part of the AI setup. |
| Workouts (swim, bike, run) | Workouts | every user, after the rework | The rework gives every user the same bike, run and swim sessions. |
| Fuel products, fuel logs, gut training | Nutrition | endurance users | Fuel during a session. Little use for lifting. |
| Sweat tests, race plans | Nutrition | endurance users | Endurance races only. |

So the hub holds two kinds of pages: endurance tools (Workouts, Nutrition, Experience, interview)
and general training facts about the user (Thresholds, injuries, sick periods, availability).
See open decision 4.

## 7. Open decisions

1. **Name of the row.** "Endurance" matches the feature today. After the rework every user sees
   bike, run and swim, so a name such as "Training setup" can fit better. Recommended:
   "Endurance" now, rename with the rework if the gates go.
2. **Coach memory.** Keep it in the AI group (recommended), or move it into the hub.
3. **Athlete profile placement after the rework.** If the athlete profile stays behind the AI
   setup gate, it can move to the AI setup page instead of the hub. This plan does not depend on
   that answer.
4. **General parts of the athlete profile.** Injuries, sick periods and availability fit every
   user (section 6). Options: keep them on the athlete profile behind the switch (no change), or
   split them into a page for every user, such as "Health and availability", and leave only
   Experience, Strength goal and the interview as endurance setup. Recommended: split them, in
   the rework, not in this change. Sick periods for lifters need their own brief.
