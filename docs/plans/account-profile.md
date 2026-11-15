# Profile facts into Account

Status: locked by the owner, building on `feat/account-profile`. One PR.

## 1. Goal

Make the app less complex. The facts about the user that live on the Athlete profile page and the
Thresholds page move into the Account page. Two More items and two pages go. Nothing new is added
that the owner did not lock below.

Before: four pages (Account, Athlete profile, Thresholds, interview), More items Account, Athlete
profile, Thresholds. After: two pages (Account, interview), More item Account.

## 2. Locked decisions

1. **Account stays one page.** No sub-pages.
2. **Sections, in this order:**
   - **Profile:** name, email, role, joined (as today).
   - **Goals and training:** the goals chips, strength goal, experience strength (the existing
     `users` experience level), experience endurance (`athlete_profiles.endurance_level`),
     availability, athlete questions (the interview row: "Answered <date>" or "Not answered",
     opens `/more/athlete/interview`).
   - **Body and health:** gender, year of birth, height, body weight, sync weight from Garmin (as
     today), injuries and limits, sick periods.
   - **Training numbers:** max HR, FTP, threshold HR bike, threshold HR run, run threshold pace,
     swim CSS, then "Recently deleted (n)" when there are deleted values.
   - **Security and privacy:** change password, then the Privacy rows of today.
   - **Your data:** as today (export, delete account).
   - **Sign out:** as today.
3. **Edit in place with today's editors.** Each row opens a bottom sheet with the editor that exists
   now: `StrengthStep`, `ExperienceStep`, `AvailabilityStep`, `InjuryList` and `InjurySheet`, the
   sick period list and editor, the thresholds editor with history and the Garmin suggestion. No
   rewritten editors. The consistency line goes inside the sick periods sheet, at the top.
4. **Easy to add on, flat code.** One list of sections and rows in one file (for example
   `src/components/features/account/sections.ts`). A row is an id, a label, a value read from the
   page data, an optional `show` test, and the editor it opens. The page does one loop over the
   sections, keeps one "open row" value, and renders one sheet. Adding a field is one entry. No
   wrapper components around the editors, no context provider, no per-row state, no deep nesting.
   The pattern of the home widget registry (`src/lib/home/widgets/`) is the model, kept flatter.
5. **One data read.** The Account page loads the athlete and threshold data in the same server read
   it already does. No fetch per section.
6. **The endurance switch stays for now.** The rows that are endurance-only today (strength goal,
   experience endurance, availability, injuries, sick periods, athlete questions) show only when
   `enduranceEnabledFor` is true, through the row's `show`. Training numbers show for every user,
   as the Thresholds page does today. The switch removal is a later PR
   ([one-user-premium.md](one-user-premium.md) on `docs/endurance-journeys`).
7. **No schema change.** Strength and endurance experience stay two fields.

## 3. Remove

- `src/app/more/athlete/page.tsx` and `src/app/more/athlete/loading.tsx`. The interview route
  `src/app/more/athlete/interview/page.tsx` stays at its URL.
- `src/app/more/thresholds/page.tsx` and its `loading.tsx`.
- `AthleteProfileClient` and `ThresholdsClient` as page shells, once their parts render from
  Account. Keep and reuse the editor parts; delete only what nothing uses.
- In `MoreClient`: the Thresholds item and `athleteItem` (Workouts and Nutrition stay).
- Back-nav labels for `/more/athlete` and `/more/thresholds` in `src/lib/utils/back-nav.ts`.

## 4. Repoint

Every link, fallback and `revalidatePath` to `/more/athlete` or `/more/thresholds` goes to
`/more/account`: the assistant changes feed, the planned session page's thresholds link, the
interview's done and back targets, the server actions in `src/lib/actions/athlete-profile.ts`,
`workouts-compliance.ts` and `plan-revisions.ts`. `grep -rn "more/athlete\|more/thresholds" src e2e`
must return only the interview route.

## 5. Tests and docs

- Update the unit tests (`back-nav.test.ts` and any test of the removed pages) and the e2e specs
  that go through the old pages (`e2e/thresholds.spec.ts`, `e2e/athlete-interview.spec.ts`,
  `e2e/back-nav.spec.ts` where relevant) so they go through Account.
- `pnpm check:docs` must pass. Fix citations in `docs/` and `BACKLOG.md` that point at removed
  files or moved lines (`docs/plans/athlete-profile.md`, `docs/plans/back-navigation.md`,
  `docs/plans/workouts-and-compliance.md`).
- Check `docs/privacy/data-inventory.md` for the old page names; no data changes.
